import { WebCodecsPlayer } from '../../src/player';
import localforage from 'localforage';

declare global {
  interface Window {
    showOpenFilePicker(options?: {
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
      multiple?: boolean;
    }): Promise<FileSystemFileHandle[]>;
  }
}

async function getFileWithPermission() {


  try {
    // Request a video file using showOpenFilePicker
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'Video Files',
        accept: {
          'video/*': ['.mp4']
        }
      }],
      multiple: false
    });

    await localforage.setItem('videoFileHandle', fileHandle);
    return await fileHandle.getFile();

  } catch (error) {
    console.error('Error accessing file:', error);
    throw error;
  }
}


async function onFileSelected(file: File) {

  console.log('onFileSelected', file);

  const canvas = document.getElementById('canvas') as HTMLCanvasElement
  const player = new WebCodecsPlayer({ src: file, canvas });



  await player.initialize();

  await setupVideoControls(player);
}


window.reset = function() {

  localforage.removeItem('videoFileHandle');
  window.location.reload();
}


document.addEventListener('DOMContentLoaded', async () => {


      const button = document.getElementById('loadFileBtn') as HTMLButtonElement;
      button.textContent = 'Select Video File';


      return button.addEventListener('click', async () => {
        try {
          const file = await getFileWithPermission();
          onFileSelected(file);

          button.style.display = 'none';
        } catch (error) {
          console.error('Failed to initialize OffscreenVideo:', error);
        }
      });

});

