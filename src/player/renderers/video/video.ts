import EventEmitter from "../../../utils/EventEmitter";
import workerUrl from './video.worker.ts?worker&url';
import { WorkerController } from "../../../utils/WorkerController";
import type { Clock } from "../../clock";

export interface VideoWorkerParams {
  canvas: HTMLCanvasElement;
  fileWorkerPort: MessagePort;
  clock: Clock;
}

/**
 * OffscreenVideoWorker is a wrapper around the video.worker.ts
 * It handles communication with the worker and provides a simple interface.
 */
export class VideoWorker extends EventEmitter {
  private canvas: HTMLCanvasElement;
  private offscreenCanvas: OffscreenCanvas | null = null;
  public duration: number = 0;
  private worker: WorkerController;

  private fileWorkerPort: MessagePort;
  private clock: Clock;

  constructor(params: VideoWorkerParams) {
    super();
    this.canvas = params.canvas;
    this.fileWorkerPort = params.fileWorkerPort;
    this.clock = params.clock;

    // Subscribe to Clock's tick events for rendering
    this.clock.on('tick', this.onClockTick.bind(this));

    // Subscribe to Clock's seek events
    this.clock.on('seek', this.onClockSeek.bind(this));

    // Create the worker
    this.worker = new WorkerController(workerUrl);
  }
  

  /**
   * Send a message to the worker and wait for a response
   */


  /**
   * Initialize the video player
   */
  async initialize(): Promise<void> {
    // Create the offscreen canvas
    this.offscreenCanvas = this.canvas.transferControlToOffscreen();

    // Initialize the worker with the offscreen canvas and file worker port
    const initialized = await this.worker.sendMessage('init', {
      canvas: this.offscreenCanvas,
      fileWorkerPort: this.fileWorkerPort
    }, [this.offscreenCanvas, this.fileWorkerPort]);

    // Emit initialization event
    this.emit('initialized', initialized);
  }



  /**
   * Seek to a specific time
   */
  async seek(time: number): Promise<void> {
    // Send seek command to worker
    await this.worker.sendMessage('seek', { time });
  }

  /**
   * Get debug information from the video worker
   */
  async getDebugInfo(): Promise<any> {
    return await this.worker.sendMessage('get-debug-info', {});
  }


  async setTrackData(videoMetadata: any, duration: number): Promise<void> {
    await this.worker.sendMessage('set-track-data', {
      videoMetadata,
      duration
    });
  }
  /**
   * Clean up resources
   */
  terminate(): void {

    // Terminate the worker
    this.worker.sendMessage('terminate').catch(console.error);
    
    // Clean up
    this.worker.terminate();
    this.offscreenCanvas = null;
    
    // Emit terminate event
    this.emit('terminated', null);
  }

  /**
   * Tick handler - called by Clock on each tick
   * @param time - Current playback time
   */
  private onClockTick(time: number): void {
    this.render(time);
  }

  /**
   * Seek handler - called by Clock when seeking
   * @param time - Time to seek to
   */
  private onClockSeek(time: number): void {
    this.seek(time);
  }

  /**
   * Render frame at specified time
   */
  render(time: number): void {
    // Send render command to worker
    this.worker.sendMessage('render', { time: time });
  }
}