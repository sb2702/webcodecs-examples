import { MediaStreamTrackProcessor, getSampleRate } from 'webcodecs-utils';
import { VideoEncoderStream } from '../webcam-recording/video-encoder-stream';
import { AudioEncoderStream } from '../webcam-recording/audio-encoder-stream';
import { isAACSupported } from '../webcam-recording/audio-codec-support';

export class MoqPublisher {
  private videoTrack: MediaStreamTrack;
  private audioTrack: MediaStreamTrack;
  private broadcast: any;
  private codec: 'avc' | 'vp8' | 'vp9';
  private videoMoqTrack: any = null;
  private audioMoqTrack: any = null;
  private abortController: AbortController | null = null;

  constructor(videoTrack: MediaStreamTrack, audioTrack: MediaStreamTrack, broadcast: any, codec: 'avc' | 'vp8' | 'vp9' = 'vp8') {
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
    this.broadcast = broadcast;
    this.codec = codec;
  }

  static async getDescription(videoTrack: MediaStreamTrack, codec: 'avc' | 'vp8' | 'vp9'): Promise<string> {
    if (codec === 'vp8' || codec === 'vp9') {
      return ''; // VP8/VP9 don't need description
    }

    const videoSettings = videoTrack.getSettings();
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
          }
        },
        error: (e) => {
          console.error('Test encoder error:', e);
          resolve('');
        },
      });

      const bitrate = 1000000;
      encoder.configure({
        codec: 'avc1.42001f',
        width: videoSettings.width!,
        height: videoSettings.height!,
        bitrate,
      });

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

    const videoSettings = this.videoTrack.getSettings();
    const audioSettings = this.audioTrack.getSettings();
    const sampleRate = await getSampleRate(this.audioTrack);

    if (!audioSettings.channelCount) {
      audioSettings.channelCount = 1;
    }

    const useAAC = await isAACSupported(sampleRate, audioSettings.channelCount);

    // Video pipeline
    const videoProcessor = new MediaStreamTrackProcessor({ track: this.videoTrack });
    const videoEncoderStream = new VideoEncoderStream(
      videoSettings.width!,
      videoSettings.height!,
      videoSettings.frameRate || 30,
      this.codec
    );

    // Audio pipeline
    const audioProcessor = new MediaStreamTrackProcessor({ track: this.audioTrack });
    const audioEncoderStream = new AudioEncoderStream(
      sampleRate!,
      Math.min(audioSettings.channelCount!, 2)
    );

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
