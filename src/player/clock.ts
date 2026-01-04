import EventEmitter from '../utils/EventEmitter';
import { WebAudioPlayer } from './renderers/audio/audio';
import { VideoWorker } from './renderers/video/video';

/**
 * Clock - Time Management for Video Playback
 *
 * The Clock is the central coordinator for playback timing. It:
 * - Uses the audio timeline as the source of truth (Web Audio API currentTime)
 * - Manages the requestAnimationFrame loop
 * - Emits tick events for UI updates
 * - Coordinates video rendering at the correct time
 * - Provides getCurrentTime() for on-demand queries
 *
 * Architecture:
 *
 *   Clock (this class)
 *     │
 *     ├─> Queries audioPlayer.getCurrentTime() ← Audio timeline is source of truth
 *     ├─> Emits 'tick' events with current time
 *     ├─> Calls videoWorker.render(time) passively
 *     └─> Provides getCurrentTime() for external queries
 *
 * Why use the audio timeline?
 * - Web Audio API provides high-precision timing via AudioContext.currentTime
 * - Hardware accelerated and synchronized with audio output
 * - More reliable than performance.now() for A/V sync
 */
export class Clock extends EventEmitter {

  private audioPlayer: WebAudioPlayer;
  private videoWorker: VideoWorker;
  private isPlaying: boolean = false;
  private animationFrame: number | null = null;
  private duration: number;

  // Frame rate management
  private readonly TARGET_FPS = 30; // Target 30fps for smooth playback
  private readonly FRAME_INTERVAL: number;
  private lastFrameTime = 0;

  /**
   * Create a new Clock
   * @param audioPlayer - Audio player with Web Audio timeline
   * @param videoWorker - Video worker for passive rendering
   * @param duration - Total video duration in seconds
   */
  constructor(audioPlayer: WebAudioPlayer, videoWorker: VideoWorker, duration: number) {
    super();

    this.audioPlayer = audioPlayer;
    this.videoWorker = videoWorker;
    this.duration = duration;
    this.FRAME_INTERVAL = 1000 / this.TARGET_FPS;
  }

  /**
   * Start playback
   *
   * Starts the audio player and begins the tick loop.
   * The tick loop queries the audio timeline and drives video rendering.
   */
  async play(): Promise<void> {
    if (this.isPlaying) return;

    this.isPlaying = true;

    // Start audio playback (this starts the timeline)
    await this.audioPlayer.play();

    // Start the tick loop
    this.lastFrameTime = performance.now();
    this.tick();

    this.emit('play');
  }

  /**
   * Pause playback
   *
   * Pauses audio and stops the tick loop.
   */
  pause(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    // Pause audio
    this.audioPlayer.pause();

    // Stop the tick loop
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.emit('pause');
  }

  /**
   * Seek to a specific time
   *
   * @param time - Time in seconds
   */
  async seek(time: number): Promise<void> {
    const clampedTime = Math.max(0, Math.min(time, this.duration));

    // Seek both video and audio
    this.videoWorker.seek(clampedTime);
    await this.audioPlayer.seek(clampedTime);

    this.emit('seek', clampedTime);
  }

  /**
   * Get the current playback time
   *
   * Queries the audio player's timeline, which is the source of truth.
   *
   * @returns Current time in seconds
   */
  getCurrentTime(): number {
    return this.audioPlayer.getCurrentTime();
  }

  /**
   * Check if currently playing
   */
  playing(): boolean {
    return this.isPlaying;
  }

  /**
   * Main tick loop
   *
   * This runs at TARGET_FPS and:
   * 1. Queries the current time from audio timeline
   * 2. Emits tick event for UI updates
   * 3. Tells video worker to render at this time
   * 4. Checks for end of video
   *
   * The video worker is passive - it just renders whatever time we tell it.
   * The audio timeline is the source of truth for the current time.
   */
  private tick(): void {
    if (!this.isPlaying) return;

    const now = performance.now();
    const elapsed = now - this.lastFrameTime;

    // Frame rate throttling: only update at TARGET_FPS
    // This prevents unnecessary rendering and saves CPU/battery
    if (elapsed < this.FRAME_INTERVAL) {
      this.animationFrame = requestAnimationFrame(() => this.tick());
      return;
    }

    this.lastFrameTime = now;

    // Get current time from audio timeline (source of truth)
    const currentTime = this.audioPlayer.getCurrentTime();

    // Check if we've reached the end
    if (currentTime >= this.duration - 0.1) {
      this.pause();
      this.emit('ended');
      return;
    }

    // Emit tick event for UI updates
    // UI should listen to this rather than polling getCurrentTime()
    this.emit('tick', currentTime);

    // Tell video worker to render at this time (passive)
    // Video worker doesn't track time itself - it just renders whatever we tell it
    this.videoWorker.render(currentTime);

    // Schedule next tick
    this.animationFrame = requestAnimationFrame(() => this.tick());
  }

  /**
   * Update duration (if needed after initialization)
   */
  setDuration(duration: number): void {
    this.duration = duration;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.isPlaying = false;
  }
}
