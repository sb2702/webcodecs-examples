// WritableStreams that write WebCodecs chunks to MoQ tracks using Hang's group rules and legacy container
import { encodeFrame } from './hang';

// Video: each group is a GoP (a keyframe followed by its delta frames).
// When the next keyframe arrives we know where the previous group's last frame ends,
// so we close the group with an empty-payload end marker at that timestamp.
// `toPts` maps a chunk's capture timestamp onto the broadcast's PTS (see MediaClock)
export function createVideoWriter(
  moqTrack: any,
  toTimestamp: (micros: number) => any,
  onFrame?: () => void,
  toPts: (micros: number) => number = (micros) => micros
): WritableStream<{ chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata }> {
  let group: any = null;

  const writeFrame = (data: Uint8Array | EncodedVideoChunk, timestamp: number) => {
    group.writeFrame({ payload: encodeFrame(data, timestamp), timestamp: toTimestamp(timestamp) });
  };

  return new WritableStream({
    write({ chunk }) {
      const pts = toPts(chunk.timestamp);

      if (chunk.type === 'key') {
        if (group) {
          writeFrame(new Uint8Array(), pts); // end marker for the previous frame
          group.close();
        }
        group = moqTrack.appendGroup();
      }

      // A group MUST start with a keyframe
      if (!group) return;

      writeFrame(chunk, pts);
      onFrame?.();
    },
    close() {
      group?.close();
      moqTrack.close();
    },
    abort() {
      group?.close();
      moqTrack.close();
    },
  });
}

// Audio: every audio frame is a keyframe, so each one gets its own group and the relay
// can forward it without waiting for a group boundary.
export function createAudioWriter(
  moqTrack: any,
  toTimestamp: (micros: number) => any,
  onFrame?: () => void,
  toPts: (micros: number) => number = (micros) => micros
): WritableStream<EncodedAudioChunk> {
  return new WritableStream({
    write(chunk) {
      const pts = toPts(chunk.timestamp);
      const group = moqTrack.appendGroup();
      group.writeFrame({ payload: encodeFrame(chunk, pts), timestamp: toTimestamp(pts) });
      group.close();
      onFrame?.();
    },
    close() {
      moqTrack.close();
    },
    abort() {
      moqTrack.close();
    },
  });
}
