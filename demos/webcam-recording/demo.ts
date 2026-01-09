import { getWebcam } from '../../src/webcam-recording/webcam';
import { TrackProcessor } from '../../src/webcam-recording/track-processor';
import { GPUFrameRenderer } from 'webcodecs-utils';

document.getElementById('startBtn')?.addEventListener('click', async () => {
  const { videoTrack, stream } = await getWebcam();
  const video = document.getElementById('preview') as HTMLVideoElement;
  video.srcObject = stream;

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const renderer = new GPUFrameRenderer(canvas);
  
  await renderer.init();


  


  const frameStream = TrackProcessor(videoTrack);
  const reader = frameStream.getReader();

  while (true) {
    const { done, value: frame } = await reader.read();
    if (done) break;

    await renderer.drawImage(frame);
    frame.close();
  }
});
