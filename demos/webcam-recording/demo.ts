import { getWebcam } from '../../src/webcam-recording/webcam';
import { WebcamRecorder } from '../../src/webcam-recording/recorder';

let videoTrack: MediaStreamTrack;
let audioTrack: MediaStreamTrack;
let stream: MediaStream;
let recorder: WebcamRecorder | null = null;

const startWebcamBtn = document.getElementById('startWebcamBtn') as HTMLButtonElement;
const startRecordingBtn = document.getElementById('startRecordingBtn') as HTMLButtonElement;
const stopRecordingBtn = document.getElementById('stopRecordingBtn') as HTMLButtonElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLDivElement;
const preview = document.getElementById('preview') as HTMLVideoElement;
const playback = document.getElementById('playback') as HTMLVideoElement;

// Start webcam
startWebcamBtn.addEventListener('click', async () => {
  const webcam = await getWebcam();
  videoTrack = webcam.videoTrack;
  audioTrack = webcam.audioTrack;
  stream = webcam.stream;

  preview.srcObject = stream;
  status.textContent = 'Webcam ready';

  startWebcamBtn.disabled = true;
  startRecordingBtn.disabled = false;
});

// Start recording
startRecordingBtn.addEventListener('click', async () => {
  recorder = new WebcamRecorder(videoTrack, audioTrack);
  await recorder.start();

  status.textContent = 'Recording...';
  startRecordingBtn.disabled = true;
  stopRecordingBtn.disabled = false;
  playback.style.display = 'none';
  downloadBtn.style.display = 'none';
});

// Stop recording
stopRecordingBtn.addEventListener('click', async () => {
  if (!recorder) return;

  status.textContent = 'Stopping...';
  const blob = await recorder.stop();

  status.textContent = `Recording complete! Size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`;

  // Show playback
  const url = URL.createObjectURL(blob);
  playback.src = url;
  playback.style.display = 'block';

  // Setup download
  downloadBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'webcam-recording.mp4';
    a.click();
  };
  downloadBtn.style.display = 'inline-block';

  startRecordingBtn.disabled = false;
  stopRecordingBtn.disabled = true;
  recorder = null;
});
