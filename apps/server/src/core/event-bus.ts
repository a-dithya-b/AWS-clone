import { EventEmitter } from "node:events";

/** A message on the in-process bus. `topic` is usually a resource ARN, e.g. a queue ARN. */
export interface BusEvent {
  topic: string;
  type: string;
  at: string;
  data: unknown;
}

/** Tiny pub/sub so services can tell live views (Server-Sent Events) what changed. */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Many browser tabs may watch the same queue.
    this.emitter.setMaxListeners(0);
  }

  publish(event: BusEvent) {
    this.emitter.emit(event.topic, event);
    this.emitter.emit("*", event);
  }

  /** Returns an unsubscribe function. Use "*" for every event. */
  subscribe(topic: string, listener: (event: BusEvent) => void): () => void {
    this.emitter.on(topic, listener);
    return () => this.emitter.off(topic, listener);
  }
}
