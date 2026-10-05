// A hand-written implementation of the Hang media format (draft-lcurley-moq-hang-03),
// covering the parts a WebCodecs publisher/subscriber needs: the catalog and the legacy container.
// Spec: https://doc.moq.dev/draft/moq-hang  Overview: https://doc.moq.dev/concept/hang

/** The track carrying the catalog. Each group holds one frame of UTF-8 JSON. */
export const CATALOG_TRACK = 'catalog.json';

// Track names double as the catalog's rendition keys: Hang players subscribe by rendition key
export const VIDEO_TRACK = 'video';
export const AUDIO_TRACK = 'audio';

/** Delivery priority per track kind (higher is sent first), matching the reference implementation. */
export const PRIORITY = { catalog: 100, audio: 80, video: 60 } as const;

// moq-lite track settings. Media tracks use a microsecond timescale (the unit Hang timestamps
// are in; @moq/net defaults to milliseconds) and keep 30s of groups fetchable. The catalog may
// be published once for the whole broadcast, so it's kept forever for late joiners.
export const MEDIA_TIMESCALE = 1_000_000;
export const MEDIA_MAX_AGE_MS = 30_000;
export const CATALOG_MAX_AGE_MS = Number.MAX_SAFE_INTEGER;

export function mediaTrackInfo(priority: number) {
  return { timescale: MEDIA_TIMESCALE, maxAge: MEDIA_MAX_AGE_MS, priority };
}

export function catalogTrackInfo() {
  return { maxAge: CATALOG_MAX_AGE_MS, priority: PRIORITY.catalog };
}

/** Broadcast names SHOULD end in `.hang` so players know which catalog to expect. */
export function broadcastName(name: string): string {
  return name.endsWith('.hang') ? name : `${name}.hang`;
}

// ---------------------------------------------------------------------------
// QUIC variable-length integers (RFC 9000, Section 16)
//
// The top 2 bits of the first byte give the length: 00 = 1 byte, 01 = 2, 10 = 4, 11 = 8.
// The remaining bits hold the value, big-endian.
// ---------------------------------------------------------------------------

// #region varint
export function encodeVarint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`varint must be a non-negative safe integer: ${value}`);
  }

  if (value < 2 ** 6) {
    return new Uint8Array([value]);
  }
  if (value < 2 ** 14) {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, value | 0x4000);
    return buf;
  }
  if (value < 2 ** 30) {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, (value | 0x80000000) >>> 0);
    return buf;
  }

  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(value) | 0xc000000000000000n);
  return buf;
}

/** Decode a varint from the start of `buf`, returning the value and the bytes after it. */
export function decodeVarint(buf: Uint8Array): [number, Uint8Array] {
  if (buf.byteLength === 0) throw new Error('varint: buffer is empty');

  const size = 1 << (buf[0] >> 6); // 1, 2, 4 or 8 bytes
  if (buf.byteLength < size) throw new Error(`varint: need ${size} bytes, have ${buf.byteLength}`);

  const view = new DataView(buf.buffer, buf.byteOffset, size);
  let value: number;
  if (size === 1) value = view.getUint8(0) & 0x3f;
  else if (size === 2) value = view.getUint16(0) & 0x3fff;
  else if (size === 4) value = view.getUint32(0) & 0x3fffffff;
  else value = Number(view.getBigUint64(0) & 0x3fffffffffffffffn);

  return [value, buf.subarray(size)];
}
// #endregion varint

// ---------------------------------------------------------------------------
// Legacy container: [timestamp varint (microseconds)] [codec payload]
//
// An empty codec payload is not media: for video it marks the exclusive end of the frame
// before it, so consumers MUST skip it and never pass it to a decoder.
// ---------------------------------------------------------------------------

/** Anything that can copy its bytes out, e.g. an EncodedVideoChunk or EncodedAudioChunk. */
export interface ByteSource {
  byteLength: number;
  copyTo(destination: Uint8Array): void;
}

// #region frame
export function encodeFrame(data: Uint8Array | ByteSource, timestamp: number): Uint8Array {
  const header = encodeVarint(timestamp);
  const frame = new Uint8Array(header.byteLength + data.byteLength);
  frame.set(header, 0);

  if (data instanceof Uint8Array) {
    frame.set(data, header.byteLength);
  } else {
    data.copyTo(frame.subarray(header.byteLength));
  }

  return frame;
}

export function decodeFrame(frame: Uint8Array): { timestamp: number; data: Uint8Array } {
  const [timestamp, data] = decodeVarint(frame);
  return { timestamp, data };
}
// #endregion frame

// ---------------------------------------------------------------------------
// Clock
//
// Hang timestamps count from the broadcast's "PTS zero". Like the reference publisher, we use
// the page's clock: PTS zero is when performance.now() was 0, and the catalog's `clock` says
// what wall-clock time that was.
//
// Capture timestamps can't be used as-is: in Chrome, MediaStreamTrackProcessor stamps video
// frames on the camera's capture clock (roughly system uptime) but audio on performance.now().
// So each track gets its own MediaClock, anchored when its first raw frame arrives.
// ---------------------------------------------------------------------------

/** The moq epoch, 2020-01-01T00:00:00Z, that the catalog's `clock.wall` counts from. */
export const MOQ_EPOCH_UNIX_MS = Date.UTC(2020, 0, 1);

// #region clock
/** Maps one track's capture timestamps (microseconds) onto PTS. Use one instance per track. */
export class MediaClock {
  private offset: number | undefined;

  /** Call with each raw frame as it's captured: the first one anchors the clock to "now". */
  observe(captureTimestamp: number, now = performance.now() * 1000): void {
    if (this.offset === undefined) {
      this.offset = Math.round(now) - captureTimestamp;
    }
  }

  toPts(captureTimestamp: number): number {
    this.observe(captureTimestamp);
    return captureTimestamp + this.offset!;
  }
}

/** A pass-through stream that anchors `clock` on the first raw VideoFrame / AudioData, before encoding. */
export function anchorClock<T extends { timestamp: number }>(clock: MediaClock): TransformStream<T, T> {
  return new TransformStream({
    transform(frame, controller) {
      clock.observe(frame.timestamp);
      controller.enqueue(frame);
    },
  });
}

/** The catalog's root `clock`: the wall-clock time of PTS zero, in microseconds since the moq epoch. */
export function wallClock(): Clock {
  return { wall: Math.round((performance.timeOrigin - MOQ_EPOCH_UNIX_MS) * 1000), timescale: 1_000_000 };
}
// #endregion clock

// ---------------------------------------------------------------------------
// Catalog
//
// Renditions extend the WebCodecs VideoDecoderConfig / AudioDecoderConfig. Byte fields
// (notably `description`) are lowercase hex strings, not base64.
// ---------------------------------------------------------------------------

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw new Error('expected a hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export interface VideoRendition {
  codec: string;
  container: { kind: 'legacy' };
  description?: string; // hex
  codedWidth?: number;
  codedHeight?: number;
  framerate?: number;
  bitrate?: number;
}

export interface AudioRendition {
  codec: string;
  container: { kind: 'legacy' };
  description?: string; // hex
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
}

export interface Clock {
  wall: number;
  timescale?: number;
}

export interface Catalog {
  clock?: Clock;
  video?: { renditions: Record<string, VideoRendition> };
  audio?: { renditions: Record<string, AudioRendition> };
}

// #region renditions
export function videoRendition(config: VideoEncoderConfig, description?: Uint8Array): VideoRendition {
  return {
    codec: config.codec,
    container: { kind: 'legacy' },
    ...(description?.byteLength ? { description: toHex(description) } : {}),
    codedWidth: config.width,
    codedHeight: config.height,
    ...(config.framerate ? { framerate: config.framerate } : {}),
    ...(config.bitrate ? { bitrate: config.bitrate } : {}),
  };
}

export function audioRendition(config: AudioEncoderConfig, description?: Uint8Array): AudioRendition {
  return {
    codec: config.codec,
    container: { kind: 'legacy' },
    ...(description?.byteLength ? { description: toHex(description) } : {}),
    sampleRate: config.sampleRate,
    numberOfChannels: config.numberOfChannels,
    ...(config.bitrate ? { bitrate: config.bitrate } : {}),
  };
}
// #endregion renditions

/** Pick the first rendition we can read: a consumer MUST ignore unknown container kinds. */
export function firstRendition<T extends { container?: { kind: string } }>(
  renditions: Record<string, T> | undefined
): [string, T] | undefined {
  for (const [name, rendition] of Object.entries(renditions ?? {})) {
    if ((rendition.container?.kind ?? 'legacy') === 'legacy') return [name, rendition];
  }
  return undefined;
}

export function videoDecoderConfig(rendition: VideoRendition): VideoDecoderConfig {
  return {
    codec: rendition.codec,
    codedWidth: rendition.codedWidth,
    codedHeight: rendition.codedHeight,
    // Without a description, H.264/H.265 are Annex B with parameter sets before each keyframe
    ...(rendition.description ? { description: fromHex(rendition.description) } : {}),
    optimizeForLatency: true,
  };
}

export function audioDecoderConfig(rendition: AudioRendition): AudioDecoderConfig {
  return {
    codec: rendition.codec,
    sampleRate: rendition.sampleRate,
    numberOfChannels: rendition.numberOfChannels,
    ...(rendition.description ? { description: fromHex(rendition.description) } : {}),
  };
}
