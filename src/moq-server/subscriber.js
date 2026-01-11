import express from 'express';
import { WebSocketServer } from 'ws';
import { Output, EncodedPacket, EncodedVideoPacketSource,EncodedAudioPacketSource, BufferTarget, Mp4OutputFormat } from 'mediabunny';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const PORT = 3000;
const RECORDINGS_DIR = join(__dirname, 'recordings');

// Ensure recordings directory exists
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// State
let currentRecording = null;
let recordingClient = null;

/**
 * Parse binary frame format: [type (1 byte)][timestamp (8 bytes)][data]
 * type: 0 = video, 1 = audio, 2 = config
 */
function parseFrame(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset);

  const type = view.getUint8(0);

  if (type === 2) {
    // Config message: [type][config JSON]
    const configJson = buffer.slice(1).toString();
    return { type: 'config', config: JSON.parse(configJson) };
  }

  const timestamp = Number(view.getBigUint64(1, true));
  const keyframe = view.getUint8(9) === 1;
  const data = buffer.slice(10);

  return {
    type: type === 0 ? 'video' : 'audio',
    timestamp,
    keyframe,
    data
  };
}

/**
 * Start recording from WebSocket stream
 */
async function startRecording(ws, config) {
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
    target: new BufferTarget(),
  });

  // Create video source
  const videoCodec = config.video.codec.startsWith('avc') ? 'avc' :
                     config.video.codec.startsWith('vp9') ? 'vp9' : 'av1';
  const videoSource = new EncodedVideoPacketSource(videoCodec);
  output.addVideoTrack(videoSource);

  // Create audio source
  const audioCodec = config.audio.codec.startsWith('opus') ? 'opus' : 'aac';
  const audioSource = new EncodedAudioPacketSource(audioCodec );
  output.addAudioTrack(audioSource);

  // Start output
  await output.start();

  currentRecording = {
    output,
    videoSource,
    audioSource,
    outputPath,
    startTime: Date.now(),
    videoFrames: 0,
    audioFrames: 0
  };

  recordingClient = ws;

  console.log(`Recording started: ${outputPath}`);
  ws.send(JSON.stringify({ type: 'recording-started', outputPath }));

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

  // Finalize the output file
  await output.finalize();

  const stats = {
    outputPath,
    duration: Date.now() - currentRecording.startTime,
    videoFrames: currentRecording.videoFrames,
    audioFrames: currentRecording.audioFrames
  };

  currentRecording = null;
  recordingClient = null;

  console.log(`Recording saved: ${outputPath}`);
  return stats;
}

/**
 * Handle incoming frame data
 */
async function handleFrame(frame) {




  if (!currentRecording) {
    return; // Not recording, ignore frame
  }

  try {
    if (frame.type === 'video') {
      // Create EncodedVideoChunk
      const chunk = new EncodedVideoChunk({
        type: frame.keyframe ? 'key' : 'delta',
        timestamp: frame.timestamp,
        data: frame.data
      });

      // Add to video source
      const packet = EncodedPacket.fromEncodedVideoChunk(chunk);
      currentRecording.videoSource.add(packet);
      currentRecording.videoFrames++;
    } else if (frame.type === 'audio') {
      // Create EncodedAudioChunk
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: frame.timestamp,
        data: frame.data
      });

      // Add to audio source
      const packet = EncodedPacket.fromEncodedAudioChunk(chunk);
      currentRecording.audioSource.add(packet);
      currentRecording.audioFrames++;
    }
  } catch (error) {
    console.error('Error writing frame:', error);
  }
}

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('Client connected');

  let config = null;

  ws.on('message', async (data) => {


    console.log("Websocket message")
    try {
      // Check if it's JSON (control message)
      if (data[0] === 0x7B) { // '{' character
        const message = JSON.parse(data.toString());

        if (message.type === 'config') {
          config = message;
          console.log('Received config:', config);
          ws.send(JSON.stringify({ type: 'config-received' }));
        } else if (message.type === 'start-recording') {
          if (!config) {
            ws.send(JSON.stringify({ type: 'error', message: 'Config not received' }));
            return;
          }
          startRecording(ws, config);
        } else if (message.type === 'stop-recording') {
          const stats = await stopRecording();
          ws.send(JSON.stringify({ type: 'recording-stopped', stats }));
        }
      } else {


    console.log("Data received");
        // Binary frame data
        const frame = parseFrame(data);
        if (frame.type === 'config') {
          config = frame.config;
          console.log('Received config:', config);
          ws.send(JSON.stringify({ type: 'config-received' }));
        } else {
          await handleFrame(frame);
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', async () => {
    console.log('Client disconnected');
    if (currentRecording && recordingClient === ws) {
      console.log('Client disconnected during recording, finalizing...');
      await stopRecording();
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  ws.send(JSON.stringify({ type: 'connected' }));
});

// Upgrade HTTP server to WebSocket
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}`);
  console.log(`Recordings will be saved to: ${RECORDINGS_DIR}`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// API endpoints for status
app.get('/api/status', (req, res) => {
  res.json({
    recording: currentRecording !== null,
    outputPath: currentRecording?.outputPath || null,
    duration: currentRecording ? Date.now() - currentRecording.startTime : 0,
    videoFrames: currentRecording?.videoFrames || 0,
    audioFrames: currentRecording?.audioFrames || 0
  });
});
