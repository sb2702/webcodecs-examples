import { MediaStreamTrackProcessor, getSampleRate } from 'webcodecs-utils';
import { VideoEncoderStream } from './video-encoder-stream';
import { AudioEncoderStream } from './audio-encoder-stream';

export class MoqPublisher {
  private videoTrack: MediaStreamTrack;
  private audioTrack: MediaStreamTrack;
  private broadcast: any;
  private videoConfig: VideoEncoderConfig;
  private audioConfig: AudioEncoderConfig;
  private videoMoqTrack: any = null;
  private audioMoqTrack: any = null;
  private abortController: AbortController | null = null;

  constructor(
    videoTrack: MediaStreamTrack,
    audioTrack: MediaStreamTrack,
    broadcast: any,
    videoConfig: VideoEncoderConfig,
    audioConfig: AudioEncoderConfig
  ) {
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
    this.broadcast = broadcast;
    this.videoConfig = videoConfig;
    this.audioConfig = audioConfig;
  }

  static async getDescription(videoTrack: MediaStreamTrack, config: VideoEncoderConfig): Promise<string> {
    const processor = new MediaStreamTrackProcessor({ track: videoTrack });
    const reader = processor.readable.getReader();

    // Read one frame
    const { value: frame } = await reader.read();
    reader.releaseLock();

    if (!frame) {
      return '';
    }

    // Encode the frame to get metadata
    return new Promise((resolve) => {
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          if (meta?.decoderConfig?.description) {
            const description = new Uint8Array(meta.decoderConfig.description);
            const base64 = btoa(String.fromCharCode(...description));
            resolve(base64);
          } else {
            resolve(''); // VP8/VP9 don't have description
          }
        },
        error: (e) => {
          console.error('Test encoder error:', e);
          resolve('');
        },
      });

      encoder.configure(config);
      encoder.encode(frame, { keyFrame: true });
      encoder.flush().then(() => {
        encoder.close();
        frame.close();
      });
    });
  }

  async start(): Promise<void> {
    if (this.abortController) {
      throw new Error('Already publishing');
    }

    // Video pipeline
    const videoProcessor = new MediaStreamTrackProcessor({ track: this.videoTrack });
    const videoEncoderStream = new VideoEncoderStream(this.videoConfig);

    // Audio pipeline
    const audioProcessor = new MediaStreamTrackProcessor({ track: this.audioTrack });
    const audioEncoderStream = new AudioEncoderStream(this.audioConfig);

    this.abortController = new AbortController();

    // Listen for track requests
    (async () => {
      while (true) {
        const trackRequest = await this.broadcast.requested();
        const requestedTrack = trackRequest.track;

        if (requestedTrack.name === 'video' && !this.videoMoqTrack) {
          this.videoMoqTrack = requestedTrack;

          // Start video pipeline
          videoProcessor.readable
            .pipeThrough(videoEncoderStream)
            .pipeTo(this.createVideoWriter(this.videoMoqTrack), {
              signal: this.abortController.signal
            });
        } else if (requestedTrack.name === 'audio' && !this.audioMoqTrack) {
          this.audioMoqTrack = requestedTrack;

          // Start audio pipeline
          audioProcessor.readable
            .pipeThrough(audioEncoderStream)
            .pipeTo(this.createAudioWriter(this.audioMoqTrack), {
              signal: this.abortController.signal
            });
        }
      }
    })();
  }

  private createVideoWriter(moqTrack: any): WritableStream<{ chunk: EncodedVideoChunk; meta: EncodedVideoChunkMetadata }> {
    return new WritableStream({
      async write(value) {
        const group = moqTrack.appendGroup();

        // Hang format: [timestamp (8 bytes)] [type (1 byte)] [data]
        const chunkData = new Uint8Array(value.chunk.byteLength);
        value.chunk.copyTo(chunkData);

        const buffer = new Uint8Array(8 + 1 + chunkData.byteLength);
        const view = new DataView(buffer.buffer);

        // Write timestamp as 64-bit integer (microseconds)
        view.setBigUint64(0, BigInt(value.chunk.timestamp), true);

        // Write chunk type (1 = key, 0 = delta)
        buffer[8] = value.chunk.type === 'key' ? 1 : 0;

        // Write chunk data
        buffer.set(chunkData, 9);

        group.writeFrame(buffer);
        group.close();
      }
    });
  }

  private createAudioWriter(moqTrack: any): WritableStream<EncodedAudioChunk> {
    return new WritableStream({
      async write(chunk) {
        const group = moqTrack.appendGroup();

        // Hang format: [timestamp (8 bytes)] [data]
        const chunkData = new Uint8Array(chunk.byteLength);
        chunk.copyTo(chunkData);

        const buffer = new Uint8Array(8 + chunkData.byteLength);
        const view = new DataView(buffer.buffer);

        // Write timestamp as 64-bit integer (microseconds)
        view.setBigUint64(0, BigInt(chunk.timestamp), true);

        // Write chunk data
        buffer.set(chunkData, 8);

        group.writeFrame(buffer);
        group.close();
      }
    });
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  isPublishing(): boolean {
    return this.abortController !== null;
  }
}
