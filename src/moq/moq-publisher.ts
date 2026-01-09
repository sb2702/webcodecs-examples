import { MediaStreamTrackProcessor, getSampleRate } from 'webcodecs-utils';
import { VideoEncoderStream } from '../webcam-recording/video-encoder-stream';
import { AudioEncoderStream } from '../webcam-recording/audio-encoder-stream';
import { isAACSupported } from '../webcam-recording/audio-codec-support';

export class MoqPublisher {
  private videoTrack: MediaStreamTrack;
  private audioTrack: MediaStreamTrack;
  private broadcast: any;
  private videoMoqTrack: any = null;
  private audioMoqTrack: any = null;
  private abortController: AbortController | null = null;

  constructor(videoTrack: MediaStreamTrack, audioTrack: MediaStreamTrack, broadcast: any) {
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
    this.broadcast = broadcast;
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
      videoSettings.frameRate || 30
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

        // Write chunk data
        const buffer = new Uint8Array(value.chunk.byteLength);
        value.chunk.copyTo(buffer);
        group.writeFrame(buffer);

        group.close();
      }
    });
  }

  private createAudioWriter(moqTrack: any): WritableStream<EncodedAudioChunk> {
    return new WritableStream({
      async write(chunk) {
        const group = moqTrack.appendGroup();

        // Write chunk data
        const buffer = new Uint8Array(chunk.byteLength);
        chunk.copyTo(buffer);
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
