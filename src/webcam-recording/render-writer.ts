import { GPUFrameRenderer } from 'webcodecs-utils';

export function createRenderWriter(canvas: HTMLCanvasElement): WritableStream<VideoFrame> {
  let renderer: GPUFrameRenderer;

  return new WritableStream({
    async start() {
      renderer = new GPUFrameRenderer(canvas);
      await renderer.init();
    },
    async write(frame) {
      await renderer.drawImage(frame);
      frame.close();
    }
  });
}
