import { MP4Demuxer, getBitrate } from 'webcodecs-utils';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/**
 * Transcoding implementation - Promise pattern
 * (How free.upscaler does it)
 *
 * This pattern uses Promise arrays with callback queues to manage async decode/encode operations.
 * Key characteristics:
 * - Sequential frame processing (await each frame in order)
 * - Sliding window buffer for decoder (20 frames ahead)
 * - Low memory usage
 * - Simple to understand and debug
 */

/**
 * Placeholder render function - returns the frame unchanged
 * TODO: Add WebGPU filter or other video processing here
 */
async function renderFrame(frame: VideoFrame): Promise<VideoFrame> {
  // For now, just return the original frame
  // Later: Add WebGPU processing, filters, upscaling, etc.
  return frame;
}

export async function transcodePromise(file: File): Promise<Blob> {
  console.log('Starting transcode with Promise pattern');

  // Step 1: Demux the input file
  const demuxer = new MP4Demuxer(file);
  await demuxer.load();

  const trackData = demuxer.getTracks();
  const videoDecoderConfig = demuxer.getVideoDecoderConfig();
  const videoChunks = await demuxer.extractSegment('video', 0, trackData.duration);

  console.log(`Processing ${videoChunks.length} video chunks`);

  // Step 2: Extract audio chunks (pass-through, no re-encoding)
  let audioChunks: EncodedAudioChunk[] | null = null;
  let audioConfig = null;
  try {
    audioChunks = await demuxer.extractSegment('audio', 0, trackData.duration);
    audioConfig = demuxer.getAudioDecoderConfig();
    console.log(`Found ${audioChunks.length} audio chunks`);
  } catch (e) {
    console.log('No audio track found, skipping...');
  }

  // Step 3: Set up muxer for output
  const target = new ArrayBufferTarget();

  const muxerOptions: any = {
    target,
    video: {
      codec: 'avc',
      width: trackData.video.codedWidth,
      height: trackData.video.codedHeight,
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

  // Step 4: Configure video encoder
  const bitrate = getBitrate(trackData.video.codedWidth, trackData.video.codedHeight, 30, 'good');

  console.log(bitrate)

  const videoEncoderConfig: VideoEncoderConfig = {
    codec: 'avc1.42001f', // Baseline profile
    width: trackData.video.codedWidth,
    height: trackData.video.codedHeight,
    bitrate: Math.round(bitrate),
    framerate: trackData.video.frameRate || 30,
  };

  // Step 5: Set up decoder and encoder with callback queues
  const decode_callbacks: Array<(frame: VideoFrame) => void> = [];
  const encode_callbacks: Array<() => void> = [];

  const decoder = new VideoDecoder({
    output(frame) {
      const callback = decode_callbacks.shift();
      if (callback) callback(frame);
    },
    error(e) {
      console.error('Decoder error:', e);
      throw e;
    },
  });

  const encoder = new VideoEncoder({
    output(chunk, meta) {
      const callback = encode_callbacks.shift();
      muxer.addVideoChunk(chunk, meta);
      if (callback) callback();
    },
    error(e) {
      console.error('Encoder error:', e);
      throw e;
    },
  });

  encoder.configure(videoEncoderConfig);
  decoder.configure(videoDecoderConfig);

  // Step 6: Pre-fill decoder buffer with first 20 chunks
  const decode_promises: Array<Promise<VideoFrame>> = [];
  const decoder_buffer_length = 20;

  for (let i = 0; i < Math.min(videoChunks.length, decoder_buffer_length); i++) {
    const chunk = videoChunks[i];

    decode_promises.push(
      new Promise<VideoFrame>((resolve) => {
        decode_callbacks.push((frame) => resolve(frame));
      })
    );

    decoder.decode(chunk);
  }

  // Step 7: Process frames sequentially with sliding window
  const encode_promises: Array<Promise<void>> = [];
  const startTime = performance.now();

  for (let i = 0; i < decode_promises.length; i++) {
    const decode_promise = decode_promises[i];
    const source_chunk = videoChunks[i];

    // Await the decoded frame
    const frame = await decode_promise;

    // Process the frame (placeholder - currently just returns the same frame)
    const processed_frame = await renderFrame(frame);

    // Create encode promise
    encode_promises.push(
      new Promise<void>((resolve) => {
        encode_callbacks.push(() => resolve());
      })
    );

    // Wait if encoder queue is too large
    if (encoder.encodeQueueSize >= 20) {
      await new Promise<void>((resolve) => {
        function check() {
          if (encoder.encodeQueueSize < 20) {
            resolve();
          } else {
            setTimeout(check, 100);
          }
        }
        check();
      });
    }

    // Encode the frame
    encoder.encode(processed_frame, { keyFrame: source_chunk.type === 'key' });

    if(i+1 === videoChunks.length){
      if (encoder.state === 'configured') await encoder.flush();
    }

    // Close frames to free memory
    frame.close();
    if (processed_frame !== frame) {
      processed_frame.close();
    }



    // Add next chunk to decoder buffer (sliding window)
    if (i + decoder_buffer_length < videoChunks.length) {
      const next_chunk = videoChunks[i + decoder_buffer_length];

      decode_promises.push(
        new Promise<VideoFrame>((resolve) => {
          decode_callbacks.push((frame) => resolve(frame));
        })
      );

      decoder.decode(next_chunk);

      if(i+decoder_buffer_length + 1 == videoChunks.length){
        console.log("Flush decoder")
        await decoder.flush();
      }

  


    }

    // Progress logging
    if (i % 30 === 0) {
      const progress = ((i / videoChunks.length) * 100).toFixed(1);
      const elapsed = performance.now() - startTime;
      const rate = i / (elapsed / 1000); // frames per second
      const eta = ((videoChunks.length - i) / rate).toFixed(1);
      console.log(`Progress: ${progress}% (${i}/${videoChunks.length}) - ETA: ${eta}s`);
    }
  }

  // Step 8: Wait for all encode operations to complete
  console.log('Waiting for all encode promises to resolve...');
  for (const encode_promise of encode_promises) {
    await encode_promise;
  }

  console.log('All frames encoded');

  // Step 9: Add audio chunks (pass-through)
  if (audioChunks && audioConfig) {
    console.log('Adding audio chunks...');
    for (const audio_chunk of audioChunks) {
      muxer.addAudioChunk(audio_chunk);
    }
  }

  // Step 10: Finalize and cleanup
  muxer.finalize();

  const arrayBuffer = target.buffer;
  const blob = new Blob([arrayBuffer], { type: 'video/mp4' });

  console.log(`Transcoding complete! Output size: ${blob.size} bytes`);

  // Cleanup
  try {
    if(encoder.state !== 'closed') encoder.close();
    if (decoder.state !== 'closed') decoder.close();
  } catch (e) {
    console.error('Error closing encoder/decoder:', e);
  }

  return blob;
}
