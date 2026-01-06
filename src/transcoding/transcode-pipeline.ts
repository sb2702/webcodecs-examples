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

let decoder: VideoDecoder;
let encoder: VideoEncoder;

class VideoDecoderStream extends TransformStream<EncodedVideoChunk, VideoFrame> {
  constructor(config: VideoDecoderConfig) {
    // Declare variables in closure scope

    let warmupChunks: EncodedVideoChunk[] = [];
    let warmupComplete = false;
    const WARMUP_SIZE = 20;

    super(
      {
        start(controller) {

          setInterval(function(){

            console.log(`Decoder controller size ${controller.desiredSize}`)
    
          }, 200);

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
          setInterval(function(){

            console.log(`render controller size ${controller.desiredSize}`)
          }, 200)
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


          setInterval(function(){

            console.log(`Encoder controller size ${controller.desiredSize}`)
          }, 200)


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
 * Transcode using Web Streams pipeline with segment-based streaming
 */
export async function transcodePipeline(file: File): Promise<Blob> {
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
        if(value) chunks.push(value);
        if(done) return resolve(chunks);
        return reader.read().then(processPacket)
      });

    });

   }



  console.log(audioTrack);

  console.log(videoTrack);
  
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

  // Step 5: Create the pipeline with segment-based streaming!
  // MP4DemuxerStream → Decoder → Render → Encoder → Muxer

  // Create streaming demuxer (loads 30s segments on-demand)
 

  const chunks: EncodedVideoChunk[] = [];
  
  const demuxReader = demuxer.read('video', 0).getReader();


  const videoDecoderConfig = {
    description: videoTrack.extradata,
    codec: videoTrack.codec_string
  }

  console.log(videoTrack);
/*
  decoder.configure({
    codec: videoTrack.codec_string
  })

*/
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

      if(frameCount%30 == 0){
    //    console.log(`Frame count ${frameCount}`)


      }



      // Progress logging (estimate based on duration since we don't know total chunks upfront)
      if (frameCount % 30 === 0) {
        if(encoder && decoder){
          console.log(`Encoder queue size ${encoder.encodeQueueSize}`);
          console.log(`Decoder decode size ${decoder.decodeQueueSize}`)
        }

        const elapsed = performance.now() - startTime;
        const rate = frameCount / (elapsed / 1000);
        console.log(`Progress: ${frameCount} frames, ${(elapsed / 1000).toFixed(1)}s elapsed, ${rate.toFixed(1)} fps`);
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
