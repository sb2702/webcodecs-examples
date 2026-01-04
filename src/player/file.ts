import { MP4Demuxer } from 'webcodecs-utils';

/**
 * File Worker - Pure MP4 Demuxer
 *
 * Responsibilities:
 * - Load and parse MP4 files
 * - Extract track metadata
 * - Extract video/audio chunks for specific time ranges
 * - Send chunks to video worker via MessagePort
 * - Send chunks to audio player via direct worker messages
 */

let demuxer: MP4Demuxer | null = null;
let videoWorkerPort: MessagePort | null = null;

// Worker message handler
self.onmessage = async function(event: MessageEvent) {
  const { cmd, data, request_id } = event.data;

  try {
    switch (cmd) {
      case 'init':
        // Initialize demuxer with file
        const { file, videoPort } = data;
        demuxer = new MP4Demuxer(file);
        await demuxer.load();

        // Store the MessagePort for video worker communication
        if (videoPort) {
          videoWorkerPort = videoPort;
          videoWorkerPort.onmessage = handleVideoWorkerMessage;
        }

        self.postMessage({
          request_id,
          res: true
        });
        break;

      case 'get-tracks':
        if (!demuxer) {
          throw new Error('Demuxer not initialized');
        }


        const tracks = demuxer.getTracks();

        self.postMessage({
          request_id,
          res: tracks
        });
        break;

      case 'get-audio-segment':
        if (!demuxer) {
          throw new Error('Demuxer not initialized');
        }

        const { start, end } = data;
        const audioChunks = await demuxer.extractSegment('audio', start, end);

        // Send directly back to audio player (main thread)
        self.postMessage({
          request_id,
          res: audioChunks
        });
        break;

      case 'get-video-segment':
        // This is called from main thread, but we forward to video worker
        if (!demuxer || !videoWorkerPort) {
          throw new Error('Demuxer or video port not initialized');
        }

        const videoSegment = await demuxer.extractSegment(
          'video',
          data.start,
          data.end
        );

        // Send chunks to video worker via MessagePort
        videoWorkerPort.postMessage({
          cmd: 'chunks',
          request_id,
          res: videoSegment
        });
        break;

      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  } catch (error) {
    self.postMessage({
      request_id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

// Handle messages from video worker (via MessagePort)
function handleVideoWorkerMessage(event: MessageEvent) {
  const { cmd, data, request_id } = event.data;

  if (!demuxer || !videoWorkerPort) return;

  switch (cmd) {
    case 'request-segment':
      // Video worker requests a segment
      demuxer.extractSegment('video', data.start, data.end)
        .then(chunks => {
          videoWorkerPort!.postMessage({
            cmd: 'chunks',
            request_id,
            data: chunks
          });
        })
        .catch(error => {
          videoWorkerPort!.postMessage({
            cmd: 'error',
            request_id,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      break;
  }
}
