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
├── player/           # Full-featured video player with WebCodecs
├── transcoding/      # Video transcoding example
├── editing/          # Video editing with timeline (future)
├── live-streaming/   # Live streaming example (future)
└── shared/           # Shared utilities (if needed)
```

Each example is:
- Self-contained with its own package.json
- Deployable independently
- Well-documented with inline comments
- Production-quality code (not just demos)

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

**TODO**: Clean up and migrate to `/player` in this repo

## Example: Player

The player example will be the cleaned-up version of WebCodecsPlayerPublic with:

**Core Features**:
- Play/pause/seek controls
- Audio-video sync using Web Audio API timeline
- Worker-based video decoding for performance
- GPU rendering (WebGPU with canvas fallback)
- Timeline/scrubber UI
- Volume control
- Playback speed control with pitch correction (SoundTouch)

**Architecture** (from existing code):
```
Main Thread:
├── WebCodecsPlayer - Main controller
├── VideoWorker - Manages video decoder worker
├── WebAudioPlayer - Audio playback & timeline
└── Canvas - Video rendering target

Worker Thread:
└── file.ts worker - MP4 demuxing with MP4Box
```

**Key Implementation Details** (from WebCodecsPlayerPublic):
- Uses `VideoDecoder` in worker for frame decoding
- Audio playback via Web Audio API (not WebCodecs AudioDecoder)
- Sync mechanism: Audio timeline drives video rendering
- Decode buffer management to prevent memory issues
- Frame dropping when decoder can't keep up

## Example: Transcoding

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

## Next Steps

1. **Clean up WebCodecsPlayerPublic** → `/player`
   - Remove Katana-specific code
   - Add comprehensive comments
   - Create standalone demo
   - Write README

2. **Extract transcoding from production app** → `/transcoding`
   - Simplify to core transcoding logic
   - Remove app-specific UI
   - Create minimal UI for demo
   - Write README

3. **Create basic structure**:
   - Root README
   - Shared deployment config
   - License (MIT)

4. **Future examples**:
   - `/editing` - Timeline-based editing
   - `/live-streaming` - Live stream ingestion/playback

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
