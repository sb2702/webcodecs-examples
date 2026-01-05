
import {MP4Demuxer} from 'webcodecs-utils'

/**
 * Transcoding implementation - Promise pattern
 * (How free.upscaler does it)
 */

export async function transcodePromise(file: File): Promise<Blob> {
  // TODO: Implement promise pattern
  // - Explanation of this approach


  const demuxer = new MP4Demuxer(file);

  await demuxer.load();


  const trackData = demuxer.getTracks();

  const videoDecoderConfig = demuxer.getVideoDecoderConfig();

  const videoChunks = await demuxer.extractSegment('video', 0, trackData.duration );




  return new Blob([], { type: "video/mp4" });
}
