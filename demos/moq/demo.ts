// Load MoQ from CDN
// @ts-ignore
import * as Moq from 'https://esm.sh/@moq/lite';

// Endpoint configurations
const ENDPOINTS = {
  local: 'http://localhost:4443/test-124',
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


async function listen(track){


  console.log("Connecting to broadcast")


  console.log("Listening to track");

  console.log("Track", track)

  setInterval(async function(){

    console.log("Waiting for next group")
    const group = await track.nextGroup();
    console.log("Group", group)

    const frame = await group.readString();

    console.log("Frame", frame)



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



    console.log("Doing broadcast request")

    connection.publish('my-broadcast', broadcast);


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

     
    if(track.name ==='chat'){
      setInterval(function(){

        console.log("Sending stuff")
        const group = track.appendGroup();
        group.writeString("Hello, MoQ!");
        group.close();
  
      }, 1000);
  
  }


 




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
