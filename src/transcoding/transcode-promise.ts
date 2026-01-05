/**
 * Transcoding implementation - Promise pattern
 * (How free.upscaler does it)
 */

export async function transcodePromise(file: File): Promise<Blob> {
  // TODO: Implement promise pattern
  // - Explanation of this approach

  return new Blob([], { type: "video/mp4" });
}
