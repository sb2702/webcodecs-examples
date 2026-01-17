import { Input, ALL_FORMATS, BlobSource } from 'mediabunny';
import WebSocket from 'ws';
global.WebSocket = WebSocket;

import { install } from "@moq/web-transport-ws"
install(); // Polyfills globalThis.WebTransport in Node.js


// Add global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});


import * as Moq from'@moq/lite'


async function main(){

    const RELAY_URL = 'https://usc.cdn.moq.dev/anon'

    console.log(`Connecting to relay: ${RELAY_URL}`);
    try{
        // Disable WebSocket fallback to force WebTransport polyfill
        const moqConnection = await Moq.Connection.connect(new URL(RELAY_URL));
        console.log("Connected successfully!");
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