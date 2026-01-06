import { MP4Demuxer, getBitrate } from 'webcodecs-utils';
import { WebDemuxer } from "web-demuxer";



import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

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

/**
 * TransformStream that decodes video chunks into frames
 * Handles decoder warm-up and maintains buffer
 */

// Global references to access queue sizes and buffer state
let decoder: VideoDecoder;
let encoder: VideoEncoder;
let decoderController: TransformStreamDefaultController<VideoFrame>;
let renderController: TransformStreamDefaultController<VideoFrame>;
let encoderController: TransformStreamDefaultController<{ chunk: EncodedVideoChunk; meta: EncodedVideoChunkMetadata }>;

class VideoDecoderStream extends TransformStream<EncodedVideoChunk, VideoFrame> {
  constructor(config: VideoDecoderConfig) {
    // Declare variables in closure scope

    let warmupChunks: EncodedVideoChunk[] = [];
    let warmupComplete = false;
    const WARMUP_SIZE = 20;

    super(
      {
        start(controller) {
          // Save controller reference for progress reporting
          decoderController = controller;

          decoder = new VideoDecoder({
            output: (frame) => {
              // Directly enqueue to TransformStream buffer!
              controller.enqueue(frame);
            },
            error: (e) => {
              console.error('Decoder error:', e);
              controller.error(e);
            },
          });

          decoder.configure(config);
        },

        async transform(chunk, controller) {
          // Warm-up phase: collect first N chunks before starting output
          if (!warmupComplete) {
            warmupChunks.push(chunk);

            if (warmupChunks.length >= WARMUP_SIZE) {
              // Decode all warmup chunks at once
              warmupChunks.forEach((c) => decoder.decode(c));
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

          // Now it's safe to decode
          // Frame will be enqueued automatically by decoder.output callback
          decoder.decode(chunk);
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
 */
class VideoRenderStream extends TransformStream<VideoFrame, VideoFrame> {
  constructor() {
    super(
      {
        start(controller){
          // Save controller reference for progress reporting
          renderController = controller;
        },

        async transform(frame, controller) {
          // Placeholder: currently just passes through
          // TODO: Add WebGPU processing, filters, etc.
          const processed = frame;
          controller.enqueue(processed);
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
 */
class VideoEncoderStream extends TransformStream<
  VideoFrame,
  { chunk: EncodedVideoChunk; meta: EncodedVideoChunkMetadata }
> {
  constructor(config: VideoEncoderConfig) {
    // Declare variables in closure scope
  

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

        async transform(frame, controller) {

          // Backpressure checks BEFORE encoding:
          // 1. Check encoder's internal queue
          while (encoder.encodeQueueSize >= 20) {
            await new Promise((r) => setTimeout(r, 10));
          }

          // 2. Check downstream backpressure (TransformStream buffer)
          while (controller.desiredSize !== null && controller.desiredSize < 0) {
            await new Promise((r) => setTimeout(r, 10));
          }

          // Now it's safe to encode
          // Chunk will be enqueued automatically by encoder.output callback
          encoder.encode(frame, { keyFrame: true }); // TODO: Handle keyframes properly
          frame.close();
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
 * Progress callback information
 */
export interface TranscodeProgress {
  frameCount: number;
  elapsedSeconds: number;
  fps: number;
  decoder: {
    decodeQueueSize: number;
    bufferSize: number;  // TransformStream output buffer
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

    console.log("Audio chunks");
    console.log(audioChunks)
    audioConfig = {
      codec: audioTrack.codec_string,
      sampleRate: audioTrack.sample_rate,
      numberOfChannels: audioTrack.channels
    }
    console.log(`Found ${audioChunks.length} audio chunks`);
  } catch (e) {
    console.log('No audio track found, skipping...');
  }

  // Step 3: Set up muxer
  const target = new ArrayBufferTarget();
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

  console.log('Video decoder config:', videoDecoderConfig);

  // Get the native ReadableStream from web-demuxer
  // This handles keyframes, GOP boundaries, and streaming properly
  const chunkStream = createWebDemuxerStream(demuxer, 'video', 0);

  // Build the pipeline with automatic backpressure
  const encodedStream = chunkStream
    .pipeThrough(new VideoDecoderStream(videoDecoderConfig))
    .pipeThrough(new VideoRenderStream())
    .pipeThrough(new VideoEncoderStream(videoEncoderConfig));

  // Step 6: Consume the pipeline and feed to muxer
  const reader = encodedStream.getReader();
  const startTime = performance.now();
  let frameCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      muxer.addVideoChunk(value.chunk, value.meta);
      frameCount++;

      // Progress reporting with detailed pipeline state
      if (frameCount % 30 === 0 && options?.onProgress) {
        const elapsed = performance.now() - startTime;
        const elapsedSeconds = elapsed / 1000;
        const fps = frameCount / elapsedSeconds;

        // Calculate buffer sizes from controller.desiredSize
        // desiredSize = highWaterMark - currentBufferSize
        // So: currentBufferSize = highWaterMark - desiredSize
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
    }
  } finally {
    reader.releaseLock();
  }

  console.log('All frames encoded');

  // Step 7: Add audio chunks (pass-through)
  if (audioChunks && audioConfig) {
    console.log('Adding audio chunks...');
    for (const audio_chunk of audioChunks) {
      muxer.addAudioChunk(audio_chunk);
    }
  }

  // Step 8: Finalize
  muxer.finalize();

  const arrayBuffer = target.buffer;
  const blob = new Blob([arrayBuffer], { type: 'video/mp4' });

  console.log(`Transcoding complete! Output size: ${blob.size} bytes`);

  return blob;
}
