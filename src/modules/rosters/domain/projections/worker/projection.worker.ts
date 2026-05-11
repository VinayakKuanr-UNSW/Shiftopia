/**
 * Projection Web Worker
 *
 * ONLY responsible for:
 *   1. Receiving ProjectionRequest messages
 *   2. Cancellation (tracking activeRequestId)
 *   3. Delegating to runProjectionPipeline()
 *   4. Sending ProjectionResult messages back
 *
 * NO business logic lives here. The pipeline owns orchestration, filtering,
 * costing, and projector selection.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * This file runs in a dedicated Worker thread. It must NOT import React,
 * Zustand, or any module that accesses `window` / `document` / `localStorage`.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './protocol';
import { runProjectionPipeline } from '../pipeline/runProjectionPipeline';

// ── Cancellation state ────────────────────────────────────────────────────────
// Mutable ref shared with the pipeline so long-running loops can bail early.
const activeRequestId = { current: -1 };

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'project': {
      const { payload: request } = msg;

      // Update the active request — any in-flight pipeline for a prior
      // requestId will notice and abort at the next cancellation checkpoint.
      activeRequestId.current = request.requestId;

      try {
        const result = runProjectionPipeline(request, activeRequestId);

        // If the pipeline returned null, the request was cancelled by a
        // newer one — silently discard.
        if (result === null) return;

        // Only send if this is still the active request (double-check after
        // the synchronous pipeline completes in case a cancel arrived while
        // we were computing).
        if (activeRequestId.current !== request.requestId) return;

        const outbound: WorkerOutboundMessage = {
          type: 'result',
          payload: result,
        };
        self.postMessage(outbound);
      } catch (err) {
        // Don't let worker crash — report error back to main thread.
        const outbound: WorkerOutboundMessage = {
          type: 'error',
          payload: {
            requestId: request.requestId,
            message: err instanceof Error ? err.message : String(err),
          },
        };
        self.postMessage(outbound);
      }
      break;
    }

    case 'cancel': {
      // Setting activeRequestId to -1 causes any in-flight pipeline to
      // abort at its next cancellation checkpoint.
      if (activeRequestId.current === msg.payload.requestId) {
        activeRequestId.current = -1;
      }
      break;
    }
  }
};
