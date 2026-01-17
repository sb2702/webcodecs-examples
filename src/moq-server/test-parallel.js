// Test if both async loops can run in parallel

async function processVideo() {
  console.log('Video processor started');
  let count = 0;
  while (true) {
    await new Promise(r => setTimeout(r, 100));
    count++;
    console.log(`Video frame ${count}`);
  }
}

async function processAudio() {
  console.log('Audio processor started');
  let count = 0;
  while (true) {
    await new Promise(r => setTimeout(r, 50));
    count++;
    console.log(`Audio frame ${count}`);
  }
}

// Run both without await
processVideo();
processAudio();

console.log('Both started in parallel');
