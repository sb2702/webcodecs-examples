import { v4 as uuidv4 } from 'uuid';


export interface WorkerMessage {
  cmd: string;
  data: any;
  request_id: string;
}

export interface WorkerResponse {
  request_id: string;
  res: any;
}

interface GenericObject {
    [key: string]: any;
}



export type WorkerEventHandler = (data: any) => void;

export class WorkerController {
  private worker: Worker;
  private listeners: Record<string, WorkerEventHandler>;
  private persistentEvents: string[];
  private port?: MessagePort;

  constructor(workerUrl: string | URL, persistentEvents: string[] = [], port?: MessagePort) {
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.listeners = {};
    this.persistentEvents = persistentEvents;

    this.worker.onmessage = this.handleWorkerMessage.bind(this);

    if(port){
      this.port = port;
      this.worker.postMessage({cmd: 'port', data: port}, {transfer: [port]});
    }
  }


  setupPort(port: MessagePort){
    this.port = port;
    this.worker.postMessage({cmd: 'port', data: port}, {transfer: [port]});
  }

  private handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
  
    if (this.listeners[event.data.request_id]) {
      this.listeners[event.data.request_id](event.data.res);

      // Clean up non-persistent listeners
      if (!this.persistentEvents.includes(event.data.request_id)) {
        delete this.listeners[event.data.request_id];
      }
    }
  }

  public addPersistentListener(eventName: string, handler: WorkerEventHandler): void {
    if (!this.persistentEvents.includes(eventName)) {
      this.persistentEvents.push(eventName);
    }
    this.listeners[eventName] = handler;
  }

  public async sendMessage<T>(
    cmd: string, 
    data: any = {}, 
    transfer: Transferable[] = [],
    sanitize: boolean = true
  ): Promise<T> {
    const request_id = uuidv4();
    const sanitizedData = sanitize ? sanitizeForWorker(data) : data;

    return new Promise((resolve, reject) => {
      try {
        const message: WorkerMessage = {
          cmd,
          request_id,
          data: sanitizedData
        };


      


        this.worker.postMessage(message, transfer);
        
        this.listeners[request_id] = (response: T) => {
          resolve(response);
        };
      } catch (error) {
        reject(new Error('Failed to send message to worker: ' + error));
      }
    });
  }

  public terminate(): void {
    this.worker.terminate();
    this.listeners = {};
  }
} 



function sanitizeForWorker(obj: GenericObject): GenericObject {
    // Handle null or primitive values
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }


    const special_types = [
        ArrayBuffer,
        Blob,
        EncodedVideoChunk,
        ImageBitmap,
        EncodedAudioChunk,
        OffscreenCanvas,
        Uint8Array,
        VideoFrame,
        FileSystemFileHandle,
        MessageChannel,
        MessagePort
    ]

    // Handle special cases

    for (const type of special_types) {
        if(obj instanceof type) {
            return obj;
        }
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeForWorker(item));
    }

    // Get raw object if it's a Vue Proxy
    const rawObj = obj && obj.__v_raw ? obj.__v_raw : obj;

    // Create a new object to store sanitized properties
    const sanitized: GenericObject = {};

    // Process each property
    for (const key in rawObj) {
        // Skip Vue internal properties
        if (key.startsWith('__v_')) {
            continue;
        }

        const value = rawObj[key];

        // Skip functions
        if (typeof value === 'function') {
            continue;
        }

        // Recursively sanitize nested objects
        sanitized[key ] = sanitizeForWorker(value);
    }

    return sanitized;
}
