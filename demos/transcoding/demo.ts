import { transcodeFile } from '../../src/transcoding';

console.log('Transcoding demo loaded');

async function processFile(file: File) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = `Processing ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`;
  }

  try {
    console.log('Starting transcode for:', file.name, file.size, 'bytes');

    // Transcode the file
    const result = await transcodeFile(file, 'pipeline');

    console.log('Transcoding complete:', result);

    if (statusEl) {
      statusEl.textContent = `✓ Transcoding complete! Output size: ${(result.size / 1024 / 1024).toFixed(2)} MB`;
    }

    // Create download link
    const url = URL.createObjectURL(result);
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
