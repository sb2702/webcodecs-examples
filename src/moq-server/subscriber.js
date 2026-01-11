import express from 'express';
import { WebSocketServer } from 'ws';
import { Output, EncodedPacket, EncodedVideoPacketSource,EncodedAudioPacketSource, FilePathTarget, WebMOutputFormat } from 'mediabunny';
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
let videoDecoderConfig = null;
let audioDecoderConfig = null;

/**
 * Parse binary frame format:
 * [type (1 byte)][timestamp (8 bytes)][duration (8 bytes)][keyframe (1 byte)]
 * [configLength (4 bytes)][config JSON][descLength (4 bytes)][description][data]
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

  let offset = 0;
  offset += 1; // type
  const timestamp = Number(view.getBigUint64(offset, true)); offset += 8;
  const duration = Number(view.getBigUint64(offset, true)); offset += 8;
  const keyframe = view.getUint8(offset) === 1; offset += 1;
  const configLength = view.getUint32(offset, true); offset += 4;

  let decoderConfig = null;

  if (configLength > 0) {
    // Parse config JSON
    const configBytes = buffer.slice(offset, offset + configLength);
    const configJson = new TextDecoder().decode(configBytes);
    const meta = JSON.parse(configJson);
    decoderConfig = meta.decoderConfig || null;
    offset += configLength;

    // Parse description
    const descLength = view.getUint32(offset, true); offset += 4;
    if (descLength > 0 && decoderConfig) {
      const description = buffer.slice(offset, offset + descLength);
      decoderConfig.description = description;
      offset += descLength;
    }
  }

  const data = buffer.slice(offset);

  return {
    type: type === 0 ? 'video' : 'audio',
    timestamp,
    duration,
    keyframe,
    decoderConfig,
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
  const outputPath = join(RECORDINGS_DIR, `recording-${timestamp}.webm`);

  console.log('Creating output file:', outputPath);
  console.log('Video config:', config.video);
  console.log('Audio config:', config.audio);

  // Create output using MediaBunny API
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new FilePathTarget(outputPath),
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
    audioFrames: 0,
    firstVideoTimestamp: null,
    firstAudioTimestamp: null
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

  currentRecording = null;
  //recordingClient = null;

  // Finalize the output file
  await output.finalize();

  const stats = {


  };



  console.log(`Recording saved: ${outputPath}`);
  return stats;
}

/**
 * Handle incoming frame data
 */


let addedAudioConfig = false;
let addedVideoConfig  = false;

async function handleFrame(frame) {
  try {
    // Always cache decoderConfig (even when not recording)
    if (frame.type === 'video' && frame.decoderConfig) {
      videoDecoderConfig = frame.decoderConfig;
      console.log('Received video decoderConfig:', videoDecoderConfig);
    } else if (frame.type === 'audio' && frame.decoderConfig) {
      audioDecoderConfig = frame.decoderConfig;
      console.log('Received audio decoderConfig:', audioDecoderConfig);
    }

    // Only write frames if recording
    if (!currentRecording) {
      return;
    }

    if (frame.type === 'video') {
      // Set first timestamp on first keyframe
      if (frame.keyframe && currentRecording.firstVideoTimestamp === null) {
        currentRecording.firstVideoTimestamp = frame.timestamp;
      }

      // Skip frames until we have a keyframe
      if (currentRecording.firstVideoTimestamp === null) {
        return;
      }

      const relativeTimestamp = (frame.timestamp - currentRecording.firstVideoTimestamp);
      const packetType = frame.keyframe ? 'key' : 'delta';
      const packet = new EncodedPacket(frame.data, packetType, relativeTimestamp/1e6, frame.duration/1e6);

      // Pass decoderConfig as meta
//  currentRecording.videoSource.add(packet, videoDecoderConfig ? { decoderConfig: videoDecoderConfig } : undefined);

      if(!addedVideoConfig){
        currentRecording.videoSource.add(packet, { decoderConfig: videoDecoderConfig });
        addedVideoConfig = true;
      } else{
        currentRecording.videoSource.add(packet);
      }

      currentRecording.videoFrames++;
    } else if (frame.type === 'audio') {
      // Set first timestamp on first audio frame
      if (currentRecording.firstAudioTimestamp === null) {
        currentRecording.firstAudioTimestamp = frame.timestamp;
      }

      const relativeTimestamp = (frame.timestamp - currentRecording.firstAudioTimestamp);
      const packet = new EncodedPacket(frame.data, 'key', relativeTimestamp/1e6, frame.duration/1e6);

      // Pass decoderConfig as meta



      if(!addedAudioConfig){
        currentRecording.audioSource.add(packet, { decoderConfig: audioDecoderConfig } );
      } else{
        currentRecording.audioSource.add(packet);
      }

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
