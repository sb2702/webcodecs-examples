import { getWebcam } from '../../src/webcam-recording/webcam';
import { TrackProcessor } from '../../src/webcam-recording/track-processor';

document.getElementById('startBtn')?.addEventListener('click', async () => {
  const { videoTrack, stream } = await getWebcam();
  const video = document.getElementById('preview') as HTMLVideoElement;
  video.srcObject = stream;

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  const frameStream = TrackProcessor(videoTrack);
  const reader = frameStream.getReader();

  while (true) {
    const { done, value: frame } = await reader.read();
    if (done) break;

    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    frame.close();
  }
});
