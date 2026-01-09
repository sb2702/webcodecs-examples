import { getBitrate, getCodecString } from 'webcodecs-utils';

export class VideoEncoderStream extends TransformStream<VideoFrame, { chunk: EncodedVideoChunk; meta: EncodedVideoChunkMetadata }> {
  constructor(width: number, height: number, fps: number = 30, codec: 'avc' | 'vp8' | 'vp9' = 'vp8') {
    let encoder: VideoEncoder;
    let frameIndex = 0;

    const bitrate = getBitrate(width, height, fps, 'good');
    const config: VideoEncoderConfig = {
      codec: getCodecString(codec, width, height, bitrate),
      width,
      height,
      bitrate: Math.round(bitrate),
      framerate: fps,
    };

    super(
      {
        start(controller) {
          encoder = new VideoEncoder({
            output: (chunk, meta) => {
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
          // Check encoder queue backpressure
          while (encoder.encodeQueueSize >= 20) {
            await new Promise((r) => setTimeout(r, 10));
          }

          // Check downstream backpressure
          while (controller.desiredSize !== null && controller.desiredSize < 0) {
            await new Promise((r) => setTimeout(r, 10));
          }

          // Encode with keyframe every 60 frames
          encoder.encode(frame, { keyFrame: frameIndex % 60 === 0 });
          frame.close();
          frameIndex++;
        },

        async flush() {
          await encoder.flush();
          if (encoder.state !== 'closed') encoder.close();
        },
      },
      { highWaterMark: 10 }
    );
  }
}
