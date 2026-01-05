/**
 * Video transcoding using WebCodecs API
 * Demonstrates decode → encode pipeline with audio pass-through
 *
 * This file provides three different implementation patterns:
 * - Promise pattern (free.upscaler approach)
 * - Waterfall pattern (Katana approach)
 * - Pipeline pattern (experimental)
 */

import { transcodePromise } from './transcode-promise';
import { transcodeWaterfall } from './transcode-waterfall';
import { transcodePipeline } from './transcode-pipeline';

export type TranscodeMethod = 'promise' | 'waterfall' | 'pipeline';

/**
 * Transcode a video file using the specified method
 */
export async function transcodeFile(
  file: File,
  method: TranscodeMethod = 'promise'
): Promise<Blob> {
  switch (method) {
    case 'promise':
      return transcodePromise(file);
    case 'waterfall':
      return transcodeWaterfall(file);
    case 'pipeline':
      return transcodePipeline(file);
    default:
      throw new Error(`Unknown transcode method: ${method}`);
  }
}
