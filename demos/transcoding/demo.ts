import { transcodeFile } from '../../src/transcoding';

console.log('Transcoding demo loaded');

async function loadDemoFile() {
  try {
    // Fetch the demo video file
    const response = await fetch('/demos/transcoding/hero-small.mp4');
    const arrayBuffer = await response.arrayBuffer();

    // Convert ArrayBuffer to File
    const file = new File([arrayBuffer], 'hero-small.mp4', { type: 'video/mp4' });

    console.log('Loaded demo file:', file.name, file.size, 'bytes');

    // Transcode the file
    const result = await transcodeFile(file);

    console.log('Transcoding complete:', result);

  } catch (error) {
    console.error('Error loading or transcoding demo file:', error);
  }
}

// Load and transcode on page load
document.addEventListener('DOMContentLoaded', () => {
  loadDemoFile();
});
