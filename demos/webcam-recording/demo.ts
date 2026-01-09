import { getWebcam } from '../../src/webcam-recording/webcam';
import { createRenderWriter } from '../../src/webcam-recording/render-writer';
import { MediaStreamTrackProcessor } from 'webcodecs-utils';

document.getElementById('startBtn')?.addEventListener('click', async () => {
  const { videoTrack, stream } = await getWebcam();
  const video = document.getElementById('preview') as HTMLVideoElement;
  video.srcObject = stream;

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const processor = new MediaStreamTrackProcessor({ track: videoTrack });

  await processor.readable.pipeTo(createRenderWriter(canvas));
});
