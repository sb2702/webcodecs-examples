import { transcodeFile } from '../../src/transcoding';

console.log('Transcoding demo loaded');

async function processFile(file: File) {
  const statusEl = document.getElementById('status');
  const pipelineStatsEl = document.getElementById('pipeline-stats');

  if (statusEl) {
    statusEl.textContent = `Processing ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`;
  }

  // Show pipeline stats
  if (pipelineStatsEl) {
    pipelineStatsEl.style.display = 'block';
  }

  try {
    console.log('Starting transcode for:', file.name, file.size, 'bytes');

    // Transcode the file with progress reporting
    const result = await transcodeFile(file, {
      method: 'pipeline',
      pipelineOptions: {
        onProgress: (progress) => {
  
          // Update status
          if (statusEl) {
            statusEl.textContent = `Processing... ${progress.frameCount} frames (${progress.fps.toFixed(1)} fps)`;
          }

          // Update pipeline stats display
          const updateStat = (id: string, value: string | number) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value.toString();
          };

          updateStat('stat-frames', progress.frameCount);
          updateStat('stat-fps', progress.fps.toFixed(1));
          updateStat('stat-elapsed', progress.elapsedSeconds.toFixed(1) + 's');
          updateStat('stat-decoder-queue', progress.decoder.decodeQueueSize);
          updateStat('stat-decoder-buffer', progress.decoder.bufferSize);
          updateStat('stat-render-buffer', progress.render.bufferSize);
          updateStat('stat-encoder-queue', progress.encoder.encodeQueueSize);
          updateStat('stat-encoder-buffer', progress.encoder.bufferSize);
        },
      },
    });

    console.log('Transcoding complete:', result);

    if (statusEl) {
      statusEl.textContent = `✓ Transcoding complete! Output size: ${(result.size / 1024 / 1024).toFixed(2)} MB`;
    }

    // Create URL for the transcoded video
    const url = URL.createObjectURL(result);

    // Show video preview
    const previewContainer = document.getElementById('preview-container');
    const previewVideo = document.getElementById('preview-video') as HTMLVideoElement;

    if (previewContainer && previewVideo) {
      previewContainer.style.display = 'block';
      previewVideo.src = url;
      previewVideo.load();
    }

    // Create download link
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace(/\.[^/.]+$/, '') + '-transcoded.mp4';
    a.textContent = 'Download transcoded video';
    a.style.display = 'block';
    a.style.marginTop = '20px';
    a.style.padding = '10px 20px';
    a.style.background = '#4CAF50';
    a.style.color = 'white';
    a.style.textDecoration = 'none';
    a.style.borderRadius = '4px';
    a.style.width = 'fit-content';

    const app = document.getElementById('app');
    if (app) {
      // Remove old download links
      const oldLinks = app.querySelectorAll('a');
      oldLinks.forEach(link => link.remove());
      app.appendChild(a);
    }

  } catch (error) {
    console.error('Error transcoding file:', error);
    if (statusEl) {
      statusEl.textContent = `✗ Error: ${error}`;
      statusEl.style.color = 'red';
    }
  }
}

async function loadDemoFile() {
  try {
    // Fetch the demo video file
    const response = await fetch('/demos/transcoding/hero-small.mp4');
    const arrayBuffer = await response.arrayBuffer();

    // Convert ArrayBuffer to File
    const file = new File([arrayBuffer], 'hero-small.mp4', { type: 'video/mp4' });

    await processFile(file);

  } catch (error) {
    console.error('Error loading demo file:', error);
  }
}

// Set up UI
document.addEventListener('DOMContentLoaded', () => {
  const loadDemoBtn = document.getElementById('loadDemoBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('fileInput') as HTMLInputElement;

  if (loadDemoBtn) {
    loadDemoBtn.addEventListener('click', () => {
      loadDemoFile();
    });
  }

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) {
        processFile(file);
      }
    });
  }
});
