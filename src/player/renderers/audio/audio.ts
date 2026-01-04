import {ArrayBufferTarget, Muxer} from "mp4-muxer";
import EventEmitter from "../../../utils/EventEmitter";
import { WorkerController } from "../../../utils/WorkerController";
import { VideoWorker } from "../video/video";
export interface AudioTrackData {
    codec: string,
    sampleRate: number ,
    numberOfChannels: number
}

const CHUNK_DURATION = 30; // Duration of each chunk in seconds


export interface AudioPlayerArgs {

    audioConfig: AudioTrackData;
    duration: number;
    worker: WorkerController;
    file: File;
}


export class WebAudioPlayer extends EventEmitter {


    audioContext: AudioContext | null;
    sourceNode: AudioBufferSourceNode | null;
    isPlaying: boolean;
    startTime: number;
    pauseTime: number;
    duration: number;
    animationFrame: number | null;
    encodedChunks: EncodedAudioChunk[];
    audioBuffers: Map<number, AudioBuffer>;
    scheduledNodes: Map<number, AudioBufferSourceNode>;
    preloadThreshold: number;
    file: File;

    worker: WorkerController;
    isPreloading: boolean;
    audioConfig: AudioTrackData | null;
    constructor(args: AudioPlayerArgs) {
        super();
        this.audioContext = null;
        this.sourceNode = null;
        this.isPlaying = false;
        this.startTime = 0;
        this.pauseTime = 0;
        this.duration = args.duration;
        this.animationFrame = null;
        this.audioConfig = args.audioConfig;

        this.encodedChunks = [];
        this.audioBuffers = new Map(); // Cache for decoded audio buffers
        this.scheduledNodes = new Map(); // Track scheduled audio nodes
        this.preloadThreshold = 5; // Seconds before chunk end to trigger preload
        this.isPreloading = false;

        //Audio Renderer gets its own worker to avoid using the video worker to get audio chunks while the video renderer is running / fetching video chunks
        this.worker = args.worker;
        this.file = args.file;


        this.init();
    }

    init() {
        this.audioContext = new AudioContext();

        this.seek(0);
        
    }

    async muxChunksToBuffer(chunks: EncodedAudioChunk[], config: AudioTrackData) {
        // Create MP4 muxer
        const muxer = new Muxer({
            target: new ArrayBufferTarget(),
            fastStart: 'in-memory',
            firstTimestampBehavior: 'offset',
            audio: {
                codec: 'aac',
                sampleRate: config.sampleRate,
                numberOfChannels: config.numberOfChannels
            }
        });



        // Add chunks to muxer
        for (const chunk of chunks) {
            muxer.addAudioChunk(chunk);
        }

        // Finalize and get array buffer
        muxer.finalize();
        return muxer.target.buffer;
    }

    async getChunkForTime(time: number) {
        const chunkIndex = Math.floor(time / CHUNK_DURATION);




        const chunks = <EncodedAudioChunk[]> await this.worker.sendMessage('get-track-segment', {
            type: 'audio',
            start: chunkIndex*CHUNK_DURATION,
            end: chunkIndex*CHUNK_DURATION + CHUNK_DURATION,
            file: this.file
        });



        this.encodedChunks = chunks;


        
        return chunks;
    }

    async loadChunk(time: number) {
        const chunkIndex = Math.floor(time / CHUNK_DURATION);
        
        if (this.audioBuffers.has(chunkIndex)) {
            return this.audioBuffers.get(chunkIndex);
        }

        const chunks = await this.getChunkForTime(chunkIndex*CHUNK_DURATION);
        if (chunks.length === 0) return null;

        try {


            console.log("Getting chunk for time", time);
            console.log("Chunks", chunks);

        const a = performance.now();
            const muxedBuffer = await this.muxChunksToBuffer(chunks, this.audioConfig!);
            const b = performance.now();
            const audioBuffer = await this.audioContext!.decodeAudioData(muxedBuffer);
            const c = performance.now();
            console.log(`Muxing took ${b - a}ms, Decoding took ${c - b}ms`);
            // Cache the decoded buffer
            this.audioBuffers.set(chunkIndex, audioBuffer);
            
            return audioBuffer;
        } catch (error) {
            console.error('Error loading chunk:', error);
            return null;
        }
    }



    async startPlayback(startFrom = this.pauseTime) {
        // Clear any previously scheduled nodes
        this.clearScheduledNodes();
        

        const currentChunk = await this.loadChunk(startFrom);

        if (!currentChunk) return;

        const chunkOffset = startFrom % CHUNK_DURATION;
        const timeUntilEnd = CHUNK_DURATION - chunkOffset;
        
        // Schedule current chunk
        this.scheduleChunk(currentChunk, startFrom, chunkOffset);
        
        // Pre-load and schedule next chunk
        this.preloadNextChunk(startFrom + timeUntilEnd);


        
    }

    clearScheduledNodes() {
        // Clear both audio nodes and preload timeouts
        for (const node of this.scheduledNodes.values()) {
            node.stop();
            node.disconnect();
        }
        this.scheduledNodes.clear();
        
    }

    getCurrentChunkIndex() {
        return Math.floor(this.getCurrentTime() / CHUNK_DURATION);
    }

    async preloadNextChunk(startTime: number) {
        if (this.isPreloading || startTime >= this.duration) return;
        
        const nextChunkIndex = Math.floor(startTime / CHUNK_DURATION);
        
        // Check if we already have this chunk cached
        if (this.audioBuffers.has(nextChunkIndex)) return;
        
        this.isPreloading = true;
        try {
            const nextChunk = await this.loadChunk(startTime);
            if (!nextChunk || !this.isPlaying) return;

            this.scheduleChunk(nextChunk, startTime, 0);
            
            // Instead of setTimeout, we'll check during playback updates
        } finally {
            this.isPreloading = false;
        }
    }

    scheduleChunk(audioBuffer: AudioBuffer, startTime: number, offset: number) {
        const sourceNode = this.audioContext!.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(this.audioContext!.destination);

        const currentTime = this.audioContext!.currentTime;
        const playbackTime = this.startTime + (startTime - this.pauseTime);
        
        console.log("Scheduling chunk at time", playbackTime, "with offset", offset);
        sourceNode.start(playbackTime, offset);
        this.scheduledNodes.set(startTime, sourceNode);

        // Clean up completed nodes
        sourceNode.onended = () => {
            sourceNode.disconnect();
            this.scheduledNodes.delete(startTime);
        };
    }

    async play() {
        this.startTime = this.audioContext!.currentTime;
        await this.startPlayback();
        this.isPlaying = true;
        this.updatePlaybackPosition();
    }

    async pause() {
        this.clearScheduledNodes();
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        this.pauseTime = this.getCurrentTime();
   
        this.isPlaying = false;
    }

  
    async seek(time: number) {



       
        const wasPlaying = this.isPlaying;
        
        if (wasPlaying) {
            this.clearScheduledNodes();
            this.isPlaying = false;
        }

        this.pauseTime = time;
        this.updateTimeDisplay(time);

        if (wasPlaying) {
            this.startTime = this.audioContext!.currentTime;
            this.isPlaying = true;
            await this.startPlayback(time);

        }
    }

    updatePlaybackPosition() {

    
        if (!this.isPlaying) return;

        const currentTime = this.getCurrentTime();
  



        this.emit('time', currentTime);

        // Check if we need to preload the next chunk
        const currentChunkIndex = this.getCurrentChunkIndex();
        const timeInCurrentChunk = currentTime % CHUNK_DURATION;
        
        if (timeInCurrentChunk >= (CHUNK_DURATION - this.preloadThreshold) && 
            !this.isPreloading && 
            !this.audioBuffers.has(currentChunkIndex + 1)) {
            this.preloadNextChunk((currentChunkIndex + 1) * CHUNK_DURATION);
        }

        if (currentTime < this.duration) {
            this.animationFrame = requestAnimationFrame(
                this.updatePlaybackPosition.bind(this)
            );
        } else {
            this.pause();
        }
    }

    getCurrentTime() {
        if (!this.isPlaying) return this.pauseTime;
        return this.pauseTime + (this.audioContext!.currentTime - this.startTime);
    }

    updateTimeDisplay(currentTime) {

        console.log("Updating time display", currentTime);

    }
}

