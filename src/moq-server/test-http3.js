import WebSocket from 'ws';
import { WebTransport } from '@fails-components/webtransport';
//import { quicheLoaded } from '@fails-components/webtransport';

// Add global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

// Polyfill both WebSocket (for fallback) and WebTransport (for HTTP/3)
global.WebSocket = WebSocket;
global.WebTransport = WebTransport;

import * as Moq from '@moq/lite'

async function main(){
    // Wait for quiche to load
    console.log('Waiting for quiche to load...');
   // await quicheLoaded;
    console.log('Quiche loaded!');

    const RELAY_URL = 'http://localhost:4443/anon'

    console.log(`Connecting to relay: ${RELAY_URL}`);
    try{
        // This should now use real HTTP/3 WebTransport
        const moqConnection = await Moq.Connection.connect(new URL(RELAY_URL));
        console.log("Connected successfully via HTTP/3!");
        console.log(moqConnection);
    } catch(e){
        console.log("Unable to connect");
        console.error("Error details:", e);
        console.error("Error stack:", e?.stack);
        process.exit(1);
    }
}

main().catch(e => {
    console.error("Fatal error:", e);
    process.exit(1);
});
