# Browser-to-Server Recording with MoQ

This demo showcases how the [@moq/net](https://www.npmjs.com/package/@moq/net) package can be used in server environments, specifically to record webcam video from a browser to a Node/Bun/Deno server using **Media over QUIC (MoQ)** as the transport layer.

![MoQ Server Demo](./moq-server-demo.png)



## Overview

Uhis demo uses a MoQ relay as an intermediary:

```
Browser (Publisher) → MoQ Relay ← Js Server (Subscriber)
```

Both the browser and server connect to a MoQ relay, allowing them to communicate without direct connections. The server subscribes to the broadcast and records incoming video/audio frames to an MP4 file using MediaBunny.

## Architecture

### Browser (Publisher)
- Captures webcam video/audio using `getUserMedia()`
- Encodes frames with WebCodecs (H.264 video, Opus audio)
- Publishes to MoQ relay using `@moq/net`
- Provides catalog with codec configuration

### Server (Subscriber)
- Connects to same MoQ relay using `@moq/net`
- Subscribes to video and audio tracks
- Receives encoded frames from relay
- Writes frames to MP4 file using MediaBunny

### Hang Protocol
- **Catalog**: Sent first, contains codec info (codec string, resolution, audio config)
- **Video Track**: Grouped by GOPs (Group of Pictures), each group starts with a keyframe
- **Audio Track**: Each audio chunk is its own group
- **Frame Format**: `[timestamp (8 bytes)] [chunk data]`

More details [here](https://webcodecsfundamentals.org/patterns/live-streaming/#hang-protocol)
## Setup

### Prerequisites

```bash
npm install
```

**Key dependencies:**
- `@moq/net` - MoQ client library (works in browser and Node.js)
- `mediabunny` - MP4 muxing library
- `express` - Web server for hosting the UI
- `ws` - WebSocket polyfill for Node.js (required by `@moq/net`)

### WebSocket Polyfill (Critical!)

`@moq/net` expects browser APIs, so Node.js needs a polyfill:

```javascript
import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;
```

This must be done **before** importing `@moq/net`.

## Usage

### 1. Start the server

```bash
npm run subscriber
```

This starts:
- Express server on `http://localhost:3000`
- MoQ subscriber connecting to relay
- Waits for broadcast named `server-recording`

### 2. Open the browser

Navigate to `http://localhost:3000/upload.html`

### 3. Record

1. Click **Start Webcam** - Request camera/microphone access
2. Click **Connect to Server** - Connect to MoQ relay and publish broadcast
3. Click **Start Streaming** - Server starts recording, frames begin flowing
4. Click **Stop Streaming** - Server stops and saves recording to `recordings/`

The MP4 file will be saved as `recordings/recording-[timestamp].mp4`.

