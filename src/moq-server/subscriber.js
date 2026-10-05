import express from 'express';
import * as Moq from '@moq/net';
import { Output, EncodedPacket, EncodedVideoPacketSource, EncodedAudioPacketSource, FilePathTarget, Mp4OutputFormat } from 'mediabunny';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

// Serve TypeScript files as JavaScript modules
app.use(express.static(join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.ts')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

const PORT = 3000;
const RECORDINGS_DIR = join(__dirname, 'recordings');
const RELAY_URL = 'https://cdn.moq.dev/anon';
const BROADCAST_NAME = 'server-recording';

// Ensure recordings directory exists
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// State
let currentRecording = null;
let videoDecoderConfig = null;
let audioDecoderConfig = null;
let addedAudioConfig = false;
let addedVideoConfig = false;
let moqConnection = null;
let catalog = null;
let broadcast = null;

/**
 * Parse video frame from MoQ format: [timestamp (8 bytes)] [data]
 */
function parseVideoFrame(buffer, isKeyframe) {
  const view = new DataView(buffer.buffer, buffer.byteOffset);
  const timestamp = Number(view.getBigUint64(0, true));
  const type = isKeyframe ? 'key' : 'delta';
  const data = buffer.slice(8);

  return { timestamp, type, data };
}

/**
 * Parse audio frame from MoQ format: [timestamp (8 bytes)] [data]
 */
function parseAudioFrame(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset);
  const timestamp = Number(view.getBigUint64(0, true));
  const data = buffer.slice(8);

  return { timestamp, data };
}

/**
 * Resolves once the browser has announced the broadcast on the relay. Without
 * `announced: true` the request resolves blindly, and subscribing before the
 * publisher announces is reset with code 54 (Unroutable)
 */
async function waitForBroadcast(request) {
  let active = request.active.peek();
  while (!active) active = await request.active.changed();
  return active;
}

/**
 * Get catalog from broadcast
 */
async function getCatalog(broadcast) {
  try {
    console.log('Requesting catalog...');
    const catalogTrack = broadcast.track('catalog.json').subscribe();
    const catalogGroup = await catalogTrack.recvGroup();
    const catalogData = await catalogGroup.readJson();
    console.log('Received catalog');
    return catalogData;
  } catch (e) {
    console.error('Error getting catalog, retrying...', e.message);
    await new Promise((r) => setTimeout(r, 500));
    return await getCatalog(broadcast);
  }
}

/**
 * Start recording
 */
async function startRecording(config) {



  const videoTrack = broadcast.track('video').subscribe();



  const audioTrack = broadcast.track('audio').subscribe();





  processVideoTrack(videoTrack);


  processAudioTrack(audioTrack)


  //await new Promise((r) => setTimeout(r, 100));


  // Subscribe to tracks




  console.log('Subscribed to video and audio tracks');
  console.log('Ready to record when publisher starts streaming');


  console.log("Video track", videoTrack)






  if (currentRecording) {
    throw new Error('Already recording');
  }



  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = join(RECORDINGS_DIR, `recording-${timestamp}.mp4`);

  console.log('Creating output file:', outputPath);
  console.log('Video config:', config.video);
  console.log('Audio config:', config.audio);

  // Create output using MediaBunny API
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new FilePathTarget(outputPath),
  });

  // Create sources
  const videoSource = new EncodedVideoPacketSource('avc');
  const audioSource = new EncodedAudioPacketSource('opus');

  output.addVideoTrack(videoSource);
  output.addAudioTrack(audioSource);

  // Start output
  await output.start();

  // Reset config flags for new recording
  addedAudioConfig = false;
  addedVideoConfig = false;

  currentRecording = {
    output,
    videoSource,
    audioSource,
    outputPath,
    startTime: Date.now(),
    videoFrames: 0,
    audioFrames: 0,
    firstVideoTimestamp: null,
    firstAudioTimestamp: null
  };

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
  console.log(`Recorded ${currentRecording.videoFrames} video frames, ${currentRecording.audioFrames} audio frames`);

  const { output, outputPath } = currentRecording;

  currentRecording = null;

  // Finalize the output file
  await output.finalize();

  console.log(`Recording saved: ${outputPath}`);
  return { outputPath };
}

/**
 * Handle incoming video frame
 */
async function handleVideoFrame(frame, isKeyframe) {
  try {
    // Only write frames if recording
    if (!currentRecording) {
      return;
    }



    // Set first timestamp on first keyframe
    if (isKeyframe && currentRecording.firstVideoTimestamp === null) {
      currentRecording.firstVideoTimestamp = frame.timestamp;
    }

    // Skip frames until we have a keyframe
    if (currentRecording.firstVideoTimestamp === null) {
      return;
    }

    const relativeTimestamp = (frame.timestamp - currentRecording.firstVideoTimestamp) / 1e6;
    const packet = new EncodedPacket(frame.data, frame.type, relativeTimestamp, 0);

    // Add decoderConfig on first packet only
    if (!addedVideoConfig) {
      currentRecording.videoSource.add(packet, { decoderConfig: videoDecoderConfig });
      addedVideoConfig = true;
      console.log('Added video decoderConfig to first packet');
    } else {
      currentRecording.videoSource.add(packet);
    }

    currentRecording.videoFrames++;
  } catch (error) {
    console.error('Error handling video frame:', error);
  }
}

/**
 * Handle incoming audio frame
 */
async function handleAudioFrame(frame) {
  try {
    // Only write frames if recording
    if (!currentRecording) {
      return;
    }

    // Set first timestamp on first audio frame
    if (currentRecording.firstAudioTimestamp === null) {
      currentRecording.firstAudioTimestamp = frame.timestamp;
    }

    const relativeTimestamp = (frame.timestamp - currentRecording.firstAudioTimestamp) / 1e6;
    const packet = new EncodedPacket(frame.data, 'key', relativeTimestamp, 0);

    // Add decoderConfig on first packet only
    if (!addedAudioConfig) {
      currentRecording.audioSource.add(packet, { decoderConfig: audioDecoderConfig });
      addedAudioConfig = true;
      console.log('Added audio decoderConfig to first packet');
    } else {
      currentRecording.audioSource.add(packet);
    }

    currentRecording.audioFrames++;
  } catch (error) {
    console.error('Error handling audio frame:', error);
  }
}

/**
 * Process video track from MoQ
 */
async function processVideoTrack(videoTrack) {
  console.log('Processing video track...');

  const videoRendition = Object.values(catalog.video.renditions)[0];

  // Prepare decoderConfig for MediaBunny
  videoDecoderConfig = {
    codec: videoRendition.codec,
    codedWidth: videoRendition.codedWidth,
    codedHeight: videoRendition.codedHeight,
  };

  // Add description if present (required for AVC)
  if (videoRendition.description) {
    const base64 = videoRendition.description;
    const binaryString = Buffer.from(base64, 'base64').toString('binary');
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    videoDecoderConfig.description = bytes;
  }

  console.log('Video decoder config ready');

  try {
    while (true) {
      const group = await videoTrack.recvGroup();
      if (!group) break;

      // First frame in group is always a keyframe
      let isKeyframe = true;

      // Read all frames in the group
      for (;;) {
        const moqFrame = await group.readFrame();
        if (!moqFrame) break;

        const frame = parseVideoFrame(moqFrame.payload, isKeyframe);
        await handleVideoFrame(frame, isKeyframe);

        isKeyframe = false; // Subsequent frames are delta
      }
    }
  } catch (error) {
    console.error('Video processing error:', error);
  }
}

/**
 * Process audio track from MoQ
 */
async function processAudioTrack(audioTrack) {
  console.log('Processing audio track...');

  const audioRendition = Object.values(catalog.audio.renditions)[0];

  // Prepare decoderConfig for MediaBunny
  audioDecoderConfig = {
    codec: audioRendition.codec,
    sampleRate: audioRendition.sampleRate,
    numberOfChannels: audioRendition.numberOfChannels,
  };

  console.log('Audio decoder config ready');

  try {
    while (true) {
      const group = await audioTrack.recvGroup();
      if (!group) break;

      const moqFrame = await group.readFrame();
      if (!moqFrame) continue;

      const frame = parseAudioFrame(moqFrame.payload);
      await handleAudioFrame(frame);
    }
  } catch (error) {
    console.error('Audio processing error:', error);
  }
}

/**
 * Connect to MoQ relay and subscribe to broadcast
 */
async function connectToMoQ() {
  try {
    console.log('Connecting to MoQ relay:', RELAY_URL);
    const origin = new Moq.Origin.Producer();
    moqConnection = await Moq.Connection.connect({ url: new URL(RELAY_URL), consume: origin });
    console.log('Connected to MoQ relay');

    // Wait for the browser to announce the broadcast
    console.log(`Waiting for broadcast: ${BROADCAST_NAME}`);
    broadcast = await waitForBroadcast(origin.request(Moq.Path.from(BROADCAST_NAME), { announced: true }));
    console.log(`Consuming broadcast: ${BROADCAST_NAME}`);

    // Get catalog
    catalog = await getCatalog(broadcast);
    console.log('Catalog received, waiting for publisher to start streaming...');

  } catch (error) {
    console.error('MoQ connection error:', error);
    console.error('Retrying in 5 seconds...');
    setTimeout(connectToMoQ, 5000);
  }
}

// API endpoints
app.get('/api/status', (req, res) => {
  res.json({
    recording: currentRecording !== null,
    outputPath: currentRecording?.outputPath || null,
    duration: currentRecording ? Date.now() - currentRecording.startTime : 0,
    videoFrames: currentRecording?.videoFrames || 0,
    audioFrames: currentRecording?.audioFrames || 0,
    moqConnected: moqConnection !== null,
    catalogReceived: catalog !== null
  });
});

app.post('/api/start-recording', async (req, res) => {
  try {
    if (!catalog) {
      res.status(400).json({ error: 'No catalog received yet' });
      return;
    }

    const config = {
      video: Object.values(catalog.video.renditions)[0],
      audio: Object.values(catalog.audio.renditions)[0]
    };

    await startRecording(config);
    res.json({ success: true, outputPath: currentRecording.outputPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/stop-recording', async (req, res) => {
  try {
    const result = await stopRecording();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Express server
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Recordings will be saved to: ${RECORDINGS_DIR}`);
  console.log(`Broadcast name: ${BROADCAST_NAME}`);
  console.log('---');
});

// Connect to MoQ relay
connectToMoQ();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down...');
  if (currentRecording) {
    await stopRecording();
  }
  process.exit(0);
});
