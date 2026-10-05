// Conformance tests: our hand-written Hang implementation vs. the reference one (@moq/hang, @moq/net).
// @moq/hang is a devDependency used only as a test oracle; the demos never ship it.
import { describe, expect, test } from 'vitest';
import * as Moq from '@moq/net';
import * as UpstreamCatalog from '@moq/hang/catalog';
import * as UpstreamContainer from '@moq/hang/container';

import * as Hang from '../src/moq/hang';
import { createVideoWriter, createAudioWriter } from '../src/moq/hang-writers';

const toTimestamp = (us: number) => Moq.Time.Timestamp.fromMicros(us);

// Stand-ins for EncodedVideoChunk / EncodedAudioChunk, which don't exist in Node
function fakeChunk(type: 'key' | 'delta', timestamp: number, size = 16) {
  const bytes = Uint8Array.from({ length: size }, (_, i) => (timestamp + i) & 0xff);
  return { type, timestamp, byteLength: size, copyTo: (dst: Uint8Array) => dst.set(bytes), bytes };
}

// A 30fps video stream with a keyframe every `gop` frames
function videoChunks(count: number, gop: number, start = 1_000_000) {
  return Array.from({ length: count }, (_, i) => fakeChunk(i % gop === 0 ? 'key' : 'delta', start + Math.round((i * 1e6) / 30)));
}

// A track plus a subscriber opened before anything is written, so every group is delivered
function capturedTrack(name: string) {
  const track = new Moq.Track.Producer(name);
  const subscriber = track.subscribe({ maxAge: Moq.Time.Milli(60 * 60 * 1000) }).ordered();
  return { track, subscriber };
}

// Read every group back as arrays of raw frame payloads, in sequence order
async function readGroups(subscriber: Moq.Track.Ordered): Promise<Uint8Array[][]> {
  const groups: Uint8Array[][] = [];
  for (;;) {
    const group = await subscriber.nextGroup();
    if (!group) break;
    const frames: Uint8Array[] = [];
    for (;;) {
      const frame = await group.readFrame();
      if (!frame) break;
      frames.push(frame.payload);
    }
    groups.push(frames);
  }
  return groups;
}

async function writeAll(writer: WritableStream<any>, values: any[]) {
  const w = writer.getWriter();
  for (const value of values) await w.write(value);
  await w.close();
}

describe('QUIC varint (RFC 9000 §16)', () => {
  const values = [0, 1, 63, 64, 16_383, 16_384, 2 ** 30 - 1, 2 ** 30, 1_700_000_000_000_000, Number.MAX_SAFE_INTEGER];

  test.each(values)('encodes %d identically to @moq/net', (value) => {
    expect(Hang.encodeVarint(value)).toEqual(Moq.Varint.encode(value));
  });

  test.each(values)('decodes %d from @moq/net output', (value) => {
    const [decoded, rest] = Hang.decodeVarint(Moq.Varint.encode(value));
    expect(decoded).toBe(value);
    expect(rest.byteLength).toBe(0);
  });

  test('rejects negative and fractional values', () => {
    expect(() => Hang.encodeVarint(-1)).toThrow();
    expect(() => Hang.encodeVarint(1.5)).toThrow();
  });
});

describe('legacy container frames', () => {
  const format = new UpstreamContainer.Legacy.Format('video');

  test.each([0, 33_333, 1_000_000, 1_700_000_000_000_000])('frame at %dus is byte-identical to upstream', (timestamp) => {
    const payload = Uint8Array.from([1, 2, 3, 4, 5]);
    expect(Hang.encodeFrame(payload, timestamp)).toEqual(
      UpstreamContainer.Legacy.encodeFrame(payload, timestamp as Moq.Time.Micro)
    );
  });

  test('upstream decodes our frames', () => {
    const chunk = fakeChunk('key', 123_456);
    const [frame] = format.decode(Hang.encodeFrame(chunk, chunk.timestamp));
    expect(frame.timestamp).toBe(123_456);
    expect(frame.payload).toEqual(chunk.bytes);
  });

  test('we decode upstream frames, including empty end markers', () => {
    const decoded = Hang.decodeFrame(UpstreamContainer.Legacy.encodeFrame(new Uint8Array(), 99 as Moq.Time.Micro));
    expect(decoded.timestamp).toBe(99);
    expect(decoded.data.byteLength).toBe(0);
  });
});

describe('catalog', () => {
  const videoConfig: VideoEncoderConfig = { codec: 'avc1.64001f', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 };
  const audioConfig: AudioEncoderConfig = { codec: 'opus', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 };
  const avcC = Uint8Array.from([0x01, 0x64, 0x00, 0x1f, 0xff, 0xe1]);

  const catalog: Hang.Catalog = {
    video: { renditions: { [Hang.VIDEO_TRACK]: Hang.videoRendition(videoConfig, avcC) } },
    audio: { renditions: { [Hang.AUDIO_TRACK]: Hang.audioRendition(audioConfig) } },
  };

  test('validates against the upstream catalog schema', () => {
    const result = UpstreamCatalog.RootSchema.safeParse(JSON.parse(JSON.stringify(catalog)));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  test('keeps every field we publish (none are stripped as unknown)', () => {
    const parsed = UpstreamCatalog.RootSchema.parse(JSON.parse(JSON.stringify(catalog)));
    expect(parsed.video?.renditions[Hang.VIDEO_TRACK]).toMatchObject(catalog.video!.renditions[Hang.VIDEO_TRACK]);
    expect(parsed.audio?.renditions[Hang.AUDIO_TRACK]).toMatchObject(catalog.audio!.renditions[Hang.AUDIO_TRACK]);
  });

  test('description is lowercase hex and round-trips', () => {
    const description = catalog.video!.renditions[Hang.VIDEO_TRACK].description!;
    expect(description).toBe('0164001fffe1');
    expect(Hang.fromHex(description)).toEqual(avcC);
  });

  test('a base64 description is rejected upstream (the old bug)', () => {
    const bad = structuredClone(catalog);
    bad.video!.renditions[Hang.VIDEO_TRACK].description = btoa(String.fromCharCode(...avcC));
    expect(UpstreamCatalog.RootSchema.safeParse(bad).success).toBe(false);
  });

  test('consumers skip renditions with an unknown container', () => {
    const renditions = {
      future: { ...catalog.video!.renditions[Hang.VIDEO_TRACK], container: { kind: 'something-new' } },
      [Hang.VIDEO_TRACK]: catalog.video!.renditions[Hang.VIDEO_TRACK],
    };
    expect(Hang.firstRendition(renditions as any)?.[0]).toBe(Hang.VIDEO_TRACK);
  });

  test('track priorities match upstream', () => {
    expect(Hang.PRIORITY.catalog).toBe(UpstreamCatalog.PRIORITY.catalog);
    expect(Hang.PRIORITY.audio).toBe(UpstreamCatalog.PRIORITY.audio);
    expect(Hang.PRIORITY.video).toBe(UpstreamCatalog.PRIORITY.video);
    expect(Hang.CATALOG_TRACK).toBe(UpstreamCatalog.TRACK);
  });

  test('media track settings (microsecond timescale, retention) match upstream', () => {
    for (const priority of [Hang.PRIORITY.video, Hang.PRIORITY.audio]) {
      expect(Hang.mediaTrackInfo(priority)).toEqual(UpstreamContainer.trackInfo({ priority }));
    }
  });

  test('broadcast names get the .hang suffix', () => {
    expect(Hang.broadcastName('room/alice')).toBe('room/alice.hang');
    expect(Hang.broadcastName('room/alice.hang')).toBe('room/alice.hang');
    expect(UpstreamCatalog.detectFormat(Hang.broadcastName('room/alice'))).toBe('hang');
  });
});

describe('clock', () => {
  test('catalog clock validates upstream and maps PTS zero to the page time origin', () => {
    const clock = Hang.wallClock();
    expect(UpstreamCatalog.ClockSchema.safeParse(clock).success).toBe(true);
    expect(clock.wall).toBe(Math.round((performance.timeOrigin - UpstreamCatalog.MOQ_EPOCH_UNIX_MILLIS) * 1000));
  });

  test('each track is anchored to "now" when its first raw frame arrives', () => {
    // Chrome: video on the camera's capture clock (~uptime), audio already on performance.now()
    const now = 5_000_000;
    const videoClock = new Hang.MediaClock();
    const audioClock = new Hang.MediaClock();
    videoClock.observe(135_000_000_000, now);
    audioClock.observe(4_990_000, now);

    // Encoded chunks keep their capture timestamps; toPts moves them onto the shared page clock
    expect(videoClock.toPts(135_000_033_333)).toBe(now + 33_333);
    expect(audioClock.toPts(5_010_000)).toBe(now + 20_000);
  });
});

describe('video groups', () => {
  const chunks = videoChunks(10, 4); // keyframes at frames 0, 4, 8

  test('match the upstream legacy Producer byte for byte', async () => {
    const ours = capturedTrack('ours');
    await writeAll(createVideoWriter(ours.track, toTimestamp), chunks.map((chunk) => ({ chunk })));

    const theirs = capturedTrack('theirs');
    const producer = new UpstreamContainer.Legacy.Producer(theirs.track, new UpstreamContainer.Legacy.Format('video'));
    for (const chunk of chunks) producer.encode(chunk, chunk.timestamp as Moq.Time.Micro, chunk.type === 'key');
    producer.close();

    const [oursGroups, theirGroups] = [await readGroups(ours.subscriber), await readGroups(theirs.subscriber)];
    expect(oursGroups).toHaveLength(3);
    expect(theirGroups).toHaveLength(3);

    // Upstream closes the final group with an end marker estimated from the frame cadence,
    // which the spec allows (MAY) but we skip, so compare everything else
    expect(oursGroups.slice(0, 2)).toEqual(theirGroups.slice(0, 2));
    expect(oursGroups[2]).toEqual(theirGroups[2].slice(0, oursGroups[2].length));
  });

  test('every group starts with a keyframe, and ends with a marker at the next keyframe', async () => {
    const { track, subscriber } = capturedTrack('video');
    await writeAll(createVideoWriter(track, toTimestamp), chunks.map((chunk) => ({ chunk })));
    const groups = await readGroups(subscriber);
    expect(groups).toHaveLength(3);
    const keyframes = chunks.filter((c) => c.type === 'key');

    groups.forEach((frames, i) => {
      const first = Hang.decodeFrame(frames[0]);
      expect(first.timestamp).toBe(keyframes[i].timestamp);
      expect(first.data).toEqual(keyframes[i].bytes);

      if (i < groups.length - 1) {
        const marker = Hang.decodeFrame(frames[frames.length - 1]);
        expect(marker.data.byteLength).toBe(0);
        expect(marker.timestamp).toBe(keyframes[i + 1].timestamp);
      }
    });
  });

  test('delta frames before the first keyframe are dropped', async () => {
    const { track, subscriber } = capturedTrack('video');
    const late = [fakeChunk('delta', 0), fakeChunk('delta', 33_333), ...videoChunks(2, 30, 66_666)];
    await writeAll(createVideoWriter(track, toTimestamp), late.map((chunk) => ({ chunk })));
    const [frames] = await readGroups(subscriber);
    expect(Hang.decodeFrame(frames[0]).timestamp).toBe(66_666);
  });
});

describe('audio groups', () => {
  test('one frame per group, decodable upstream', async () => {
    const chunks = Array.from({ length: 5 }, (_, i) => fakeChunk('key', i * 20_000));
    const { track, subscriber } = capturedTrack('audio');
    await writeAll(createAudioWriter(track, toTimestamp), chunks);

    const format = new UpstreamContainer.Legacy.Format('audio');
    const groups = await readGroups(subscriber);
    expect(groups).toHaveLength(chunks.length);
    groups.forEach((frames, i) => {
      expect(frames).toHaveLength(1);
      const [frame] = format.decode(frames[0]);
      expect(frame.timestamp).toBe(chunks[i].timestamp);
      expect(frame.payload).toEqual(chunks[i].bytes);
    });
  });
});
