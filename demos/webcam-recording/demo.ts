import { getWebcam } from '../../src/webcam-recording/webcam';
import { GPUFrameRenderer, MediaStreamTrackProcessor } from 'webcodecs-utils';

document.getElementById('startBtn')?.addEventListener('click', async () => {
  const { videoTrack, stream } = await getWebcam();
  const video = document.getElementById('preview') as HTMLVideoElement;
  video.srcObject = stream;

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const renderer = new GPUFrameRenderer(canvas);
  await renderer.init();

  const processor = new MediaStreamTrackProcessor({ track: videoTrack });
  const reader = processor.readable.getReader();

  while (true) {
    const { done, value: frame } = await reader.read();
    if (done) break;

    await renderer.drawImage(frame);
    frame.close();
  }
});
