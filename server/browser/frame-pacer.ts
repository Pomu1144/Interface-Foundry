/**
 * Pacing for engines that stream by polling screenshots (WebKit when its push
 * screencast cannot start). Pure so it is unit-testable.
 *
 *  - Aims at `fps` while the page changes, but never spends more than about half
 *    the time capturing (slow captures lower the rate instead of queueing).
 *  - Identical consecutive frames are not sent, and after a few of them the
 *    rate drops to `idleFps` until the page changes again or the user interacts.
 *  - Socket back-pressure and the session's shared frame budget are applied on
 *    top by the session (`PageHost.scheduleAck`).
 */
export class FramePacer {
  private unchanged = 0;

  constructor(
    private readonly opts: { fps: number; idleFps: number; idleAfter: number } = { fps: 30, idleFps: 4, idleAfter: 3 },
  ) {}

  /** Delay (ms) from the end of a capture to the start of the next one. */
  next(captureMs: number, changed: boolean): number {
    this.unchanged = changed ? 0 : this.unchanged + 1;
    const fps = this.unchanged >= this.opts.idleAfter ? this.opts.idleFps : this.opts.fps;
    const interval = Math.max(1000 / fps, captureMs * 2);
    return Math.round(Math.max(0, interval - captureMs));
  }

  /** User input, navigation or emulation: go back to full rate right away. */
  bump() {
    this.unchanged = 0;
  }

  get idle() {
    return this.unchanged >= this.opts.idleAfter;
  }
}
