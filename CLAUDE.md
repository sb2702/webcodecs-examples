# WebCodecs Examples - Claude Context

This repository contains complete, production-ready WebCodecs implementation examples for the [WebCodecs Fundamentals](https://github.com/sb2702/webcodecs-fundamentals) documentation site.

## Purpose

WebCodecs Fundamentals teaches concepts and theory. This repo provides working reference implementations that readers can:
- View as live demos (deployed via Vercel/GitHub Pages)
- Study as complete source code
- Clone as starter templates for their own projects
- Embed in the documentation site via iframes

## Repository Structure

```
webcodecs-examples/
├── src/
│   ├── player/           # Full-featured video player with WebCodecs (COMPLETE)
│   │   ├── player.ts     # Main WebCodecsPlayer class
│   │   ├── clock.ts      # Clock manages timing, emits tick events
│   │   ├── file.ts       # Worker: MP4 demuxing with MP4Box
│   │   └── renderers/
│   │       ├── audio/    # Web Audio playback with segment loading
│   │       └── video/    # VideoDecoder in worker + GPU rendering
│   ├── transcoding/      # Video transcoding (COMPLETE)
│   ├── utils/            # Shared utilities
│   │   ├── WorkerController.ts  # Worker communication helper
│   │   └── EventEmitter.ts      # Simple event emitter
│   └── index.ts          # Main package entry (exports WebCodecsPlayer)
├── demos/
│   └── player/           # Standalone demo for player
└── dist/                 # Built package (single index.js with inlined workers)
```

**Current architecture**:
- Published as npm package with single-file build (workers inlined using `?worker&inline`)
- Uses `webcodecs-utils` for GPUFrameRenderer
- Clock-based event-driven architecture (audio & video subscribe to tick events)
- Workers loaded via `?worker&inline` for CDN compatibility

## Related Projects

### webcodecs-fundamentals
**Location**: `/home/sam/Code/webcodecs-fundamentals`
**Purpose**: Documentation website teaching WebCodecs concepts
**Tech**: Astro Starlight
**Relationship**: Embeds examples from this repo as iframes, links to source code

Key pages that will reference these examples:
- `src/content/docs/patterns/playback.md` → `/player`
- `src/content/docs/patterns/transcoding.md` → `/transcoding`
- `src/content/docs/patterns/editing.md` → `/editing`
- `src/content/docs/patterns/live-streaming.md` → `/live-streaming`

### webcodecs-utils
**Location**: `/home/sam/Code/webcodecs-utils`
**Purpose**: Production-ready utility library (published to npm)
**Current version**: 0.1.4
**What it provides**:
- `getBitrate(width, height, fps, quality)` - Calculate optimal bitrate
- `getCodecString(codec, width, height, bitrate)` - Generate proper codec strings
- `GPUFrameRenderer` - Zero-copy rendering with WebGPU
- `extractChannels(audioData)` - Extract audio channels from AudioData
- `MP3Encoder` / `MP3Decoder` - MP3 encoding/decoding
- `MP4Demuxer` - Parse MP4 files with MP4Box

**Examples should use webcodecs-utils** where appropriate to demonstrate real-world usage.

### WebCodecsPlayerPublic
**Location**: `/home/sam/Code/Katana/WebCodecsPlayerPublic`
**Status**: Working player implementation, needs cleanup
**Key files**:
- `src/player.ts` - Main player class with play/pause/seek
- `src/renderers/video/video.ts` & `video.worker.ts` - Video rendering with workers
- `src/renderers/audio/audio.ts` - Web Audio integration
- `src/file.ts` - File handling worker
- `demo/` - Demo implementation

**Status**: Migrated and cleaned up to `/src/player` ✓

## Example: Player (COMPLETE)

The player example is a cleaned-up, production-ready version with:

**Core Features**:
- Play/pause/seek controls
- Audio-video sync using Web Audio API timeline
- Worker-based video decoding for performance
- GPU rendering (WebGPU with canvas fallback)
- Timeline/scrubber UI
- Volume control
- Playback speed control with pitch correction (SoundTouch)

**Architecture**:
```
Main Thread:
├── WebCodecsPlayer - Main controller (src/player/player.ts)
├── Clock - Timing coordinator, emits 'tick' events at 30fps (src/player/clock.ts)
├── VideoWorker - Wrapper for video decoder worker (src/player/renderers/video/video.ts)
├── WebAudioPlayer - Audio playback with segment loading (src/player/renderers/audio/audio.ts)
└── Canvas - Video rendering target (OffscreenCanvas)

Worker Threads:
├── file.ts - MP4 demuxing with MP4Box (MessagePort communication)
└── video.worker.ts - VideoDecoder + GPUFrameRenderer

Event Flow:
Clock.tick() → emits 'tick' event → [AudioPlayer, VideoWorker].onClockTick()
```

**Key Implementation Details**:
- **Clock pattern**: Single `requestAnimationFrame` loop (30fps), both renderers subscribe to tick events
- **Audio timeline as source of truth**: `AudioContext.currentTime` provides sub-millisecond timing
- **Segment-based audio loading**: 30-second chunks loaded on-demand (not EncodedAudioChunk)
- **GPU rendering**: Uses `GPUFrameRenderer` from webcodecs-utils for zero-copy rendering
- **Worker communication**: MessagePort for file worker ↔ video worker, WorkerController helper
- **Terminology**: "segments" = time-based blocks (30s), not confused with EncodedAudioChunk
- **CDN-ready**: Workers inlined using `?worker&inline` for single-file distribution

## Example: Transcoding (COMPLETE)

Based on production app (Free.Upscaler.Video), key features:

**Core Features**:
- Input: MP4/WebM files
- Output: MP4/WebM with codec/resolution/quality options
- Video: Decode → (optional processing) → Encode
- Audio: Pass-through (copy EncodedAudioChunk directly, no re-encoding)
- Progress reporting
- Worker-based for non-blocking UI

**Key Implementation Details**:
- Chain VideoDecoder → VideoEncoder
- Manage encoder.encodeQueueSize to prevent memory overflow
- Batch decoding to keep pipeline full
- Handle decoder errors and recover at next keyframe
- Audio pass-through pattern (no AudioDecoder/AudioEncoder needed)

## Key WebCodecs Concepts These Examples Demonstrate

### From Documentation
Based on the fundamentals docs at `/home/sam/Code/webcodecs-fundamentals/src/content/docs/`:

**Basics** (from `basics/` folder):
1. **Codecs** - How to choose H264/VP9/AV1, codec strings, compatibility
2. **Decoder** - "Rube Goldberg machine" analogy, decode loops, warmup chunks, buffer management
3. **Encoder** - Bitrate selection, keyframe management, timestamp handling, encoding loops

**Audio** (from `audio/` folder):
1. **When to use WebCodecs Audio** - Often you don't! Use Web Audio API for playback
2. **AudioData** - Reading/writing raw audio samples, mixing, resampling
3. **Web Audio** - Timeline management (critical!), playback controls, pitch correction with SoundTouch

**Core Concepts** (from `concepts/` folder):
1. **CPU vs GPU** - VideoFrame memory management, when to use importExternalTexture
2. **Threading** - OffscreenCanvas, workers, SharedArrayBuffer considerations
3. **File Handling** - Demuxing, chunking, streaming large files

### Critical Patterns to Show

**Video Decoding Pipeline** (from `basics/decoder.md`):
```typescript
// Not this:
const frame = await decoder.decode(chunk);

// But this:
let decodeChunkIndex = 0;
const BATCH_DECODE_SIZE = 10;
const renderBuffer = [];

function fillBuffer() {
  for (let i = 0; i < BATCH_DECODE_SIZE; i++) {
    if (decoder.decodeQueueSize < DECODE_QUEUE_LIMIT) {
      decoder.decode(chunks[decodeChunkIndex++]);
    }
  }
}

const decoder = new VideoDecoder({
  output: (frame) => {
    renderBuffer.push(frame);
  }
});

// Render loop consumes frames from renderBuffer
```

**Audio-Video Sync** (from `audio/web-audio.md`):
```typescript
// Use AudioContext timeline as source of truth
const audioContext = new AudioContext();

// Audio playback
sourceNode.start(audioContext.currentTime, pausedAt);

// Video sync
function render() {
  const currentTime = audioContext.currentTime - audioStartTime + pausedAt;
  const frame = getFrameAtTime(currentTime);
  ctx.drawImage(frame, 0, 0);
}
```

**Memory Management**:
- Close VideoFrames immediately after use
- Limit decode/encode queue sizes
- Handle audio in chunks (not all at once)

**Error Recovery**:
- Decoder can fail mid-stream
- Reset decoder, seek to next keyframe
- Use `decoder.state` checks

## Technical Requirements

### Dependencies
Examples should use minimal, standard dependencies:
- **Required**: None (pure WebCodecs API)
- **Recommended**:
  - `webcodecs-utils` (our utility library)
  - `mp4box` (for MP4 demuxing)
  - Vite (for dev server & build)
  - TypeScript (for type safety)

### Browser Support
- Chrome 94+, Edge 94+ (full support)
- Safari 17.4+ (partial support)
- Include feature detection

### Code Quality
- TypeScript with strict mode
- Inline comments explaining WebCodecs-specific patterns
- Error handling and recovery
- Memory cleanup (close frames, disconnect nodes, etc.)

## Deployment

Each example should be deployable to:
- Vercel (preferred)
- GitHub Pages (alternative)
- Embeddable via iframe in fundamentals docs

## Build & Deployment

**Build configuration** (vite.config.ts):
- Single entry point: `src/index.ts`
- ES module format only
- Workers inlined using `?worker&inline` syntax
- All dependencies bundled (mp4box, mp4-muxer, localforage)
- Output: Single `dist/index.js` file (~1.8MB with inlined workers)

**Publishing**:
```bash
npm run build   # Build single file
npm publish     # Publish to npm
```

**CDN usage**: Works with esm.sh, unpkg, etc. because workers are inlined

## Next Steps

1. ✅ **Player** - Complete and published
   - [x] Clean up and migrate code
   - [x] Clock-based architecture
   - [x] GPU rendering with webcodecs-utils
   - [x] Single-file CDN build
   - [x] Published to npm

2. ✅ **Transcoding** - Complete
   - [x] Extract from production app
   - [x] Core transcoding logic
   - [x] Demo UI
   - [x] README

3. **Live Streaming** - In progress → `/src/live-streaming`
   - Live stream ingestion/playback
   - WebRTC integration
   - Low-latency playback
   - Create demo

4. **Future examples**:
   - `/editing` - Timeline-based editing

## Usage for Claude

When working on examples:
1. Keep code production-quality (not just demo code)
2. Use patterns from fundamentals docs
3. Import from webcodecs-utils where appropriate
4. Include extensive inline comments explaining WebCodecs concepts
5. Each example should work standalone
6. Think about how it will be embedded in docs

## Contact

Built for WebCodecs Fundamentals by Sam Bhattacharyya
- GitHub: [@sb2702](https://github.com/sb2702)
- Website: [webcodecsfundamentals.org](https://webcodecsfundamentals.org)
- Built by team at [Free.Upscaler.Video](https://free.upscaler.video)
