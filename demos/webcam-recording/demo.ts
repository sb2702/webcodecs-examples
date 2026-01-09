import { getWebcam } from '../../src/webcam-recording/webcam';
import { VideoEncoderStream } from '../../src/webcam-recording/video-encoder-stream';
import { AudioEncoderStream } from '../../src/webcam-recording/audio-encoder-stream';
import { MediaStreamTrackProcessor } from 'webcodecs-utils';

document.getElementById('startBtn')?.addEventListener('click', async () => {
  const { videoTrack, audioTrack, stream } = await getWebcam();
  const video = document.getElementById('preview') as HTMLVideoElement;
  video.srcObject = stream;

  const videoSettings = videoTrack.getSettings();
  const audioSettings = audioTrack.getSettings();

  // Video pipeline: frames -> encoder -> encoded chunks
  const videoProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
  const videoEncoderStream = new VideoEncoderStream(
    videoSettings.width!,
    videoSettings.height!,
    videoSettings.frameRate || 30
  );

  const videoReader = videoProcessor.readable
    .pipeThrough(videoEncoderStream)
    .getReader();

  // Read a few encoded video chunks
  (async () => {
    for (let i = 0; i < 10; i++) {
      const { done, value } = await videoReader.read();
      if (done) break;
      console.log('Encoded video chunk:', value.chunk.type, value.chunk.byteLength, 'bytes');
    }
  })();

  // Audio pipeline: audioData -> encoder -> encoded chunks
  try {
    const audioProcessor = new MediaStreamTrackProcessor({ track: audioTrack });
    const audioEncoderStream = new AudioEncoderStream(
      audioSettings.sampleRate!,
      audioSettings.channelCount!
    );

    const audioReader = audioProcessor.readable
      .pipeThrough(audioEncoderStream)
      .getReader();

    // Read a few encoded audio chunks
    (async () => {
      for (let i = 0; i < 10; i++) {
        const { done, value } = await audioReader.read();
        if (done) break;
        console.log('Encoded audio chunk:', value.type, value.byteLength, 'bytes');
      }
    })();
  } catch (e) {
    console.warn('Audio encoding not supported:', e);
  }
});
