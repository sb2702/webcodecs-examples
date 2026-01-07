import * as Moq from '@moq/lite';
import { Effect, Signal } from "@moq/signals";

// Endpoint configurations
const ENDPOINTS = {
  local: 'http://localhost:4443/test-123',
  cloudflare: 'https://interop-relay.cloudflare.mediaoverquic.com:443',
};

// State
let connection: any = null;
let currentEndpoint: string = '';


console.log("Moq")
console.log(Moq);

// UI Elements
const connectLocalBtn = document.getElementById('connectLocal') as HTMLButtonElement;
const connectCloudflareBtn = document.getElementById('connectCloudflare') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const logEl = document.getElementById('log') as HTMLDivElement;

// Logging
function log(message: string, type: 'info' | 'success' | 'error' = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${message}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Update UI state
function updateUI(connected: boolean, error: boolean = false) {
  connectLocalBtn.disabled = connected;
  connectCloudflareBtn.disabled = connected;
  disconnectBtn.disabled = !connected;

  if (connected) {
    statusEl.className = 'status connected';
    statusEl.textContent = `✓ Connected to ${currentEndpoint}`;
  } else if (error) {
    statusEl.className = 'status error';
    statusEl.textContent = '✗ Connection failed';
  } else {
    statusEl.className = 'status';
    statusEl.textContent = 'Not connected';
  }
}


async function listen(){

// Subscribe to a broadcast
  const broadcast = connection.consume("my-broadcast");


  console.log("Connecting to broadcast")

  // Subscribe to a specific track
  const track = await broadcast.subscribe("my-track");

  console.log("Listening to track");

  setInterval(async function(){

    const group = await track.nextGroup();
    console.log("Group", group)




  }, 100);



}
// Connect to endpoint
async function connect(endpoint: string, name: string) {
  try {
    log(`Attempting to connect to ${name} (${endpoint})...`, 'info');


    connection = await Moq.Connection.connect(new URL(endpoint));


    currentEndpoint = name;

    log(`Successfully connected to ${name}!`, 'success');
    updateUI(true);

    // Test basic functionality - listen for announcements
    log('Listening for announcements...', 'info');



    console.log("Connection", connection);


    const broadcast = new Moq.Broadcast();


    console.log("A");

    for (;;) {
    console.log("B")
			const request = await broadcast.requested();
      console.log('Request', request)
			if (!request) break;

    }

    console.log("C");
//    connection.publish('my-broadcast', broadcast);



    const trackRequest =  await broadcast.requested();

    console.log("Track requested", trackRequest)

    console.log(trackRequest?.track.state)

    // Create a broadcast, not associated with any connection/name yet.


    if(!trackRequest) return;

    const {track, priority} = trackRequest;

    console.log(`Track`, track);
    console.log(`Priority`, priority)
   // const track = 




    console.log("Track");
    console.log(track)


    listen();



    setInterval(function(){

      console.log("Sending stuff")
      const group = track.appendGroup();
      group.writeString("Hello, MoQ!");
      group.close();

      

    }, 200);





    

  } catch (error: any) {
    log(`Connection failed: ${error.message}`, 'error');
    console.error('Connection error:', error);
    updateUI(false, true);
  }
}

// Disconnect
function disconnect() {
  if (connection) {
    try {
      if (typeof connection.close === 'function') {
        connection.close();
      }
      log('Disconnected', 'info');
    } catch (error: any) {
      log(`Disconnect error: ${error.message}`, 'error');
    }
    connection = null;
    currentEndpoint = '';
    updateUI(false);
  }
}

// Event listeners
connectLocalBtn.addEventListener('click', () => {
  connect(ENDPOINTS.local, 'Local Relay');
});

connectCloudflareBtn.addEventListener('click', () => {
  connect(ENDPOINTS.cloudflare, 'Cloudflare Relay');
});

disconnectBtn.addEventListener('click', disconnect);

// Initial log
log('MoQ Connection Test Ready', 'info');
log(`Local endpoint: ${ENDPOINTS.local}`, 'info');
log(`Cloudflare endpoint: ${ENDPOINTS.cloudflare}`, 'info');
