export type RunControlState = 'running' | 'paused' | 'stopped';

export class RunController {
  private _state: RunControlState = 'running';
  private resumeWaiters: Array<() => void> = [];
  private abortController = new AbortController();

  get state(): RunControlState {
    return this._state;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  pause(): void {
    if (this._state === 'running') {
      this._state = 'paused';
    }
  }

  resume(): void {
    if (this._state !== 'paused') return;
    this._state = 'running';
    for (const resolve of this.resumeWaiters) resolve();
    this.resumeWaiters = [];
  }

  stop(): void {
    if (this._state === 'stopped') return;
    this._state = 'stopped';
    this.abortController.abort();
    if (this.resumeWaiters.length > 0) {
      for (const resolve of this.resumeWaiters) resolve();
      this.resumeWaiters = [];
    }
  }

  isStopped(): boolean {
    return this._state === 'stopped';
  }

  async checkpoint(): Promise<boolean> {
    if (this._state === 'stopped') return false;

    while (this._state === 'paused') {
      await new Promise<void>((resolve) => {
        this.resumeWaiters.push(resolve);
      });
      if (this.isStopped()) return false;
    }

    return true;
  }

  async sleep(ms: number): Promise<boolean> {
    const tickMs = 100;
    let elapsed = 0;

    while (elapsed < ms) {
      if (!(await this.checkpoint())) return false;
      const chunk = Math.min(tickMs, ms - elapsed);
      await new Promise((resolve) => window.setTimeout(resolve, chunk));
      elapsed += chunk;
    }

    return true;
  }
}
