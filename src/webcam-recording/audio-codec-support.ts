export async function isAACSupported(sampleRate?: number, numberOfChannels?: number): Promise<boolean> {
  const config: AudioEncoderConfig = {
    codec: 'mp4a.40.2',
    sampleRate: sampleRate || 48000,
    numberOfChannels: numberOfChannels || 2,
    bitrate: 128000,
  };

  const details = await AudioEncoder.isConfigSupported(config);
  return details.supported ?? false;
}
