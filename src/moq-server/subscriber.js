import express from 'express';
import cors from 'cors';
import * as Moq from '@moq/lite';
import { Output } from 'mediabunny';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const PORT = 3000;
const RELAY_URL = 'http://localhost:4443';
const RECORDINGS_DIR = join(__dirname, 'recordings');

// Ensure recordings directory exists
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// State
let moqConnection = null;
let currentRecording = null;

/**
 * Parse Hang protocol video frame
 * Format: [timestamp (8 bytes)] [data]
 */
function parseVideoFrame(buffer, isKeyframe) {
  const view = new DataView(buffer.buffer, buffer.byteOffset);
  const timestamp = Number(view.getBigUint64(0, true));
  const type = isKeyframe ? 'key' : 'delta';
  const data = buffer.slice(8);

  return { timestamp, type, data };
}

/**
 * Parse Hang protocol audio frame
 * Format: [timestamp (8 bytes)] [data]
 */
function parseAudioFrame(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset);
  const timestamp = Number(view.getBigUint64(0, true));
  const data = buffer.slice(8);

  return { timestamp, data };
}

/**
 * Subscribe to MoQ broadcast and save to file
 */
async function startRecording(broadcastName) {
  if (currentRecording) {
    throw new Error('Already recording');
  }

  console.log(`Connecting to relay: ${RELAY_URL}`);
  moqConnection = await Moq.Connection.connect(new URL(RELAY_URL));

  console.log(`Consuming broadcast: ${broadcastName}`);
  const broadcast = moqConnection.consume(broadcastName);

  // Get catalog
  console.log('Waiting for catalog...');
  const catalogTrack = broadcast.subscribe('catalog.json');

  let catalog;
  for (;;) {
    const catalogGroup = await catalogTrack.nextGroup();
    if (catalogGroup) {
      const catalogJson = await catalogGroup.readString();
      catalog = JSON.parse(catalogJson);
      console.log('Received catalog:', catalog);
      break;
    }
  }

  // Subscribe to video and audio tracks
  const videoTrack = await broadcast.subscribe('video');
  const audioTrack = await broadcast.subscribe('audio');
  console.log('Subscribed to video and audio tracks');

  // Create output file with MediaBunny
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = join(RECORDINGS_DIR, `recording-${timestamp}.mp4`);

  const videoRendition = Object.values(catalog.video.renditions)[0];
  const audioRendition = Object.values(catalog.audio.renditions)[0];

  const output = Output.create(outputPath, {
    video: {
      codec: videoRendition.codec.startsWith('avc') ? 'h264' : 'vp9',
      width: videoRendition.codedWidth,
      height: videoRendition.codedHeight,
    },
    audio: {
      codec: audioRendition.codec.startsWith('opus') ? 'opus' : 'aac',
      sampleRate: audioRendition.sampleRate,
      channels: audioRendition.numberOfChannels,
    }
  });

  currentRecording = {
    broadcast,
    output,
    outputPath,
    videoTrack,
    audioTrack,
    startTime: Date.now()
  };

  // Start reading video frames
  (async () => {
    try {
      while (currentRecording) {
        const group = await videoTrack.nextGroup();
        if (!group) break;

        let isKeyframe = true;

        for (;;) {
          const frameData = await group.readFrame();
          if (!frameData) break;

          const frame = parseVideoFrame(frameData, isKeyframe);

          // Write to output using MediaBunny
          await output.video({
            data: frame.data,
            timestamp: frame.timestamp,
            keyframe: isKeyframe
          });

          isKeyframe = false;
        }
      }
    } catch (error) {
      if (currentRecording) {
        console.error('Video read error:', error);
      }
    }
  })();

  // Start reading audio frames
  (async () => {
    try {
      while (currentRecording) {
        const group = await audioTrack.nextGroup();
        if (!group) break;

        const frameData = await group.readFrame();
        if (!frameData) continue;

        const frame = parseAudioFrame(frameData);

        // Write to output using MediaBunny
        await output.audio({
          data: frame.data,
          timestamp: frame.timestamp
        });
      }
    } catch (error) {
      if (currentRecording) {
        console.error('Audio read error:', error);
      }
    }
  })();

  console.log(`Recording started: ${outputPath}`);
  return { outputPath };
}

/**
 * Stop recording and finalize file
 */
async function stopRecording() {
  if (!currentRecording) {
    throw new Error('No active recording');
  }

  console.log('Stopping recording...');
  const { output, outputPath } = currentRecording;

  // Finalize the output file
  await output.finalize();

  // Close MoQ connection
  if (moqConnection) {
    await moqConnection.close();
    moqConnection = null;
  }

  currentRecording = null;
  console.log(`Recording saved: ${outputPath}`);

  return { outputPath };
}

// API endpoints
app.post('/api/start-recording', async (req, res) => {
  try {
    const { broadcastName } = req.body;

    if (!broadcastName) {
      return res.status(400).json({ error: 'broadcastName is required' });
    }

    const result = await startRecording(broadcastName);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Start recording error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/stop-recording', async (req, res) => {
  try {
    const result = await stopRecording();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Stop recording error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    recording: currentRecording !== null,
    outputPath: currentRecording?.outputPath || null,
    duration: currentRecording ? Date.now() - currentRecording.startTime : 0
  });
});

app.listen(PORT, () => {
  console.log(`MoQ Subscriber server running on http://localhost:${PORT}`);
  console.log(`Relay URL: ${RELAY_URL}`);
  console.log(`Recordings will be saved to: ${RECORDINGS_DIR}`);
});
