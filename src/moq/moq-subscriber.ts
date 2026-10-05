import {
  PRIORITY,
  decodeFrame,
  firstRendition,
  videoDecoderConfig,
  audioDecoderConfig,
  type Catalog,
} from './hang';

export interface MoqFrame {
  timestamp: number;
  type?: 'key' | 'delta';
  data: Uint8Array;
}

// A live group can be reset mid-stream (e.g. dropped by the relay): skip to the next group
async function readFrame(group: any): Promise<{ payload: Uint8Array } | undefined> {
  try {
    return await group.readFrame();
  } catch (error) {
    console.warn(`Group ${group.sequence} reset, skipping to the next group:`, (error as Error).message);
    return undefined;
  }
}

export class MoqSubscriber {
  private broadcast: any;
  private catalog: Catalog;
  private videoDecoder: VideoDecoder | null = null;
  private audioDecoder: AudioDecoder | null = null;
  private subscriptions: any[] = [];

  // `broadcast` is the @moq/net broadcast consumer the catalog came from
  constructor(catalog: Catalog, broadcast: any) {
    this.catalog = catalog;
    this.broadcast = broadcast;
  }

  // Read the latest catalog: each group holds one frame of UTF-8 JSON
  static async getCatalog(broadcast: any): Promise<Catalog> {
    const catalogTrack = broadcast.track('catalog.json').subscribe({ priority: PRIORITY.catalog });
    const group = await catalogTrack.recvGroup();
    const catalog = await group.readJson();
    catalogTrack.close();
    return catalog as Catalog;
  }

  async startVideo(onFrame: (frame: VideoFrame) => void): Promise<void> {
    // Pick the first rendition with a container we understand; its key is the track name
    const selected = firstRendition(this.catalog.video?.renditions);
    if (!selected) throw new Error('No playable video rendition in catalog');
    const [trackName, rendition] = selected;

    this.videoDecoder = new VideoDecoder({
      output: onFrame,
      error: (e) => console.error('Video decoder error:', e),
    });
    this.videoDecoder.configure(videoDecoderConfig(rendition));

    const track = this.broadcast.track(trackName).subscribe({ priority: PRIORITY.video });
    this.subscriptions.push(track);

    // Start reading video frames
    (async () => {
      try {
        while (true) {
          const group = await track.recvGroup();
          if (!group) break;

          // Each group is a GoP, so the first frame in a group is always a keyframe
          let isKeyframe = true;

          for (;;) {
            const moqFrame = await readFrame(group);
            if (!moqFrame) break;

            const frame = this.parseFrame(moqFrame.payload, isKeyframe);

            // An empty payload marks where the previous frame ends: never decode it
            if (frame.data.byteLength === 0) continue;

            this.videoDecoder!.decode(new EncodedVideoChunk({
              timestamp: frame.timestamp,
              type: frame.type!,
              data: frame.data,
            }));
            isKeyframe = false; // Subsequent frames are delta
          }
        }
      } catch (error) {
        console.error('Video read error:', error);
      }
    })();
  }

  async startAudio(onData: (audioData: AudioData) => void): Promise<void> {
    const selected = firstRendition(this.catalog.audio?.renditions);
    if (!selected) throw new Error('No playable audio rendition in catalog');
    const [trackName, rendition] = selected;

    this.audioDecoder = new AudioDecoder({
      output: onData,
      error: (e) => console.error('Audio decoder error:', e),
    });
    this.audioDecoder.configure(audioDecoderConfig(rendition));

    const track = this.broadcast.track(trackName).subscribe({ priority: PRIORITY.audio });
    this.subscriptions.push(track);

    // Start reading audio frames
    (async () => {
      try {
        while (true) {
          const group = await track.recvGroup();
          if (!group) break;

          // Every audio frame is a keyframe, and a group may hold one or many of them
          for (;;) {
            const moqFrame = await readFrame(group);
            if (!moqFrame) break;

            const frame = this.parseFrame(moqFrame.payload, true);

            // An empty payload marks the end of the source audio: never decode it
            if (frame.data.byteLength === 0) continue;

            this.audioDecoder!.decode(new EncodedAudioChunk({
              timestamp: frame.timestamp,
              type: 'key',
              data: frame.data,
            }));
          }
        }
      } catch (error) {
        console.error('Audio read error:', error);
      }
    })();
  }

  // Hang legacy container: [timestamp varint (microseconds)] [codec payload]
  private parseFrame(buffer: Uint8Array, isKeyframe: boolean): MoqFrame {
    const { timestamp, data } = decodeFrame(buffer);
    return { timestamp, type: isKeyframe ? 'key' : 'delta', data };
  }

  stop(): void {
    for (const track of this.subscriptions) track.close();
    this.subscriptions = [];

    if (this.videoDecoder && this.videoDecoder.state !== 'closed') {
      this.videoDecoder.close();
    }
    if (this.audioDecoder && this.audioDecoder.state !== 'closed') {
      this.audioDecoder.close();
    }
  }
}
