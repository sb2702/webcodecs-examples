import { getWebcam } from '../../src/webcam-recording/webcam';
import { VideoEncoderStream } from '../../src/webcam-recording/video-encoder-stream';
import { AudioEncoderStream } from '../../src/webcam-recording/audio-encoder-stream';
import { createVideoMuxerWriter, createAudioMuxerWriter } from '../../src/webcam-recording/muxer-writer';
import { MediaStreamTrackProcessor, InMemoryStorage } from 'webcodecs-utils';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { isAACSupported } from '../../src/webcam-recording/audio-codec-support';

let videoTrack: MediaStreamTrack;
let audioTrack: MediaStreamTrack;
let stream: MediaStream;
let abortController: AbortController | null = null;

const startWebcamBtn = document.getElementById('startWebcamBtn') as HTMLButtonElement;
const startRecordingBtn = document.getElementById('startRecordingBtn') as HTMLButtonElement;
const stopRecordingBtn = document.getElementById('stopRecordingBtn') as HTMLButtonElement;
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
  status.textContent = 'Recording...';
  startRecordingBtn.disabled = true;
  stopRecordingBtn.disabled = false;
  playback.style.display = 'none';

  const videoSettings = videoTrack.getSettings();
  const audioSettings = audioTrack.getSettings();

  // Set up storage and muxer
  const storage = new InMemoryStorage();
  const target = new StreamTarget({
    onData: (data: Uint8Array, position: number) => {
      storage.write(data, position);
    },
    chunked: true,
    chunkSize: 1024 * 1024 * 10
  });

  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: videoSettings.width!,
      height: videoSettings.height!,
    },
    audio: {
      codec: await isAACSupported() ? 'aac' : 'opus',
      numberOfChannels: audioSettings.channelCount!,
      sampleRate: audioSettings.sampleRate!,
    },
    firstTimestampBehavior: 'offset',
    fastStart: 'in-memory',
  });

  // Video pipeline
  const videoProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
  const videoEncoderStream = new VideoEncoderStream(
    videoSettings.width!,
    videoSettings.height!,
    videoSettings.frameRate || 30
  );

  // Audio pipeline
  const audioProcessor = new MediaStreamTrackProcessor({ track: audioTrack });
  const audioEncoderStream = new AudioEncoderStream(
    audioSettings.sampleRate!,
    audioSettings.channelCount!
  );

  // Create abort controller
  abortController = new AbortController();

  try {
    // Pipe both streams to muxer
    await Promise.all([
      videoProcessor.readable
        .pipeThrough(videoEncoderStream)
        .pipeTo(createVideoMuxerWriter(muxer), { signal: abortController.signal }),
      audioProcessor.readable
        .pipeThrough(audioEncoderStream)
        .pipeTo(createAudioMuxerWriter(muxer), { signal: abortController.signal })
    ]);
  } catch (e: any) {
    if (e.name !== 'AbortError') throw e;
  }

  // Finalize and play
  muxer.finalize();
  const blob = storage.toBlob('video/mp4');

  status.textContent = `Recording complete! Size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`;

  // Show playback
  const url = URL.createObjectURL(blob);
  playback.src = url;
  playback.style.display = 'block';

  startRecordingBtn.disabled = false;
  stopRecordingBtn.disabled = true;
  abortController = null;
});

// Stop recording
stopRecordingBtn.addEventListener('click', () => {
  if (abortController) {
    abortController.abort();
    status.textContent = 'Stopping...';
  }
});
