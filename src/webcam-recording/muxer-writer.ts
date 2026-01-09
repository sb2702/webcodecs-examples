import { Muxer, StreamTarget } from 'mp4-muxer';

export function createVideoMuxerWriter(muxer: Muxer<StreamTarget>): WritableStream<{ chunk: EncodedVideoChunk; meta: EncodedVideoChunkMetadata }> {
  return new WritableStream({
    async write(value) {
      muxer.addVideoChunk(value.chunk, value.meta);
    }
  });
}

export function createAudioMuxerWriter(muxer: Muxer<StreamTarget>): WritableStream<EncodedAudioChunk> {
  return new WritableStream({
    async write(chunk) {
      muxer.addAudioChunk(chunk);
    }
  });
}
