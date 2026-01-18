import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;
import * as Moq from '@moq/lite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

// Serve static files from public directory
app.use(express.static(join(__dirname, 'public')));

const PORT = 3000;
const RELAY_URL = 'https://usc.cdn.moq.dev/anon';
const BROADCAST_NAME = 'file-playback';

// Hardcoded catalog for now
const catalogData = {
  video: {
    renditions: {
      video0: {
        codec: "avc1.64001f",
        codedWidth: 1280,
        codedHeight: 720,
        description: ""
      }
    },
    priority: 1
  },
  audio: {
    renditions: {
      audio0: {
        codec: "opus",
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000
      }
    },
    priority: 2
  }
};

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
app.listen(PORT, () => {
  console.log(`Express server listening on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/playback.html to test`);

  // Start MoQ publisher after Express is running
  startMoqPublisher().catch(console.error);
});
