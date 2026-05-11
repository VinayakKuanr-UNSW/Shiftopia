/**
 * Projection Worker Client
 *
 * Main-thread bridge to the projection Web Worker. Manages:
 *   - Worker lifecycle (lazy init, termination)
 *   - Request ID sequencing (monotonic counter)
 *   - Debouncing (configurable, default 50ms)
 *   - Stale result discard via requestId matching
 *   - Cancellation via explicit cancel messages
 *
 * Usage:
 *   const client = new ProjectionWorkerClient();
 *   client.onResult = (result) => { ... };
 *   client.onError = (err) => { ... };
 *   client.requestProjection(request);
 *   client.dispose(); // on unmount
 */

import type {
  ProjectionRequest,
  ProjectionResult,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './protocol';

// ── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_DEBOUNCE_MS = 50;

// ── Client Class ──────────────────────────────────────────────────────────────

export class ProjectionWorkerClient {
  private worker: Worker | null = null;
  private requestCounter = 0;
  private lastSentRequestId = -1;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;

  /** Called when a valid (non-stale) projection result arrives. */
  onResult: ((result: ProjectionResult) => void) | null = null;

  /** Called when the worker reports an error. */
  onError: ((error: { requestId: number; message: string }) => void) | null = null;

  constructor(debounceMs = DEFAULT_DEBOUNCE_MS) {
    this.debounceMs = debounceMs;
  }

  // ── Lazy worker init ──────────────────────────────────────────────────────

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./projection.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = this.handleMessage;
      this.worker.onerror = (e) => {
        console.error('[ProjectionWorkerClient] Worker error:', e);
      };
    }
    return this.worker;
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private handleMessage = (event: MessageEvent<WorkerOutboundMessage>) => {
    const msg = event.data;

    switch (msg.type) {
      case 'result': {
        // Discard stale results — only accept the most recent requestId
        if (msg.payload.requestId !== this.lastSentRequestId) return;
        this.onResult?.(msg.payload);
        break;
      }
      case 'error': {
        if (msg.payload.requestId !== this.lastSentRequestId) return;
        this.onError?.(msg.payload);
        break;
      }
    }
  };

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Request a projection. Debounces rapid calls. Automatically cancels any
   * in-flight projection for a previous requestId.
   *
   * The caller should NOT set `requestId` — it is assigned internally.
   */
  requestProjection(
    request: Omit<ProjectionRequest, 'requestId'>,
  ): number {
    // Assign monotonic requestId
    const requestId = ++this.requestCounter;

    // Cancel previous in-flight request
    if (this.lastSentRequestId > 0) {
      this.cancelProjection(this.lastSentRequestId);
    }
    this.lastSentRequestId = requestId;

    // Clear any pending debounce
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Debounce the actual send
    this.debounceTimer = setTimeout(() => {
      const worker = this.ensureWorker();
      const message: WorkerInboundMessage = {
        type: 'project',
        payload: { ...request, requestId },
      };
      worker.postMessage(message);
    }, this.debounceMs);

    return requestId;
  }

  /**
   * Explicitly cancel an in-flight projection.
   */
  cancelProjection(requestId: number): void {
    if (!this.worker) return;
    const message: WorkerInboundMessage = {
      type: 'cancel',
      payload: { requestId },
    };
    this.worker.postMessage(message);
  }

  /**
   * Terminate the worker and clean up. Call on component unmount.
   */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.onResult = null;
    this.onError = null;
  }
}
