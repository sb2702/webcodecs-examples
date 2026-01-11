import { Input, ALL_FORMATS, BlobSource } from 'mediabunny';

import { WebTransportPolyfill } from "@yomo/webtransport-polyfill";
import WebSocket from 'ws';

// Add global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

global.WebSocket = WebSocket;
global.WebTransport = WebTransportPolyfill;

import * as Moq from'@moq/lite'


async function main(){

    const RELAY_URL = 'http://localhost:4443'

    console.log(`Connecting to relay: ${RELAY_URL}`);
    try{
        // Disable WebSocket fallback to force WebTransport polyfill
        const moqConnection = await Moq.Connection.connect(new URL(RELAY_URL), {
            websocket: { enabled: false }
        });
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