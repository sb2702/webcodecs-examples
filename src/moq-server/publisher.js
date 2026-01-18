import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;
import * as Moq from '@moq/lite';
import { Input, ALL_FORMATS, FilePathSource } from 'mediabunny';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

// Serve static files from public directory
app.use(express.static(join(__dirname, 'public')));

const PORT = 3000;
const RELAY_URL = 'https://usc.cdn.moq.dev/anon';
const BROADCAST_NAME = 'file-playback';
const VIDEO_PATH = join(__dirname, 'videos', 'bbb.mp4');

let catalogData = null;

async function loadVideoFile() {
  console.log('Loading video file:', VIDEO_PATH);

  const input = new Input({
    formats: ALL_FORMATS,
    source: new FilePathSource(VIDEO_PATH)
  });

  const videoTracks = await input.getVideoTracks();
  const audioTracks = await input.getAudioTracks();

  if (videoTracks.length === 0 || audioTracks.length === 0) {
    throw new Error('Video file must have both video and audio tracks');
  }

  const videoTrack = videoTracks[0];
  const audioTrack = audioTracks[0];

  const videoDecoderConfig = await videoTrack.getDecoderConfig();
  const audioDecoderConfig = await audioTrack.getDecoderConfig();

  // Convert description to base64 if present
  if (videoDecoderConfig.description) {
    const description = new Uint8Array(videoDecoderConfig.description);
    videoDecoderConfig.description = Buffer.from(description).toString('base64');
  }

  if (audioDecoderConfig.description) {
    const description = new Uint8Array(audioDecoderConfig.description);
    audioDecoderConfig.description = Buffer.from(description).toString('base64');
  }

  console.log('Video Decoder Config:');
  console.log(JSON.stringify(videoDecoderConfig, null, 2));
  console.log('\nAudio Decoder Config:');
  console.log(JSON.stringify(audioDecoderConfig, null, 2));

  catalogData = {
    video: {
      renditions: {
        video0: videoDecoderConfig
      },
      priority: 1
    },
    audio: {
      renditions: {
        audio0: audioDecoderConfig
      },
      priority: 2
    }
  };

  console.log('\nCatalog created');
}

async function startMoqPublisher() {
  console.log('Connecting to relay:', RELAY_URL);
  const connection = await Moq.Connection.connect(new URL(RELAY_URL));
  console.log('Connected to relay');

  const broadcast = new Moq.Broadcast();
  connection.publish(BROADCAST_NAME, broadcast);
  console.log('Publishing broadcast:', BROADCAST_NAME);

  // Listen for catalog requests
  (async () => {
    while (true) {
      const trackRequest = await broadcast.requested();
      const requestedTrack = trackRequest.track;

      console.log('Track requested:', requestedTrack.name);

      if (requestedTrack.name === 'catalog.json') {
        const catalogJson = JSON.stringify(catalogData);
        const group = requestedTrack.appendGroup();
        group.writeString(catalogJson);
        group.close();
        console.log('Sent catalog');
      }
    }
  })();

  console.log('MoQ publisher ready, waiting for catalog requests...');
}

// Start Express server
app.listen(PORT, async () => {
  console.log(`Express server listening on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/playback.html to test`);

  // Load video file first
  await loadVideoFile();

  // Start MoQ publisher after video is loaded
  startMoqPublisher().catch(console.error);
});
