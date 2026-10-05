import express from 'express';
import * as Moq from '@moq/net';
// The same hand-written Hang helpers the browser demos use (Node strips the TypeScript types)
import * as Hang from '../moq/hang.ts';
import { Output, EncodedPacket, EncodedVideoPacketSource, EncodedAudioPacketSource, FilePathTarget, Mp4OutputFormat } from 'mediabunny';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

// Serve TypeScript files as JavaScript modules
// Serve the repo's own library build at /lib for upload.html?local
app.use('/lib', express.static(join(__dirname, '../../dist')));

app.use(express.static(join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.ts')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

const PORT = Number(process.env.PORT) || 3000;
const RECORDINGS_DIR = join(__dirname, 'recordings');
const RELAY_URL = 'https://cdn.moq.dev/anon';
const BROADCAST_NAME = Hang.broadcastName(process.env.BROADCAST || 'server-recording');

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
 * Read the next frame of a group, or undefined when the group ends.
 * A live group can be reset mid-stream (e.g. dropped by the relay): skip to the next group.
 */
async function readFrame(group) {
  try {
    return await group.readFrame();
  } catch (error) {
    console.warn(`Group ${group.sequence} reset, skipping to the next group:`, error.message);
    return undefined;
  }
}

/**
 * Get catalog from broadcast
 */
async function getCatalog(broadcast) {
  try {
    console.log('Requesting catalog...');
    const catalogTrack = broadcast.track(Hang.CATALOG_TRACK).subscribe({ priority: Hang.PRIORITY.catalog });
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



  // Subscribe using the track names the catalog lists
  const [videoName] = Hang.firstRendition(catalog.video?.renditions);
  const [audioName] = Hang.firstRendition(catalog.audio?.renditions);
  // A recorder wants every group in full, not just the live edge, so ask for the retention window
  const videoTrack = broadcast.track(videoName).subscribe({ priority: Hang.PRIORITY.video, maxAge: Hang.MEDIA_MAX_AGE_MS });
  const audioTrack = broadcast.track(audioName).subscribe({ priority: Hang.PRIORITY.audio, maxAge: Hang.MEDIA_MAX_AGE_MS });





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

// #region mux-video
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
}// #endregion mux-video


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

// #region read-video
/**
 * Process video track from MoQ
 */
async function processVideoTrack(videoTrack) {
  console.log('Processing video track...');

  const [, videoRendition] = Hang.firstRendition(catalog.video.renditions);

  // Prepare decoderConfig for MediaBunny (the catalog's description is hex)
  videoDecoderConfig = Hang.videoDecoderConfig(videoRendition);

  console.log('Video decoder config ready');

  try {
    while (true) {
      const group = await videoTrack.recvGroup();
      if (!group) break;

      // First frame in group is always a keyframe
      let isKeyframe = true;

      // Read all frames in the group
      for (;;) {
        const moqFrame = await readFrame(group);
        if (!moqFrame) break;

        // Hang legacy container: [timestamp varint (microseconds)] [codec payload]
        const { timestamp, data } = Hang.decodeFrame(moqFrame.payload);

        // An empty payload marks where the previous frame ends: it's not media
        if (data.byteLength === 0) continue;

        const frame = { timestamp, data, type: isKeyframe ? 'key' : 'delta' };
        await handleVideoFrame(frame, isKeyframe);

        isKeyframe = false; // Subsequent frames are delta
      }
    }
  } catch (error) {
    console.error('Video processing error:', error);
  }
}// #endregion read-video


/**
 * Process audio track from MoQ
 */
async function processAudioTrack(audioTrack) {
  console.log('Processing audio track...');

  const [, audioRendition] = Hang.firstRendition(catalog.audio.renditions);

  // Prepare decoderConfig for MediaBunny
  audioDecoderConfig = Hang.audioDecoderConfig(audioRendition);

  console.log('Audio decoder config ready');

  try {
    while (true) {
      const group = await audioTrack.recvGroup();
      if (!group) break;

      // Every audio frame is a keyframe, and a group may hold one or many of them
      for (;;) {
        const moqFrame = await readFrame(group);
        if (!moqFrame) break;

        const { timestamp, data } = Hang.decodeFrame(moqFrame.payload);
        if (data.byteLength === 0) continue; // end-of-audio marker, not media

        await handleAudioFrame({ timestamp, data });
      }
    }
  } catch (error) {
    console.error('Audio processing error:', error);
  }
}

/**
 * Track the announced broadcast, fetching its catalog each time a publisher (re)announces it
 */
async function followBroadcast(request) {
  let active = request.active.peek();
  for (;;) {
    if (active) {
      broadcast = active;
      console.log(`Consuming broadcast: ${BROADCAST_NAME}`);
      catalog = await getCatalog(active);
      console.log('Catalog received, waiting for publisher to start streaming...');
    } else if (broadcast) {
      console.log('Broadcast ended');
      broadcast = null;
      catalog = null;
    }
    active = await request.active.changed();
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

    // Follow the broadcast as it comes and goes: a reloaded browser announces a fresh one,
    // and subscriptions to an unannounced broadcast should be dropped
    console.log(`Waiting for broadcast: ${BROADCAST_NAME}`);
    followBroadcast(origin.request(Moq.Path.from(BROADCAST_NAME), { announced: true }));

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
