import { VideoEncoderStream } from './video-encoder-stream.js';
import { AudioEncoderStream } from './audio-encoder-stream.js';

export class MoqPublisher {
  // toTimestamp: @moq/net frames carry their own timestamp, e.g. (us) => Moq.Time.Timestamp.fromMicros(us)
  constructor(videoTrack, audioTrack, broadcast, videoConfig, audioConfig, toTimestamp) {
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
    this.broadcast = broadcast;
    this.videoConfig = videoConfig;
    this.audioConfig = audioConfig;
    this.toTimestamp = toTimestamp;
    // Create tracks up front: @moq/net refuses a subscribe to a track that doesn't exist yet
    this.videoMoqTrack = broadcast.createTrack('video');
    this.audioMoqTrack = broadcast.createTrack('audio');
    this.abortController = null;
    this.videoFrameCount = 0;
    this.audioFrameCount = 0;
  }

  static async getDescription(videoTrack, config) {
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

  async start() {
    if (this.abortController) {
      throw new Error('Already publishing');
    }

    this.abortController = new AbortController();

    // Video pipeline
    const videoProcessor = new MediaStreamTrackProcessor({ track: this.videoTrack });
    const videoEncoderStream = new VideoEncoderStream(this.videoConfig);

    videoProcessor.readable
      .pipeThrough(videoEncoderStream)
      .pipeTo(this.createVideoWriter(this.videoMoqTrack), {
        signal: this.abortController.signal
      })
      .catch(e => {
        if (e.name !== 'AbortError') {
          console.error('Video pipeline error:', e);
        }
      });

    // Audio pipeline
    const audioProcessor = new MediaStreamTrackProcessor({ track: this.audioTrack });
    const audioEncoderStream = new AudioEncoderStream(this.audioConfig);

    audioProcessor.readable
      .pipeThrough(audioEncoderStream)
      .pipeTo(this.createAudioWriter(this.audioMoqTrack), {
        signal: this.abortController.signal
      })
      .catch(e => {
        if (e.name !== 'AbortError') {
          console.error('Audio pipeline error:', e);
        }
      });
  }

  createVideoWriter(moqTrack) {
    let currentGroup = null;
    const self = this;

    return new WritableStream({
      async write(value) {
        // Start new group on keyframe (GOP - group of pictures)
        if (value.chunk.type === 'key') {
          if (currentGroup) {
            currentGroup.close();
          }
          currentGroup = moqTrack.appendGroup();
        }

        if (!currentGroup) {
          // First chunk must be a keyframe
          currentGroup = moqTrack.appendGroup();
        }

        // Format: [timestamp (8 bytes)] [data]
        const chunkData = new Uint8Array(value.chunk.byteLength);
        value.chunk.copyTo(chunkData);

        const buffer = new Uint8Array(8 + chunkData.byteLength);
        const view = new DataView(buffer.buffer);

        // Write timestamp as 64-bit integer (microseconds)
        view.setBigUint64(0, BigInt(value.chunk.timestamp), true);

        // Write chunk data
        buffer.set(chunkData, 8);

        currentGroup.writeFrame({ payload: buffer, timestamp: self.toTimestamp(value.chunk.timestamp) });
        self.videoFrameCount++;
      },
      async close() {
        if (currentGroup) {
          currentGroup.close();
        }
      }
    });
  }

  createAudioWriter(moqTrack) {
    const self = this;

    return new WritableStream({
      async write(chunk) {
        const group = moqTrack.appendGroup();

        // Format: [timestamp (8 bytes)] [data]
        const chunkData = new Uint8Array(chunk.byteLength);
        chunk.copyTo(chunkData);

        const buffer = new Uint8Array(8 + chunkData.byteLength);
        const view = new DataView(buffer.buffer);

        // Write timestamp as 64-bit integer (microseconds)
        view.setBigUint64(0, BigInt(chunk.timestamp), true);

        // Write chunk data
        buffer.set(chunkData, 8);

        group.writeFrame({ payload: buffer, timestamp: self.toTimestamp(chunk.timestamp) });
        group.close();
        self.audioFrameCount++;
      }
    });
  }

  stop() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  isPublishing() {
    return this.abortController !== null;
  }
}
