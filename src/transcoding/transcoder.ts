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
import { transcodePipeline, TranscodePipelineOptions } from './transcode-pipeline';

export type TranscodeMethod = 'promise' | 'waterfall' | 'pipeline';

export interface TranscodeFileOptions {
  method?: TranscodeMethod;
  pipelineOptions?: TranscodePipelineOptions;
}

/**
 * Transcode a video file using the specified method
 */
export async function transcodeFile(
  file: File,
  methodOrOptions?: TranscodeMethod | TranscodeFileOptions
): Promise<Blob> {
  // Handle legacy string argument or new options object
  let method: TranscodeMethod = 'promise';
  let pipelineOptions: TranscodePipelineOptions | undefined;

  if (typeof methodOrOptions === 'string') {
    method = methodOrOptions;
  } else if (methodOrOptions) {
    method = methodOrOptions.method ?? 'promise';
    pipelineOptions = methodOrOptions.pipelineOptions;
  }

  switch (method) {
    case 'promise':
      return transcodePromise(file);
    case 'waterfall':
      return transcodeWaterfall(file);
    case 'pipeline':
      return transcodePipeline(file, pipelineOptions);
    default:
      throw new Error(`Unknown transcode method: ${method}`);
  }
}
