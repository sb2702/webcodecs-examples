import VideoRenderer, { VideoTrackData } from "./decoder";
import { GPUFrameRenderer } from 'webcodecs-utils';


// Types
interface TrackData {
  duration: number;
  audio?: AudioTrackData;
  video?: VideoTrackData;
}

interface AudioTrackData {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
}

// Connection to file worker
let fileWorkerPort: MessagePort | null = null;

// Active video transformer
let videoManager: VideoTransformer | null = null;

// The canvas we'll render to
let offscreenCanvas: OffscreenCanvas | null = null;

// Same chunk duration as used in audio
const CHUNK_DURATION = 300; // Duration of each chunk in seconds

/**
 * ChunkedVideoManager manages multiple VideoRenderer instances, one per chunk
 * Each VideoRenderer is responsible for rendering frames from its own chunk
 */
export default class VideoTransformer {
    private videoMetadata: VideoTrackData | undefined;
    private duration: number | undefined;
    private canvas: OffscreenCanvas;
    private filePort: MessagePort;

    // Map of chunk index to VideoRenderer
    private renderers: Map<number, VideoRenderer>;
    // Cached chunks data
    private loadedChunks: Map<number, EncodedVideoChunk[]>;

    // Current state
    private currentChunkIndex: number;
    private activeRenderer: VideoRenderer | null;
    private isPreloading: boolean;
    private preloadThreshold: number;
    private rendering: boolean;
    private frameRenderer: GPUFrameRenderer;
    private lastRenderedTime: number;

    // Request ID tracking
    private requestId: number = 0;
    private pendingRequests: Map<number, { resolve: (value: any) => void, reject: (error: any) => void }> = new Map();

    constructor(
        canvas: OffscreenCanvas,
        filePort: MessagePort,
        videoMetadata: VideoTrackData,
        duration: number
    ) {
        this.canvas = canvas;
        this.filePort = filePort;
        this.videoMetadata = videoMetadata;
        this.frameRenderer = new GPUFrameRenderer(this.canvas, { filterMode: 'linear' });
        this.duration = duration;
        this.renderers = new Map();
        this.loadedChunks = new Map();
        this.currentChunkIndex = -1;
        this.activeRenderer = null;
        this.isPreloading = false;
        this.preloadThreshold = 5; // Seconds before chunk end to trigger preload
        this.rendering = false;
        this.lastRenderedTime = 0;

        // Set up message handler for file worker responses
        this.filePort.onmessage = this.handleFileWorkerMessage.bind(this);
    }

    private handleFileWorkerMessage(event: MessageEvent) {
        const { cmd, request_id, res, error } = event.data;

        if (cmd === 'chunks' && request_id) {
            const pending = this.pendingRequests.get(request_id);
            if (pending) {
                if (error) {
                    pending.reject(new Error(error));
                } else {
                    pending.resolve(res);
                }
                this.pendingRequests.delete(request_id);
            }
        }
    }

    private requestSegment(start: number, end: number): Promise<EncodedVideoChunk[]> {
        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            this.pendingRequests.set(id, { resolve, reject });

            this.filePort.postMessage({
                cmd: 'request-segment',
                request_id: id,
                data: { start, end }
            });
        });
    }

    async initialize(){
        // Initialize with the first chunk
        await this.initializeChunk(0);
        await this.seek(0);
        await this.frameRenderer.init();
    }

    /**
     * Get the chunk index for a specific time
     */
    private getChunkIndexForTime(time: number): number {
        return Math.floor(time / CHUNK_DURATION);
    }

    /**
     * Load a specific chunk from the file worker
     */
    private async loadChunk(chunkIndex: number): Promise<EncodedVideoChunk[]> {
        // If already loaded, return from cache
        if (this.loadedChunks.has(chunkIndex)) {
            return this.loadedChunks.get(chunkIndex) || [];
        }

        const startTime = chunkIndex * CHUNK_DURATION;
        const endTime = Math.min((chunkIndex + 1) * CHUNK_DURATION, this.duration);

        try {
            // Request chunks from file worker via MessagePort
            const chunks = await this.requestSegment(startTime, endTime);

            // Cache the chunks
            this.loadedChunks.set(chunkIndex, chunks);

            return chunks;
        } catch (error) {
            console.error('Error loading video chunk:', error);
            return [];
        }
    }

    /**
     * Initialize a renderer for a specific chunk
     */
    private async initializeChunk(chunkIndex: number): Promise<VideoRenderer | null> {
        // If we already have a renderer for this chunk, return it
        if (this.renderers.has(chunkIndex)) {
            return this.renderers.get(chunkIndex) || null;
        }
        
        // Load chunks for this time segment
        const chunks = await this.loadChunk(chunkIndex);
        if (chunks.length === 0) {
            console.error(`No chunks loaded for index ${chunkIndex}`);
            return null;
        }
        
        // Create a new renderer with these chunks
        const renderer = new VideoRenderer(
            this.videoMetadata,
            chunks,
            this.canvas,
            this.frameRenderer
        );
        
        // Store it in our map
        this.renderers.set(chunkIndex, renderer);
        
        // Start preloading the next chunk
        this.preloadNextChunk(chunkIndex + 1);
        
        return renderer;
    }

    /**
     * Preload the next chunk in background
     */
    private async preloadNextChunk(chunkIndex: number) {
        if (this.isPreloading || 
            chunkIndex * CHUNK_DURATION >= this.duration || 
            this.loadedChunks.has(chunkIndex)) {
            return;
        }
        
        this.isPreloading = true;
        try {
            await this.loadChunk(chunkIndex);
        } finally {
            this.isPreloading = false;
        }
    }

    /**
     * Check if we need to preload the next chunk based on current time
     */
    private checkPreloadNextChunk(currentTime: number) {
        const currentChunkIndex = this.getChunkIndexForTime(currentTime);
        const timeInCurrentChunk = currentTime % CHUNK_DURATION;
        
        if (timeInCurrentChunk >= (CHUNK_DURATION - this.preloadThreshold) && 
            !this.isPreloading && 
            !this.loadedChunks.has(currentChunkIndex + 1)) {
            this.preloadNextChunk(currentChunkIndex + 1);
        }
        
        // Also, if we're close to the end of the chunk, initialize the next renderer
        if (timeInCurrentChunk >= (CHUNK_DURATION - this.preloadThreshold) && 
            !this.renderers.has(currentChunkIndex + 1) &&
            this.loadedChunks.has(currentChunkIndex + 1)) {
            this.initializeChunk(currentChunkIndex + 1);
        }
    }

    /**
     * Get debug information about the current state
     */
    getDebugInfo() {

        return {
            currentChunkIndex: this.currentChunkIndex,
            activeRenderer: this.activeRenderer ? {
                renderBufferSize: this.activeRenderer.rendered_buffer.length,
                decodeQueueSize: this.activeRenderer.decoder.decodeQueueSize,
                currentChunk: this.activeRenderer.currentChunk,
                lastRenderedTime: this.activeRenderer.lastRenderedTime

            } : null,
            totalRenderers: this.renderers.size,
            loadedChunks: this.loadedChunks.size,
            isPreloading: this.isPreloading
        };
    }

    /**
     * Play the video (compatibility with VideoRenderer API)
     */
    play() {
        // No-op, just for compatibility
    }
    
    /**
     * Render the video at the specified time
     */
    render(time: number) {

        if (this.rendering) {
            return;
        }


;
        
        this.rendering = true;
        this.lastRenderedTime = time;
        
        try {
            // Get the chunk index for this time
            const chunkIndex = this.getChunkIndexForTime(time);
            
            // If we need to switch to a different chunk
            if (chunkIndex !== this.currentChunkIndex || !this.activeRenderer) {
                // Schedule the chunk switch asynchronously but don't await it
                this.switchToChunk(chunkIndex, time).then(() => {
                    this.rendering = false;
                });
                return;
            }
            
            // Render using the active renderer
            if (this.activeRenderer) {
                this.activeRenderer.render(time);
            }
            
            // Check if we need to preload
            this.checkPreloadNextChunk(time);
            
        } finally {
            this.rendering = false;
        }
    }
    
    /**
     * Switch to a different chunk renderer
     */
    private async switchToChunk(chunkIndex: number, time: number) {
        console.log(`Switching to chunk ${chunkIndex} at time ${time}`);
        
        // Initialize the chunk renderer if needed
        if (!this.renderers.has(chunkIndex)) {
            this.activeRenderer = await this.initializeChunk(chunkIndex);
        } else {
            this.activeRenderer = this.renderers.get(chunkIndex) || null;
        }
        
        if (!this.activeRenderer) {
            console.error(`Failed to initialize renderer for chunk ${chunkIndex}`);
            return;
        }
        
        // Update current chunk index
        this.currentChunkIndex = chunkIndex;
        
        // Calculate the local time within this chunk
        const relativeTime = time - (chunkIndex * CHUNK_DURATION);
        
        // Seek within the chunk
        await this.activeRenderer.seek(time);
        
        // Render the frame
        this.activeRenderer.render(time);
        
        // Start preloading next chunk
        this.preloadNextChunk(chunkIndex + 1);
    }
    
    /**
     * Seek to a specific time position
     */
    async seek(time: number) {
        const chunkIndex = this.getChunkIndexForTime(time);
        
        // If we're already in this chunk, use the active renderer
        if (chunkIndex === this.currentChunkIndex && this.activeRenderer) {
            await this.activeRenderer.seek(time);
            return;
        }
        
        // Otherwise, switch to the correct chunk
        await this.switchToChunk(chunkIndex, time);
    }
    
    /**
     * Clean up resources
     */
    terminate() {
        // Clean up all renderers
        for (const renderer of this.renderers.values()) {
            // VideoRenderer doesn't have a terminate method,
            // but we could add one if needed
        }
        
        this.renderers.clear();
        this.loadedChunks.clear();
        this.activeRenderer = null;
    }
}

let transformer: VideoTransformer | null = null;



// Main message handler
self.onmessage = async function(event: MessageEvent) {
  const { cmd, data, request_id } = event.data;

  switch (cmd) {
    case "init":
      try {
        // Get the transferred canvas and file worker port
        offscreenCanvas = data.canvas;
        fileWorkerPort = data.fileWorkerPort;

        if (!offscreenCanvas || !fileWorkerPort) {
          throw new Error('Missing canvas or file worker port');
        }

        console.log("Video worker initialized with MessagePort to file worker");

        // Send successful initialization (video transformer will be created after track data is received)
        self.postMessage({
          request_id,
          res: true
        });
      } catch (error) {
        self.postMessage({
          request_id,
          error: `Initialization error: ${error}`
        });
      }
      break;

    case "set-track-data":
      try {
        // Receive video metadata and duration from main thread
        const { videoMetadata, duration } = data;

        if (!offscreenCanvas || !fileWorkerPort) {
          throw new Error('Worker not initialized');
        }

        // Set canvas dimensions
        if (videoMetadata.codedWidth && videoMetadata.codedHeight) {
          offscreenCanvas.width = videoMetadata.codedWidth;
          offscreenCanvas.height = videoMetadata.codedHeight;
        }

        // Create the video transformer with the file worker port
        transformer = new VideoTransformer(
          offscreenCanvas,
          fileWorkerPort,
          videoMetadata,
          duration
        );

        await transformer.initialize();
        console.log("Video transformer initialized");

        self.postMessage({
          request_id,
          res: true
        });
      } catch (error) {
        self.postMessage({
          request_id,
          error: `Set track data error: ${error}`
        });
      }
      break;

    case "render":
      if (!transformer) {
        self.postMessage({
          request_id,
          error: "VideoManager not initialized"
        });
        return;
      }

      try {
        const time = data.time;
        transformer.render(time);
        self.postMessage({
          request_id,
          res: "render-complete"
        });
      } catch (error) {
        self.postMessage({
          request_id,
          error: `Render error: ${error}`
        });
      }
      break;

    case "get-debug-info":
      if (!transformer) {
        self.postMessage({
          request_id,
          error: "VideoManager not initialized"
        });
        return;
      }

      try {
        const debugInfo = transformer.getDebugInfo();
        self.postMessage({
          request_id,
          res: debugInfo
        });
      } catch (error) {
        self.postMessage({
          request_id,
          error: `Debug info error: ${error}`
        });
      }
      break;

    case "seek":
      if (!transformer) {
        self.postMessage({
          request_id,
          error: "VideoManager not initialized"
        });
        return;
      }

      try {
        const time = data.time;
        await transformer.seek(time);
        self.postMessage({
          request_id,
          res: "seek-complete"
        });
      } catch (error) {
        self.postMessage({
          request_id,
          error: `Seek error: ${error}`
        });
      }
      break;


    case "terminate":
      if (transformer) {
        transformer.terminate();
        transformer = null;
      }
      self.postMessage({
        request_id,
        res: "terminated"
      });
      break;
  }
};

