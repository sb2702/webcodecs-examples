import {ArrayBufferTarget, Muxer} from "mp4-muxer";
import { WorkerController } from "../../../utils/WorkerController";
import type { Clock } from "../../clock";

export interface AudioTrackData {
    codec: string,
    sampleRate: number ,
    numberOfChannels: number
}

// Duration of each audio segment (time-based blocks that contain multiple EncodedAudioChunks)
const SEGMENT_DURATION = 30; // seconds


export interface AudioPlayerArgs {

    audioConfig: AudioTrackData;
    duration: number;
    worker: WorkerController;
    file: File;
    clock: Clock;
}


export class WebAudioPlayer {


    audioContext: AudioContext | null;
    sourceNode: AudioBufferSourceNode | null;
    isPlaying: boolean;
    startTime: number;
    pauseTime: number;
    duration: number;
    encodedChunks: EncodedAudioChunk[]; // EncodedAudioChunks from current segment
    audioSegments: Map<number, AudioBuffer>; // Decoded audio segments (segmentIndex -> AudioBuffer)
    scheduledNodes: Map<number, AudioBufferSourceNode>;
    preloadThreshold: number; // Seconds before segment end to trigger preload
    file: File;

    worker: WorkerController;
    isPreloading: boolean;
    audioConfig: AudioTrackData | null;
    clock: Clock;

    constructor(args: AudioPlayerArgs) {
        this.audioContext = null;
        this.sourceNode = null;
        this.isPlaying = false;
        this.startTime = 0;
        this.pauseTime = 0;
        this.duration = args.duration;
        this.audioConfig = args.audioConfig;

        this.encodedChunks = [];
        this.audioSegments = new Map(); // Cache for decoded audio segments
        this.scheduledNodes = new Map(); // Track scheduled audio nodes
        this.preloadThreshold = 5; // Seconds before segment end to trigger preload
        this.isPreloading = false;

        //Audio Renderer gets its own worker to avoid using the video worker to get audio chunks while the video renderer is running / fetching video chunks
        this.worker = args.worker;
        this.file = args.file;
        this.clock = args.clock;

        // Subscribe to Clock's tick events for segment preloading
        this.clock.on('tick', this.onClockTick.bind(this));

        this.init();
    }

    init() {
        this.audioContext = new AudioContext();

        this.seek(0);

    }

    /**
     * Mux EncodedAudioChunks to an ArrayBuffer for Web Audio API decoding
     * @param chunks - Array of EncodedAudioChunks from a segment
     */
    async muxEncodedChunksToBuffer(chunks: EncodedAudioChunk[], config: AudioTrackData) {
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

        // Add EncodedAudioChunks to muxer
        for (const chunk of chunks) {
            muxer.addAudioChunk(chunk);
        }

        // Finalize and get array buffer
        await muxer.finalize();
        return muxer.target.buffer;
    }

    /**
     * Fetch EncodedAudioChunks for a specific time segment from the file worker
     * @param time - Time in seconds
     * @returns Array of EncodedAudioChunks
     */
    async getEncodedChunksForTime(time: number) {
        const segmentIndex = Math.floor(time / SEGMENT_DURATION);

        const chunks = <EncodedAudioChunk[]> await this.worker.sendMessage('get-audio-segment', {
            start: segmentIndex * SEGMENT_DURATION,
            end: segmentIndex * SEGMENT_DURATION + SEGMENT_DURATION,
            file: this.file
        });

        this.encodedChunks = chunks;

        return chunks;
    }

    /**
     * Load and decode an audio segment
     * @param time - Time in seconds
     * @returns Decoded AudioBuffer for the segment
     */
    async loadSegment(time: number) {
        const segmentIndex = Math.floor(time / SEGMENT_DURATION);

        // Check cache first
        if (this.audioSegments.has(segmentIndex)) {
            return this.audioSegments.get(segmentIndex);
        }

        // Fetch EncodedAudioChunks for this segment
        const encodedChunks = await this.getEncodedChunksForTime(segmentIndex * SEGMENT_DURATION);
        if (encodedChunks.length === 0) return null;

        try {
            const a = performance.now();

            // Mux EncodedAudioChunks to AAC buffer
            const muxedBuffer = await this.muxEncodedChunksToBuffer(encodedChunks, this.audioConfig!);

            const b = performance.now();

            // Decode to AudioBuffer for Web Audio API
            const audioBuffer = await this.audioContext!.decodeAudioData(muxedBuffer);

            const c = performance.now();
            console.log(`Segment ${segmentIndex}: Muxing took ${b - a}ms, Decoding took ${c - b}ms`);

            // Cache the decoded segment
            this.audioSegments.set(segmentIndex, audioBuffer);

            return audioBuffer;
        } catch (error) {
            console.error('Error loading audio segment:', error);
            return null;
        }
    }



    async startPlayback(startFrom = this.pauseTime) {
        // Clear any previously scheduled nodes
        this.clearScheduledNodes();

        const currentSegment = await this.loadSegment(startFrom);

        if (!currentSegment) return;

        const segmentOffset = startFrom % SEGMENT_DURATION;
        const timeUntilEnd = SEGMENT_DURATION - segmentOffset;

        // Schedule current segment
        this.scheduleSegment(currentSegment, startFrom, segmentOffset);

        // Pre-load and schedule next segment
        this.preloadNextSegment(startFrom + timeUntilEnd);
    }

    clearScheduledNodes() {
        // Clear both audio nodes and preload timeouts
        for (const node of this.scheduledNodes.values()) {
            node.stop();
            node.disconnect();
        }
        this.scheduledNodes.clear();
    }

    getCurrentSegmentIndex() {
        return Math.floor(this.getCurrentTime() / SEGMENT_DURATION);
    }

    async preloadNextSegment(startTime: number) {
        if (this.isPreloading || startTime >= this.duration) return;

        const nextSegmentIndex = Math.floor(startTime / SEGMENT_DURATION);

        // Check if we already have this segment cached
        if (this.audioSegments.has(nextSegmentIndex)) return;

        this.isPreloading = true;
        try {
            const nextSegment = await this.loadSegment(startTime);
            if (!nextSegment || !this.isPlaying) return;

            this.scheduleSegment(nextSegment, startTime, 0);

            // Instead of setTimeout, we'll check during playback updates
        } finally {
            this.isPreloading = false;
        }
    }

    scheduleSegment(audioBuffer: AudioBuffer, startTime: number, offset: number) {
        const sourceNode = this.audioContext!.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(this.audioContext!.destination);


        const playbackTime = this.startTime + (startTime - this.pauseTime);

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
    }

    async pause() {
        this.clearScheduledNodes();
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

        if (wasPlaying) {
            this.startTime = this.audioContext!.currentTime;
            this.isPlaying = true;
            await this.startPlayback(time);
        }
    }

    /**
     * Tick handler - called by Clock on each tick
     * Checks if we need to preload the next segment
     * @param currentTime - Current playback time from audio timeline
     */
    private onClockTick(currentTime: number) {
        const currentSegmentIndex = this.getCurrentSegmentIndex();
        const timeInCurrentSegment = currentTime % SEGMENT_DURATION;

        if (timeInCurrentSegment >= (SEGMENT_DURATION - this.preloadThreshold) &&
            !this.isPreloading &&
            !this.audioSegments.has(currentSegmentIndex + 1)) {
            this.preloadNextSegment((currentSegmentIndex + 1) * SEGMENT_DURATION);
        }
    }

    getCurrentTime() {
        if (!this.isPlaying) return this.pauseTime;
        return this.pauseTime + (this.audioContext!.currentTime - this.startTime);
    }
}

