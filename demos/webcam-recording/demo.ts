import { getWebcam } from '../../src/webcam-recording/webcam';

document.getElementById('startBtn')?.addEventListener('click', async () => {
  const { stream } = await getWebcam();
  const video = document.getElementById('preview') as HTMLVideoElement;
  video.srcObject = stream;
});
