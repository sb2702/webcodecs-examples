# WebCodecs Player

A high-performance video player built with WebCodecs API, featuring GPU-accelerated rendering, worker-based architecture, and Web Audio API synchronization.

## Features

- ✅ **Zero-copy GPU rendering** via WebGPU with ImageBitmap fallback
- ✅ **Worker-based architecture** for non-blocking video decoding
- ✅ **Audio-video synchronization** using Web Audio API timeline
- ✅ **Chunked streaming** for efficient memory usage and fast seeking
- ✅ **MP4 demuxing** with webcodecs-utils
- ✅ **Play/pause/seek** controls with frame-accurate seeking

## Architecture

```
Main Thread (player.ts)
    │
    ├─> file.ts Worker (MP4 Demuxer)
    │   ├─> Parses MP4 files using webcodecs-utils MP4Demuxer
    │   ├─> Extracts audio chunks → Main thread (audio player)
    │   └─> Extracts video chunks → Video worker via MessagePort
    │
    ├─> video.worker.ts (Video Decoder Worker)
    │   ├─> Receives chunks from file worker via MessagePort
    │   ├─> Manages VideoRenderer instances (chunked playback)
    │   ├─> Decodes VideoFrames using VideoDecoder
    │   └─> Renders to OffscreenCanvas with GPUFrameRenderer
    │
    └─> audio.ts (Web Audio Player)
        ├─> Requests audio chunks from file worker
        ├─> Muxes chunks to AAC buffer using mp4-muxer
        ├─> Decodes with Web Audio API (AudioContext.decodeAudioData)
        └─> Provides timeline for video synchronization
```

## Key Components

### WebCodecsPlayer (`player.ts`)
Main controller that coordinates all components:
- Sets up MessageChannel for worker-to-worker communication
- Manages file worker, video worker, and audio player
- Handles play/pause/seek commands
- Emits time updates for UI synchronization

### File Worker (`file.ts`)
Pure MP4 demuxer worker:
- Uses webcodecs-utils `MP4Demuxer`
- Single source of truth for file parsing
- Sends audio chunks directly to main thread
- Forwards video chunks to video worker via MessagePort

### Video Worker (`video.worker.ts`)
Video decoding and rendering worker:
- Receives video chunks from file worker
- Manages multiple `VideoRenderer` instances (one per chunk)
- Decodes frames with `VideoDecoder`
- Renders to OffscreenCanvas

### VideoRenderer (`decoder.ts`)
Manages video decoding and GPU rendering:
- Uses webcodecs-utils `GPUFrameRenderer` for zero-copy rendering
- Buffers decoded frames for smooth playback
- Handles frame dropping when behind timeline
- Automatically recovers from decoder errors

### Audio Player (`audio.ts`)
Web Audio API integration:
- Muxes EncodedAudioChunks to AAC with mp4-muxer
- Decodes audio with `AudioContext.decodeAudioData`
- Provides timeline as source of truth for A/V sync
- Emits time updates for video rendering

## Usage

### Basic Example

```typescript
import { WebCodecsPlayer } from 'webcodecs-examples/player';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const file = await getVideoFile(); // File object

const player = new WebCodecsPlayer({
  src: file,
  canvas: canvas
});

await player.initialize();

// Play/pause
await player.play();
await player.pause();

// Seek
await player.seek(10.5); // Seek to 10.5 seconds

// Get current time
const currentTime = player.getCurrentTime();

// Get duration
const duration = player.duration;

// Listen to time updates
player.on('timeupdate', (time) => {
  console.log('Current time:', time);
  updateUI(time);
});

// Listen to play/pause events
player.on('play', () => console.log('Playing'));
player.on('pause', () => console.log('Paused'));

// Cleanup
player.terminate();
```

### With UI Controls

```typescript
const player = new WebCodecsPlayer({ src: file, canvas });
await player.initialize();

// Update timeline UI
player.on('timeupdate', (time) => {
  const progress = (time / player.duration) * 100;
  progressBar.value = progress;
  timeDisplay.textContent = formatTime(time);
});

// Seek on timeline click
progressBar.addEventListener('input', () => {
  const seekTime = (progressBar.value / 100) * player.duration;
  player.seek(seekTime);
});

// Play/pause button
playButton.addEventListener('click', () => {
  if (player.getCurrentTime() === 0) {
    player.play();
  } else {
    player.pause();
  }
});
```

## API Reference

### Constructor

```typescript
new WebCodecsPlayer(params: WebCodecsPlayerParams)
```

**Parameters:**
- `params.src: File` - Video file to play (MP4 format)
- `params.canvas: HTMLCanvasElement` - Canvas element for rendering

### Methods

#### `initialize(): Promise<void>`
Initialize the player. Must be called before playing.

```typescript
await player.initialize();
```

#### `play(): Promise<void>`
Start playback from current position.

```typescript
await player.play();
```

#### `pause(): Promise<void>`
Pause playback.

```typescript
await player.pause();
```

#### `seek(time: number): Promise<void>`
Seek to a specific time in seconds.

```typescript
await player.seek(30.5); // Seek to 30.5 seconds
```

#### `getCurrentTime(): number`
Get the current playback time in seconds.

```typescript
const currentTime = player.getCurrentTime();
```

#### `terminate(): void`
Clean up all resources (workers, decoders, audio context).

```typescript
player.terminate();
```

### Properties

#### `duration: number`
Video duration in seconds (available after initialization).

```typescript
console.log(`Video is ${player.duration} seconds long`);
```

### Events

The player extends `EventEmitter` and emits the following events:

#### `timeupdate`
Emitted continuously during playback with current time.

```typescript
player.on('timeupdate', (time: number) => {
  console.log('Current time:', time);
});
```

#### `play`
Emitted when playback starts.

```typescript
player.on('play', () => {
  console.log('Playback started');
});
```

#### `pause`
Emitted when playback pauses.

```typescript
player.on('pause', () => {
  console.log('Playback paused');
});
```

#### `terminated`
Emitted when player is terminated.

```typescript
player.on('terminated', () => {
  console.log('Player terminated');
});
```

## Performance Characteristics

### GPU Rendering
- **WebGPU mode**: Zero-copy rendering via `importExternalTexture()` - optimal performance
- **ImageBitmap fallback**: For browsers without WebGPU support
- Hardware-accelerated linear filtering by default

### Chunked Architecture
- Videos are split into chunks (default: 300 seconds per chunk)
- Only active chunks are kept in memory
- Fast seeking by loading relevant chunks on-demand
- Automatic chunk preloading before playback reaches chunk end

### Audio Decoding
- Audio chunks are muxed to AAC using mp4-muxer
- Decoded with Web Audio API (hardware accelerated)
- Chunked loading prevents memory issues with long videos

### Worker Threading
- File demuxing in dedicated worker (non-blocking)
- Video decoding in dedicated worker (non-blocking)
- Main thread only handles audio playback and UI updates

## Browser Support

- **Chrome 94+** (full support with WebGPU)
- **Edge 94+** (full support with WebGPU)
- **Safari 17.4+** (partial support, falls back to ImageBitmap)

Requires:
- WebCodecs API
- Web Audio API
- Workers with module support
- OffscreenCanvas
- WebGPU (optional, falls back to ImageBitmap)

## Dependencies

- `webcodecs-utils` - MP4Demuxer and GPUFrameRenderer
- `mp4-muxer` - Muxing audio chunks for Web Audio API
- `uuid` - Unique identifiers for worker messages

## Development

### Project Structure

```
src/player/
├── player.ts              # Main player controller
├── file.ts               # MP4 demuxer worker
├── renderers/
│   ├── audio/
│   │   └── audio.ts      # Web Audio player
│   └── video/
│       ├── video.ts      # Video worker manager
│       ├── video.worker.ts  # Video decoding worker
│       └── decoder.ts    # VideoRenderer with GPU rendering
└── README.md             # This file
```

### Key Patterns

**Audio-Video Sync:**
```typescript
// Audio timeline is source of truth
audioPlayer.on('time', (time) => {
  // Video renders the frame closest to this time
  videoWorker.render(time);
});
```

**Worker-to-Worker Communication:**
```typescript
// Main thread creates MessageChannel
const channel = new MessageChannel();

// Pass one port to each worker
fileWorker.postMessage({ port: channel.port1 }, [channel.port1]);
videoWorker.postMessage({ port: channel.port2 }, [channel.port2]);

// Workers communicate directly via MessagePorts
```

**Memory Management:**
```typescript
// Always close VideoFrames
decoder.output = (frame) => {
  renderer.drawImage(frame);
  frame.close(); // Important!
};
```

## License

MIT - See LICENSE file for details
