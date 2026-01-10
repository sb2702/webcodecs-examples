export class AudioPlayer {
  private audioContext: AudioContext;
  private gainNode: GainNode;
  private sampleRate: number;
  private numberOfChannels: number;
  private nextPlayTime: number = 0;

  constructor(sampleRate: number, numberOfChannels: number) {
    this.sampleRate = sampleRate;
    this.numberOfChannels = numberOfChannels;
    this.audioContext = new AudioContext({ sampleRate });
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
  }

  play(audioData: AudioData): void {
    // Extract PCM data from AudioData
    const numberOfFrames = audioData.numberOfFrames;
    const buffer = this.audioContext.createBuffer(
      this.numberOfChannels,
      numberOfFrames,
      this.sampleRate
    );

    // Copy data for each channel
    for (let channel = 0; channel < this.numberOfChannels; channel++) {
      const channelData = new Float32Array(numberOfFrames);
      audioData.copyTo(channelData, {
        planeIndex: channel,
        format: 'f32-planar',
      });
      buffer.copyToChannel(channelData, channel);
    }

    // Create and schedule buffer source
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const currentTime = this.audioContext.currentTime;
    const playTime = Math.max(currentTime, this.nextPlayTime);

    source.start(playTime);
    this.nextPlayTime = playTime + buffer.duration;
  }

  setVolume(volume: number): void {
    this.gainNode.gain.value = volume;
  }

  close(): void {
    this.audioContext.close();
  }
}
