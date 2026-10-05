import { MediaStreamTrackProcessor } from 'webcodecs-utils';
import { VideoEncoderStream } from './video-encoder-stream';
import { AudioEncoderStream } from './audio-encoder-stream';
import {
  CATALOG_TRACK, VIDEO_TRACK, AUDIO_TRACK, PRIORITY,
  catalogTrackInfo, mediaTrackInfo, videoRendition, audioRendition, wallClock, MediaClock, anchorClock, type Catalog,
} from './hang';
import { createVideoWriter, createAudioWriter } from './hang-writers';

export { VIDEO_TRACK, AUDIO_TRACK };

export class MoqPublisher {
  private videoTrack: MediaStreamTrack;
  private audioTrack: MediaStreamTrack;
  private videoConfig: VideoEncoderConfig;
  private audioConfig: AudioEncoderConfig;
  private toTimestamp: (micros: number) => any;
  readonly catalogMoqTrack: any;
  private videoMoqTrack: any;
  private audioMoqTrack: any;
  private abortController: AbortController | null = null;
  videoFrameCount = 0;
  audioFrameCount = 0;

  constructor(
    videoTrack: MediaStreamTrack,
    audioTrack: MediaStreamTrack,
    broadcast: any,
    videoConfig: VideoEncoderConfig,
    audioConfig: AudioEncoderConfig,
    // @moq/net frames carry their own timestamp, e.g. (us) => Moq.Time.Timestamp.fromMicros(us)
    toTimestamp: (micros: number) => any
  ) {
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
    this.videoConfig = videoConfig;
    this.audioConfig = audioConfig;
    this.toTimestamp = toTimestamp;

    // Create tracks up front: @moq/net refuses a subscribe to a track that doesn't exist yet
    this.catalogMoqTrack = broadcast.createTrack(CATALOG_TRACK, catalogTrackInfo());
    this.videoMoqTrack = broadcast.createTrack(VIDEO_TRACK, mediaTrackInfo(PRIORITY.video));
    this.audioMoqTrack = broadcast.createTrack(AUDIO_TRACK, mediaTrackInfo(PRIORITY.audio));
  }

  // Encode one frame to read the encoder's decoderConfig.description (avcC for H.264, none for VP8/VP9)
  static async getDescription(videoTrack: MediaStreamTrack, config: VideoEncoderConfig): Promise<Uint8Array | undefined> {
    const processor = new MediaStreamTrackProcessor({ track: videoTrack });
    const reader = processor.readable.getReader();

    // Read one frame
    const { value: frame } = await reader.read();
    reader.releaseLock();

    if (!frame) {
      return undefined;
    }

    // Encode the frame to get metadata
    return new Promise((resolve) => {
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          const description = meta?.decoderConfig?.description;
          resolve(description ? new Uint8Array(description as ArrayBuffer) : undefined);
        },
        error: (e) => {
          console.error('Test encoder error:', e);
          resolve(undefined);
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

  // Publish the Hang catalog: one group holding one frame of UTF-8 JSON
  publishCatalog(videoDescription?: Uint8Array): Catalog {
    const catalog: Catalog = {
      clock: wallClock(),
      video: { renditions: { [VIDEO_TRACK]: videoRendition(this.videoConfig, videoDescription) } },
      audio: { renditions: { [AUDIO_TRACK]: audioRendition(this.audioConfig) } },
    };

    const group = this.catalogMoqTrack.appendGroup();
    group.writeJson(catalog);
    group.close();

    return catalog;
  }

  async start(): Promise<void> {
    if (this.abortController) {
      throw new Error('Already publishing');
    }

    this.abortController = new AbortController();

    // Each track has its own clock: Chrome stamps camera and microphone frames on different clocks
    const videoClock = new MediaClock();
    const audioClock = new MediaClock();

    // Video pipeline
    const videoProcessor = new MediaStreamTrackProcessor({ track: this.videoTrack });
    const videoEncoderStream = new VideoEncoderStream(this.videoConfig);

    videoProcessor.readable
      .pipeThrough(anchorClock<VideoFrame>(videoClock))
      .pipeThrough(videoEncoderStream)
      .pipeTo(createVideoWriter(this.videoMoqTrack, this.toTimestamp, () => this.videoFrameCount++, (ts) => videoClock.toPts(ts)), {
        signal: this.abortController.signal
      });

    // Audio pipeline
    const audioProcessor = new MediaStreamTrackProcessor({ track: this.audioTrack });
    const audioEncoderStream = new AudioEncoderStream(this.audioConfig);

    audioProcessor.readable
      .pipeThrough(anchorClock<AudioData>(audioClock))
      .pipeThrough(audioEncoderStream)
      .pipeTo(createAudioWriter(this.audioMoqTrack, this.toTimestamp, () => this.audioFrameCount++, (ts) => audioClock.toPts(ts)), {
        signal: this.abortController.signal
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
