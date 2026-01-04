import EventEmitter from "../../../utils/EventEmitter";
import { v4 as uuidv4 } from 'uuid';
import workerUrl from './video.worker.ts?worker&url';
import { WorkerController } from "../../../utils/WorkerController";
import { TrackData } from "../../player";

export interface VideoWorkerParams {
  src: File;
  canvas: HTMLCanvasElement;
  fileWorkerPort: MessagePort;
}



/**
 * OffscreenVideoWorker is a wrapper around the video.worker.ts
 * It handles communication with the worker and provides a simple interface.
 */
export class VideoWorker extends EventEmitter {
  private canvas: HTMLCanvasElement;
  private offscreenCanvas: OffscreenCanvas | null = null;
  private file: File;
  public duration: number = 0;
  private worker: WorkerController;
  private callbacks: Record<string, (result: any) => void> = {};
  private animationFrame: number | null = null;
  private lastRenderTime: number = 0;
  private isPlaying: boolean = false;
  private playStartTime: number = 0;
  private pauseTime: number = 0;

  private fileWorkerPort: MessagePort;

  constructor(params: VideoWorkerParams) {
    super();
    this.canvas = params.canvas;
    this.file = params.src;
    this.fileWorkerPort = params.fileWorkerPort;

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
    console.log("Initializing worker", this.offscreenCanvas);
    const initialized = await this.worker.sendMessage('init', {
      canvas: this.offscreenCanvas,
      fileWorkerPort: this.fileWorkerPort
    }, [this.offscreenCanvas, this.fileWorkerPort]);

    console.log("Initialized", initialized);

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
    this.emit('terminated');
  }

  /**

  /**
   * Update the current frame (animation loop)
   */


  render(time: number): void {

    // Send render command to worker
    this.worker.sendMessage('render', { time: time });
  }
}