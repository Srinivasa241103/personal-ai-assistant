/** AGT-02 — process-local cancellation paired with the durable DB status. */

import { RunAlreadyActiveError, RunCancelledError } from "./runErrors.js";

export interface RunExecutionLease {
  signal: AbortSignal;
  release(): void;
}

/**
 * The database is the durable cancellation truth. This registry supplies the
 * immediate `AbortSignal` for work already running in this process. A restart
 * loses the controller but not the cancelled DB status, so resume still fails.
 * Redis can replace the notification half later without changing this surface.
 */
export class RunCancellationRegistry {
  private readonly active = new Map<string, AbortController>();

  acquire(runId: string): RunExecutionLease {
    if (this.active.has(runId)) throw new RunAlreadyActiveError();

    const controller = new AbortController();
    this.active.set(runId, controller);
    let released = false;

    return {
      signal: controller.signal,
      release: () => {
        if (released) return;
        released = true;
        if (this.active.get(runId) === controller) this.active.delete(runId);
      },
    };
  }

  cancel(runId: string): boolean {
    const controller = this.active.get(runId);
    if (!controller) return false;
    controller.abort(new RunCancelledError());
    return true;
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }
}
