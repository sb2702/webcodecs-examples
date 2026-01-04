import { v4 as uuidv4 } from 'uuid';

type Listener = (args: any) => void;

export default class EventEmitter {
    listeners: Record<string, Record<string, Listener>> = {};

    /**
     * Add an event listener and return its unique ID
     */
    on(event: string, listener: Listener): string {

        if (!this.listeners[event]) {
            this.listeners[event] = {};
        }

        const id = uuidv4();
        this.listeners[event][id] = listener;
        return id;
    }

    /**
     * Remove a specific listener by its ID
     */
    off(event: string, listenerId: string): void {
        if (this.listeners[event]) {
            delete this.listeners[event][listenerId];
        }
    }

    /**
     * Emit an event to all registered listeners
     */
    emit(event: string, args: any): void {
        if (this.listeners[event]) {
            Object.values(this.listeners[event]).forEach(listener => {
                listener(args);
            });
        }
    }

    /**
     * Remove all listeners for a specific event
     */
    removeAllListeners(event: string): void {
        if (this.listeners[event]) {
            this.listeners[event] = {};
        }
    }
} 