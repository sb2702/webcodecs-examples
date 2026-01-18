import { Input, ALL_FORMATS, FilePathSource } from 'mediabunny';
import fs from 'fs';

async function testReadVideo() {
  console.log('Reading video file: ./videos/bbb.mp4\n');


  // Create input
  const input = new Input({
    formats: ALL_FORMATS,
    source: new FilePathSource('./videos/bbb.mp4')
  });

  // Get file info
  const format = await input.getFormat();
  const duration = await input.computeDuration();
  console.log('Format:', format);
  console.log('Duration:', duration, 'seconds\n');

  // Get tracks
  const videoTracks = await input.getVideoTracks();
  const audioTracks = await input.getAudioTracks();

  console.log('Found', videoTracks.length, 'video tracks');
  console.log('Found', audioTracks.length, 'audio tracks\n');

  // Get video track decoder config
  if (videoTracks.length > 0) {
    const videoTrack = videoTracks[0];
    console.log('--- Video Track ---');
    console.log('ID:', videoTrack.id);
    console.log('Codec:', videoTrack.codec);
    console.log('Dimensions:', videoTrack.codedWidth, 'x', videoTrack.codedHeight);
    console.log('Can decode:', await videoTrack.canDecode());

    const videoDecoderConfig = await videoTrack.getDecoderConfig();
    console.log('\nVideo Decoder Config:');
    console.log(JSON.stringify(videoDecoderConfig, null, 2));
    console.log('Description length:', videoDecoderConfig.description?.byteLength || 0, 'bytes\n');
  }

  // Get audio track decoder config
  if (audioTracks.length > 0) {
    const audioTrack = audioTracks[0];
    console.log('--- Audio Track ---');
    console.log('ID:', audioTrack.id);
    console.log('Codec:', audioTrack.codec);
    console.log('Sample Rate:', audioTrack.sampleRate);
    console.log('Channels:', audioTrack.numberOfChannels);
    console.log('Can decode:', await audioTrack.canDecode());

    const audioDecoderConfig = await audioTrack.getDecoderConfig();
    console.log('\nAudio Decoder Config:');
    console.log(JSON.stringify(audioDecoderConfig, null, 2));
    console.log('Description length:', audioDecoderConfig.description?.byteLength || 0, 'bytes\n');
  }
}

testReadVideo().catch(console.error);
