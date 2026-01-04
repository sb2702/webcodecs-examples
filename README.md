# WebCodecs Examples

Complete, production-ready WebCodecs implementation examples for [WebCodecs Fundamentals](https://webcodecsfundamentals.org).

## Examples

### 🎬 [Video Player](./player) *(in progress)*
Full-featured video player demonstrating:
- Play/pause/seek controls
- Audio-video synchronization
- Worker-based decoding
- GPU rendering
- Timeline UI
- Volume & playback speed controls

**Live Demo**: Coming soon
**Source**: [/player](./player)

---

### 🔄 [Video Transcoding](./transcoding) *(planned)*
Transcode videos with different codecs, resolutions, and quality settings:
- Input: MP4/WebM
- Output: MP4/WebM with custom settings
- Audio pass-through (no re-encoding)
- Progress reporting

**Live Demo**: Coming soon
**Source**: [/transcoding](./transcoding)

---

### ✂️ [Video Editing](./editing) *(planned)*
Timeline-based video editing with:
- Cut/trim operations
- Multiple video sources
- Transitions
- Audio mixing

**Live Demo**: Coming soon
**Source**: [/editing](./editing)

---

### 📡 [Live Streaming](./live-streaming) *(planned)*
Live video stream ingestion and playback

**Live Demo**: Coming soon
**Source**: [/live-streaming](./live-streaming)

---

## Purpose

These examples complement the [WebCodecs Fundamentals](https://webcodecsfundamentals.org) documentation by providing:
- **Working code** you can study and learn from
- **Live demos** you can interact with
- **Starter templates** you can clone for your own projects

The fundamentals docs teach concepts. These examples show production implementation.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/sb2702/webcodecs-examples.git
cd webcodecs-examples

# Run the player example
cd player
npm install
npm run dev
```

## Related Projects

- **[WebCodecs Fundamentals](https://webcodecsfundamentals.org)** - Learn WebCodecs concepts
- **[webcodecs-utils](https://www.npmjs.com/package/webcodecs-utils)** - Utility library used in these examples
- **[MediaBunny](https://mediabunny.dev/)** - Full-featured WebCodecs library

## Browser Support

These examples require:
- **Chrome 94+** or **Edge 94+** (full support)
- **Safari 17.4+** (partial support)

All examples include feature detection and graceful degradation.

## Contributing

Contributions welcome! Please:
1. Keep examples focused and production-quality
2. Follow existing code style
3. Include inline comments explaining WebCodecs patterns
4. Test in Chrome, Edge, and Safari

## License

MIT

## Credits

Built for WebCodecs Fundamentals by Sam Bhattacharyya ([@sb2702](https://github.com/sb2702))

Created by the team at [Free.Upscaler.Video](https://free.upscaler.video)
