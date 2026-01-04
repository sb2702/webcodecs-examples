import {MP4Demuxer} from 'webcodecs-utils';


// Types and functions imported from file.ts
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



interface MP4Data {
  mp4: any;
  trackData: TrackData;
  info: any;
}




// Active ChunkedVideoManager
let videoManager: VideoTransformer | null = null;

// The canvas we'll render to
let offscreenCanvas: OffscreenCanvas | null = null;


import VideoRenderer, { VideoTrackData } from "./decoder";

// Same chunk duration as used in audio
const CHUNK_DURATION = 10; // Duration of each chunk in seconds

/**
 * ChunkedVideoManager manages multiple VideoRenderer instances, one per chunk
 * Each VideoRenderer is responsible for rendering frames from its own chunk
 */
export default class VideoTransformer {
    private videoMetadata: | undefined;
    private file: File;
    private duration: number | undefined;
    private canvas: OffscreenCanvas;
    
    // Map of chunk index to VideoRenderer
    private renderers: Map<number, VideoRenderer>;
    public demuxer: MP4Demuxer;
    // Cached chunks data
    private loadedChunks: Map<number, EncodedVideoChunk[]>;
    
    // Current state
    private currentChunkIndex: number;
    private activeRenderer: VideoRenderer | null;
    private isPreloading: boolean;
    private preloadThreshold: number;
    private rendering: boolean;
    private lastRenderedTime: number;

    constructor(
        canvas: OffscreenCanvas,
        file: File
    ) {

        this.canvas = canvas;
        this.file = file;
        this.renderers = new Map();
        this.demuxer = new MP4Demuxer(file);

        this.loadedChunks = new Map();
        this.currentChunkIndex = -1;
        this.activeRenderer = null;
        this.isPreloading = false;
        this.preloadThreshold = 5; // Seconds before chunk end to trigger preload
        this.rendering = false;
        this.lastRenderedTime = 0;
        

    }

    async initialize(){
        // Initialize with the first chunk

        await this.demuxer.load();
        this.videoMetadata = this.demuxer.getVideoTrack();
      
        await this.initializeChunk(0);
        await this.seek(0);
    }

    /**
     * Get the chunk index for a specific time
     */
    private getChunkIndexForTime(time: number): number {
        return Math.floor(time / CHUNK_DURATION);
    }

    /**
     * Load a specific chunk from the worker
     */
    private async loadChunk(chunkIndex: number): Promise<EncodedVideoChunk[]> {
        // If already loaded, return from cache
        if (this.loadedChunks.has(chunkIndex)) {
            return this.loadedChunks.get(chunkIndex) || [];
        }

        const startTime = chunkIndex * CHUNK_DURATION;
        const endTime = Math.min((chunkIndex + 1) * CHUNK_DURATION, this.duration);

        try {

            
            const chunks = <EncodedVideoChunk[]> await this.demuxer.extractSegment('video', startTime, endTime);


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
            this.canvas
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
        // Get the transferred canvas
        offscreenCanvas = data.canvas;
        const file = data.file;
        
    

        // Create the video manager with the offscreen canvas
        transformer = new VideoTransformer(
          offscreenCanvas as OffscreenCanvas, // Cast to HTMLCanvasElement
          file
        );


        console.log("Initializing video manager", videoManager);
        await transformer.initialize();
        console.log("Video manager initialized", videoManager);


        console.log("Sending initialization message", videoManager);

        console.log("Sending initialization message", request_id);
        // Send successful initialization
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

      case "get-track-data":


        if(! transformer){
          return postMessage({ request_id: event.data.request_id, error: "Not initialized"});
        }
        try{
        
              console.log("Getting track data")

              console.log("Transformer", transformer);

         
              const trackData = transformer.demuxer.getTracks()

              console.log("Track data");
              console.log(trackData)

            

              console.log("Video track data", trackData.video);

              console.log("Offscreen canvas", offscreenCanvas);

              if(offscreenCanvas && trackData.video) {
                offscreenCanvas.height = trackData.video.codedHeight;
                offscreenCanvas.width = trackData.video.codedWidth;
              }

        
            postMessage({ request_id: event.data.request_id, res: trackData });
        } catch (e) {
            postMessage({ request_id: event.data.request_id, error: e});
        }
        break

    case "get-track-segment":
        try{
        
            console.log("Getting track segment", event.data.data.type, event.data.data.start, event.data.data.end);
            const chunks = await transformer.demuxer.extractSegment( event.data.data.type, event.data.data.start, event.data.data.end);
            console.log("Chunks", chunks);
            postMessage({ request_id: event.data.request_id, res: chunks});
        } catch (e) {
            console.log("Error", e)
            postMessage({ request_id: event.data.request_id, error: e});
        }
        break

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

