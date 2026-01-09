export class VideoEncoderStream extends TransformStream<VideoFrame, { chunk: EncodedVideoChunk; meta: EncodedVideoChunkMetadata }> {
  constructor(config: VideoEncoderConfig) {
    let encoder: VideoEncoder;
    let frameIndex = 0;

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
