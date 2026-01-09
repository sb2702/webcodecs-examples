export interface MoqFrame {
  timestamp: number;
  type?: 'key' | 'delta';
  data: Uint8Array;
}

export class MoqSubscriber {
  private videoTrack: any;
  private audioTrack: any;
  private videoDecoder: VideoDecoder | null = null;
  private audioDecoder: AudioDecoder | null = null;
  private catalog: any;

  constructor(catalog: any, videoTrack: any, audioTrack: any) {
    this.catalog = catalog;
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
  }

  async startVideo(onFrame: (frame: VideoFrame) => void): Promise<void> {
    // Get video config from catalog
    const videoRendition = Object.values(this.catalog.video.renditions)[0] as any;

    this.videoDecoder = new VideoDecoder({
      output: onFrame,
      error: (e) => console.error('Video decoder error:', e),
    });

    this.videoDecoder.configure({
      codec: videoRendition.codec,
      codedWidth: videoRendition.codedWidth,
      codedHeight: videoRendition.codedHeight,
    });

    // Start reading video frames
    (async () => {
      try {
        while (true) {
          const group = await this.videoTrack.nextGroup();
          if (!group) break;

          const frameData = await group.readFrame();
          const frame = this.parseVideoFrame(frameData);

          const chunk = new EncodedVideoChunk({
            timestamp: frame.timestamp,
            type: frame.type!,
            data: frame.data,
          });

          this.videoDecoder!.decode(chunk);
        }
      } catch (error) {
        console.error('Video read error:', error);
      }
    })();
  }

  async startAudio(onData: (audioData: AudioData) => void): Promise<void> {
    // Get audio config from catalog
    const audioRendition = Object.values(this.catalog.audio.renditions)[0] as any;

    this.audioDecoder = new AudioDecoder({
      output: onData,
      error: (e) => console.error('Audio decoder error:', e),
    });

    this.audioDecoder.configure({
      codec: audioRendition.codec,
      sampleRate: audioRendition.sampleRate,
      numberOfChannels: audioRendition.numberOfChannels,
    });

    // Start reading audio frames
    (async () => {
      try {
        while (true) {
          const group = await this.audioTrack.nextGroup();
          if (!group) break;

          const frameData = await group.readFrame();
          const frame = this.parseAudioFrame(frameData);

          const chunk = new EncodedAudioChunk({
            timestamp: frame.timestamp,
            type: 'key',
            data: frame.data,
          });

          this.audioDecoder!.decode(chunk);
        }
      } catch (error) {
        console.error('Audio read error:', error);
      }
    })();
  }

  private parseVideoFrame(buffer: Uint8Array): MoqFrame {
    // Hang format: [timestamp (8 bytes)] [type (1 byte)] [data]
    const view = new DataView(buffer.buffer, buffer.byteOffset);

    const timestamp = Number(view.getBigUint64(0, true));
    const type = buffer[8] === 1 ? 'key' : 'delta';
    const data = buffer.slice(9);

    return { timestamp, type, data };
  }

  private parseAudioFrame(buffer: Uint8Array): MoqFrame {
    // Hang format: [timestamp (8 bytes)] [data]
    const view = new DataView(buffer.buffer, buffer.byteOffset);

    const timestamp = Number(view.getBigUint64(0, true));
    const data = buffer.slice(8);

    return { timestamp, data };
  }

  stop(): void {
    if (this.videoDecoder && this.videoDecoder.state !== 'closed') {
      this.videoDecoder.close();
    }
    if (this.audioDecoder && this.audioDecoder.state !== 'closed') {
      this.audioDecoder.close();
    }
  }
}
