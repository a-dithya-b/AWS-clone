/**
 * Every time-based rule (sessions now; visibility timeouts and retention later) reads time from a
 * Clock instead of calling `new Date()`, so tests can move time forward instantly.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  constructor(private current = new Date("2026-01-01T00:00:00.000Z")) {}
  now() {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}
