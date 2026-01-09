import { MediaStreamTrackProcessor, InMemoryStorage } from 'webcodecs-utils';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { VideoEncoderStream } from './video-encoder-stream';
import { AudioEncoderStream } from './audio-encoder-stream';
import { createVideoMuxerWriter, createAudioMuxerWriter } from './muxer-writer';
import { isAACSupported } from './audio-codec-support';

export class WebcamRecorder {
  private videoTrack: MediaStreamTrack;
  private audioTrack: MediaStreamTrack;
  private abortController: AbortController | null = null;
  private recordingPromise: Promise<Blob> | null = null;

  constructor(videoTrack: MediaStreamTrack, audioTrack: MediaStreamTrack) {
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
  }

  async start(): Promise<void> {
    if (this.abortController) {
      throw new Error('Recording already in progress');
    }

    const videoSettings = this.videoTrack.getSettings();
    const audioSettings = this.audioTrack.getSettings();

    // Set up storage and muxer
    const storage = new InMemoryStorage();
    const target = new StreamTarget({
      onData: (data: Uint8Array, position: number) => {
        storage.write(data, position);
      },
      chunked: true,
      chunkSize: 1024 * 1024 * 10
    });

    const useAAC = await isAACSupported(audioSettings.sampleRate, audioSettings.channelCount);

    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width: videoSettings.width!,
        height: videoSettings.height!,
      },
      audio: {
        codec: useAAC ? 'aac' : 'opus',
        numberOfChannels: audioSettings.channelCount!,
        sampleRate: audioSettings.sampleRate!,
      },
      firstTimestampBehavior: 'offset',
      fastStart: 'in-memory',
    });

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
      audioSettings.sampleRate!,
      audioSettings.channelCount!
    );

    // Create abort controller
    this.abortController = new AbortController();

    // Start recording
    this.recordingPromise = (async () => {
      try {
        await Promise.all([
          videoProcessor.readable
            .pipeThrough(videoEncoderStream)
            .pipeTo(createVideoMuxerWriter(muxer), { signal: this.abortController!.signal }),
          audioProcessor.readable
            .pipeThrough(audioEncoderStream)
            .pipeTo(createAudioMuxerWriter(muxer), { signal: this.abortController!.signal })
        ]);
      } catch (e: any) {
        if (e.name !== 'AbortError') throw e;
      }

      muxer.finalize();
      return storage.toBlob('video/mp4');
    })();
  }

  async stop(): Promise<Blob> {
    if (!this.abortController || !this.recordingPromise) {
      throw new Error('No recording in progress');
    }

    this.abortController.abort();
    const blob = await this.recordingPromise;

    this.abortController = null;
    this.recordingPromise = null;

    return blob;
  }

  isRecording(): boolean {
    return this.abortController !== null;
  }
}
