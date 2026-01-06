import { getBitrate, InMemoryStorage } from 'webcodecs-utils';
import { WebDemuxer } from "web-demuxer";



import { Muxer, StreamTarget } from 'mp4-muxer';

/**
 * Transcoding implementation - Streams Pipeline pattern
 * (Experimental approach using Web Streams API)
 *
 * This pattern uses the Web Streams API to create a composable pipeline
 * with automatic backpressure handling between stages.
 *
 * Key characteristics:
 * - Declarative pipeline composition (pipeThrough)
 * - Automatic backpressure via highWaterMark and desiredSize
 * - Each stage is independent and reusable
 * - More complex than Promise pattern but theoretically cleaner
 */

// Global references to access queue sizes and buffer state
let decoder: VideoDecoder;
let encoder: VideoEncoder;
let demuxerController: TransformStreamDefaultController<EncodedVideoChunk>;
let decoderController: TransformStreamDefaultController<VideoFrame>;
let renderController: TransformStreamDefaultController<VideoFrame>;
let encoderController: TransformStreamDefaultController<{ chunk: EncodedVideoChunk; meta: EncodedVideoChunkMetadata }>;

/**
 * TransformStream that tracks demuxed chunks before decoding
 * Provides visibility into demuxer → decoder buffer and applies backpressure
 * Adds frame index to each chunk
 */
class DemuxerTrackingStream extends TransformStream<EncodedVideoChunk, { chunk: EncodedVideoChunk; index: number }> {
  constructor() {
    let chunkIndex = 0;

    super(
      {
        start(controller) {
          // Save controller reference for progress reporting
          demuxerController = controller;
        },

        async transform(chunk, controller) {
          // Apply backpressure if downstream is full
          while (controller.desiredSize !== null && controller.desiredSize < 0) {
            await new Promise((r) => setTimeout(r, 10));
          }

          // Pass chunk with index
          controller.enqueue({ chunk, index: chunkIndex++ });
        },
      },
      { highWaterMark: 20 } // Buffer up to 20 chunks from demuxer
    );
  }
}

/**
 * TransformStream that decodes video chunks into frames
 * Handles decoder warm-up and maintains buffer
 * Passes frame index through
 */
class VideoDecoderStream extends TransformStream<{ chunk: EncodedVideoChunk; index: number }, { frame: VideoFrame; index: number }> {
  constructor(config: VideoDecoderConfig) {
    // Declare variables in closure scope
    let warmupItems: { chunk: EncodedVideoChunk; index: number }[] = [];
    let warmupComplete = false;
    const WARMUP_SIZE = 20;
    let pendingIndices: number[] = [];

    super(
      {
        start(controller) {
          // Save controller reference for progress reporting
          decoderController = controller;

          decoder = new VideoDecoder({
            output: (frame) => {
              // Match frame with its index (FIFO order)
              const index = pendingIndices.shift()!;
              controller.enqueue({ frame, index });
            },
            error: (e) => {
              console.error('Decoder error:', e);
              controller.error(e);
            },
          });

          decoder.configure(config);
        },

        async transform(item, controller) {
          // Warm-up phase: collect first N chunks before starting output
          if (!warmupComplete) {
            warmupItems.push(item);

            if (warmupItems.length >= WARMUP_SIZE) {
              // Decode all warmup chunks at once
              warmupItems.forEach(({ chunk, index }) => {
                pendingIndices.push(index);
                decoder.decode(chunk);
              });
              warmupComplete = true;
            }
            return;
          }

          // Backpressure checks BEFORE decoding:
          // 1. Check decoder's internal queue
          while (decoder.decodeQueueSize >= 20) {
            await new Promise((r) => setTimeout(r, 10));
          }

          // 2. Check downstream backpressure (TransformStream buffer)
          while (controller.desiredSize !== null && controller.desiredSize < 0) {
            await new Promise((r) => setTimeout(r, 10));
          }

          // Track this frame's index and decode
          pendingIndices.push(item.index);
          decoder.decode(item.chunk);
        },

        async flush(controller) {
          // Flush decoder - remaining frames will be enqueued by decoder.output
          await decoder.flush();

          try {
            decoder.close();
          } catch (e) {
            console.error('Error closing decoder:', e);
          }
        },
      },
      { highWaterMark: 10 } // Buffer up to 10 frames before applying backpressure
    );
  }
}

/**
 * TransformStream that processes/renders video frames
 * Placeholder for GPU processing, filters, upscaling, etc.
 * Passes frame index through
 */
class VideoRenderStream extends TransformStream<{ frame: VideoFrame; index: number }, { frame: VideoFrame; index: number }> {
  constructor() {
    super(
      {
        start(controller){
          // Save controller reference for progress reporting
          renderController = controller;
        },

        async transform(item, controller) {
          // Placeholder: currently just passes through
          // TODO: Add WebGPU processing, filters, etc.
          controller.enqueue(item);
        },
      },
      { highWaterMark: 5 } // Keep render buffer small
    );
  }

  private async renderFrame(frame: VideoFrame): Promise<VideoFrame> {
    // For now, just return the original frame
    // Later: Add WebGPU processing, filters, upscaling, etc.
    return frame;
  }
}

/**
 * TransformStream that encodes video frames into chunks
 * Handles encoder queue backpressure
 * Uses frame index to determine keyframes
 */
class VideoEncoderStream extends TransformStream<
  { frame: VideoFrame; index: number },
  { chunk: EncodedVideoChunk; meta: EncodedVideoChunkMetadata }
> {
  constructor(config: VideoEncoderConfig) {
    super(
      {
        start(controller) {
          // Save controller reference for progress reporting
          encoderController = controller;

          encoder = new VideoEncoder({
            output: (chunk, meta) => {
              // Directly enqueue to TransformStream buffer!
              controller.enqueue({ chunk, meta });
            },
            error: (e) => {
              console.error('Encoder error:', e);
              controller.error(e);
            },
          });

          encoder.configure(config);
        },

        async transform(item, controller) {
          // Backpressure checks BEFORE encoding:
          // 1. Check encoder's internal queue
          while (encoder.encodeQueueSize >= 20) {
            await new Promise((r) => setTimeout(r, 10));
          }

          // 2. Check downstream backpressure (TransformStream buffer)
          while (controller.desiredSize !== null && controller.desiredSize < 0) {
            await new Promise((r) => setTimeout(r, 10));
          }

          // Encode with keyframe every 60 frames
          encoder.encode(item.frame, { keyFrame: item.index % 60 === 0 });
          item.frame.close();
        },

        async flush(controller) {
          // Flush encoder - remaining chunks will be enqueued by encoder.output
          await encoder.flush();

          try {
            encoder.close();
          } catch (e) {
            console.error('Error closing encoder:', e);
          }
        },
      },
      { highWaterMark: 10 }
    );
  }
}

/**
 * Helper to create a ReadableStream from web-demuxer
 * web-demuxer.read() returns a native ReadableStream that handles:
 * - Keyframe alignment
 * - GOP boundaries
 * - Proper chunk ordering
 */
function createWebDemuxerStream(
  demuxer: WebDemuxer,
  trackType: 'video' | 'audio',
  startTime = 0,
  endTime?: number
): ReadableStream<EncodedVideoChunk | EncodedAudioChunk> {
  // web-demuxer.read() already returns a ReadableStream with proper backpressure!
  return demuxer.read(trackType, startTime, endTime) as ReadableStream<EncodedVideoChunk | EncodedAudioChunk>;
}

/**
 * Create a WritableStream that feeds encoded chunks to the muxer
 * Handles progress reporting and video chunk writing
 */
function createMuxerWriter(
  muxer: Muxer<StreamTarget>,
  options?: { onProgress?: (progress: TranscodeProgress) => void }
): WritableStream<{ chunk: EncodedVideoChunk; meta: EncodedVideoChunkMetadata }> {
  const startTime = performance.now();
  let frameCount = 0;

  return new WritableStream({
    async write(value) {
      // Add video chunk to muxer
      muxer.addVideoChunk(value.chunk, value.meta);
      frameCount++;

      // Progress reporting
      if (frameCount % 30 === 0 && options?.onProgress) {
        const elapsed = performance.now() - startTime;
        const elapsedSeconds = elapsed / 1000;
        const fps = frameCount / elapsedSeconds;

        // Calculate buffer sizes from controller.desiredSize
        // desiredSize = highWaterMark - currentBufferSize
        // So: currentBufferSize = highWaterMark - desiredSize
        const demuxerBufferSize = demuxerController
          ? (20 - (demuxerController.desiredSize ?? 0))
          : 0;

        const decoderBufferSize = decoderController
          ? (10 - (decoderController.desiredSize ?? 0))
          : 0;

        const renderBufferSize = renderController
          ? (5 - (renderController.desiredSize ?? 0))
          : 0;

        const encoderBufferSize = encoderController
          ? (10 - (encoderController.desiredSize ?? 0))
          : 0;

        const progress: TranscodeProgress = {
          frameCount,
          elapsedSeconds,
          fps,
          demuxer: {
            bufferSize: Math.max(0, demuxerBufferSize),
          },
          decoder: {
            decodeQueueSize: decoder?.decodeQueueSize ?? 0,
            bufferSize: Math.max(0, decoderBufferSize),
          },
          render: {
            bufferSize: Math.max(0, renderBufferSize),
          },
          encoder: {
            encodeQueueSize: encoder?.encodeQueueSize ?? 0,
            bufferSize: Math.max(0, encoderBufferSize),
          },
        };

        options.onProgress(progress);
      }
    },

    close() {
      // Don't finalize muxer here - caller needs to add audio chunks first
      console.log('All video frames written to muxer');
    },

    abort(reason) {
      console.error('Muxer writer aborted:', reason);
    }
  });
}

/**
 * Progress callback information
 */
export interface TranscodeProgress {
  frameCount: number;
  elapsedSeconds: number;
  fps: number;
  demuxer: {
    bufferSize: number;  // Chunks from demuxer → decoder
  };
  decoder: {
    decodeQueueSize: number;
    bufferSize: number;  // TransformStream output buffer (decoded frames)
  };
  render: {
    bufferSize: number;
  };
  encoder: {
    encodeQueueSize: number;
    bufferSize: number;
  };
}

export interface TranscodePipelineOptions {
  onProgress?: (progress: TranscodeProgress) => void;
}

/**
 * Transcode using Web Streams pipeline with true streaming from web-demuxer
 */
export async function transcodePipeline(
  file: File,
  options?: TranscodePipelineOptions
): Promise<Blob> {
  console.log('Starting transcode with Streams Pipeline pattern (segment-based streaming)');

  // Step 1: Set up demuxer to get metadata
 // const demuxer = new MP4Demuxer(file);

  const demuxer = new WebDemuxer({
    wasmFilePath: "https://cdn.jsdelivr.net/npm/web-demuxer@latest/dist/wasm-files/web-demuxer.wasm",
  });


  await demuxer.load(<File> file);

  const mediaInfo = await demuxer.getMediaInfo();
  const videoTrack = mediaInfo.streams.filter((s)=>s.codec_type_string === 'video')[0];
  const audioTrack = mediaInfo.streams.filter((s)=>s.codec_type_string === 'audio')[0];

  async function getChunks(type, start=0, end=undefined){

    const reader = demuxer.read(type, start, end).getReader()

    const chunks = [];

     return new Promise(function(resolve){

      reader.read().then(async function processPacket({ done, value }) {

        if (value && value.timestamp < 0)  return reader.read().then(processPacket)
        if(value) chunks.push(value);
        if(done) return resolve(chunks);
        return reader.read().then(processPacket)
      });

    });

   }

  
  const duration = videoTrack.duration;
  const width = videoTrack.width;
  const height = videoTrack.height;



  console.log(`Video: ${duration}s, will stream in 30s segments`);

  // Step 2: Extract audio chunks (pass-through)
  let audioChunks: EncodedAudioChunk[] | null = null;
  let audioConfig = null;
  try {
    audioChunks = <EncodedAudioChunk[]> await getChunks('audio')
    audioConfig = {
      codec: audioTrack.codec_string,
      sampleRate: audioTrack.sample_rate,
      numberOfChannels: audioTrack.channels
    }
    console.log(`Found ${audioChunks.length} audio chunks`);
  } catch (e) {
    console.log('No audio track found, skipping...');
  }


  const storage = new InMemoryStorage();

  // Step 3: Set up muxer
  const target = new StreamTarget({
    onData: (data: Uint8Array, position: number) => {
      storage.write(data, position);
    },
    chunked: true,
    chunkSize: 1024*1024*10
});
  const muxerOptions: any = {
    target,
    video: {
      codec: 'avc',
      width,
      height,
    },
    firstTimestampBehavior: 'offset',
    fastStart: 'in-memory',
  };

  if (audioConfig) {
    muxerOptions.audio = {
      codec: 'aac',
      numberOfChannels: audioConfig.numberOfChannels,
      sampleRate: audioConfig.sampleRate,
    };
  }

  const muxer = new Muxer(muxerOptions);

  // Step 4: Configure encoder
  const bitrate = getBitrate(width, height, 30, 'good');

  const videoEncoderConfig: VideoEncoderConfig = {
    codec: 'avc1.42001f',
    width: width,
    height: height,
    bitrate: Math.round(bitrate),
    framerate: 24,
  };

  // Step 5: Create the pipeline with true streaming!
  // WebDemuxerStream → Decoder → Render → Encoder → Muxer

  const videoDecoderConfig = {
    description: videoTrack.extradata,
    codec: videoTrack.codec_string
  };


  // Get the native ReadableStream from web-demuxer
  // This handles keyframes, GOP boundaries, and streaming properly
  const chunkStream = createWebDemuxerStream(demuxer, 'video', 0);

  // Build the pipeline with automatic backpressure
  const encodedStream = chunkStream
    .pipeThrough(new DemuxerTrackingStream())       // Track demuxer → decoder buffer
    .pipeThrough(new VideoDecoderStream(videoDecoderConfig))
    .pipeThrough(new VideoRenderStream())
    .pipeThrough(new VideoEncoderStream(videoEncoderConfig));

  // Step 6: Pipe to muxer writer
  const writer = createMuxerWriter(muxer, {
    onProgress: options?.onProgress
  });

  await encodedStream.pipeTo(writer);

  // Step 7: Add audio chunks (pass-through)
  if (audioChunks && audioConfig) {
    console.log('Adding audio chunks...');
    for (const audio_chunk of audioChunks) {
      muxer.addAudioChunk(audio_chunk);
    }
  }

  // Step 8: Finalize
  muxer.finalize();

  const blob = storage.toBlob('video/mp4');

  console.log(`Transcoding complete! Output size: ${blob.size} bytes`);

  return blob;
}
