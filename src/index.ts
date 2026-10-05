// Main entry point for webcodecs-examples package
export { WebCodecsPlayer } from './player/index';

export { transcodeFile } from './transcoding/transcoder';
export type { TranscodeMethod } from './transcoding/transcoder';
export { transcodePromise } from './transcoding/transcode-promise';
export { transcodePipeline } from './transcoding/transcode-pipeline';

export { WebcamRecorder, getWebcam } from './webcam-recording/index';

export { MoqPublisher, VIDEO_TRACK, AUDIO_TRACK } from './moq/moq-publisher';
export * as Hang from './moq/hang';
export { createVideoWriter, createAudioWriter } from './moq/hang-writers';
export { MoqSubscriber } from './moq/moq-subscriber';
export { AudioPlayer } from './moq/audio-player';
export type { MoqFrame } from './moq/moq-subscriber';

import {getSampleRate, getBitrate, getCodecString } from 'webcodecs-utils'

export {getSampleRate, getBitrate, getCodecString }

