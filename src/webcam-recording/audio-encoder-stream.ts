import { isAACSupported } from './audio-codec-support';

export class AudioEncoderStream extends TransformStream<AudioData, EncodedAudioChunk> {
  constructor(sampleRate: number, numberOfChannels: number) {
    let encoder: AudioEncoder;

    super(
      {
        async start(controller) {

          
          const useAAC = await isAACSupported(sampleRate, numberOfChannels);

          console.log("USe AAC", useAAC)
          const config: AudioEncoderConfig = {
            codec: useAAC ? 'mp4a.40.2' : 'opus',
            sampleRate,
            numberOfChannels,
            bitrate: 128000,
          };

          console.log("Config", config);
          
          encoder = new AudioEncoder({
            output: (chunk) => {
              controller.enqueue(chunk);
            },
            error: (e) => {
              console.error('Audio encoder error:', e);
              controller.error(e);
            },
          });

          encoder.configure(config);
        },

        async transform(audioData, controller) {
          // Check encoder queue backpressure
          while (encoder.encodeQueueSize >= 20) {
            await new Promise((r) => setTimeout(r, 10));
          }

          // Check downstream backpressure
          while (controller.desiredSize !== null && controller.desiredSize < 0) {
            await new Promise((r) => setTimeout(r, 10));
          }

          encoder.encode(audioData);
          audioData.close();
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
