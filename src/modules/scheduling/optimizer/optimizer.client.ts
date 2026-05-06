/**
 * OR-Tools Optimizer HTTP Client
 *
 * Sends scheduling problems to the Python CP-SAT service and returns
 * the proposed assignment solution.
 *
 * The service URL defaults to VITE_OPTIMIZER_URL (set in .env.local)
 * or falls back to http://localhost:8080.
 *
 * Never writes to the database — only proposes assignments.
 */

import type { OptimizeRequest, OptimizeResponse, OptimizerHealth } from '../types';

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_OPTIMIZER_URL = 'http://localhost:5005';

function getOptimizerUrl(): string {
    return (import.meta.env.VITE_OPTIMIZER_URL as string | undefined)
        ?? DEFAULT_OPTIMIZER_URL;
}

// =============================================================================
// CLIENT
// =============================================================================

export class OptimizerClient {
    private readonly baseUrl: string;

    constructor(baseUrl?: string) {
        this.baseUrl = baseUrl ?? getOptimizerUrl();
    }

    /**
     * Check whether the Python optimizer service is reachable.
     */
    async healthCheck(): Promise<OptimizerHealth> {
        const t0 = performance.now();
        try {
            const response = await fetch(`${this.baseUrl}/health`, {
                signal: AbortSignal.timeout(3000),
            });
            const latencyMs = Math.round(performance.now() - t0);
            if (!response.ok) {
                return { available: false, url: this.baseUrl, latencyMs, error: `HTTP ${response.status}` };
            }
            return { available: true, url: this.baseUrl, latencyMs };
        } catch (err: any) {
            return {
                available: false,
                url: this.baseUrl,
                error: err?.message ?? 'Connection refused',
            };
        }
    }

    /**
     * Run the CP-SAT optimizer.
     *
     * @param request  - The scheduling problem (shifts + employees + constraints)
     * @returns        - Proposed assignments (NEVER written to DB by this function)
     * @throws         - OptimizerError if the service is unreachable or returns error
     */
    async optimize(request: OptimizeRequest, externalSignal?: AbortSignal): Promise<OptimizeResponse> {
        const url = `${this.baseUrl}/optimize`;

        console.debug('[OptimizerClient] POST', url, {
            shifts: request.shifts.length,
            employees: request.employees.length,
            time_limit: request.solver_params?.max_time_seconds ?? 30,
        });

        // Combine the time-limit timeout with any caller-supplied abort signal
        // so the in-flight request actually cancels when the user hits Cancel.
        const timeoutSignal = AbortSignal.timeout((request.time_limit_seconds ?? 30) * 1000 + 5000);
        const signal = externalSignal
            ? AbortSignal.any([timeoutSignal, externalSignal])
            : timeoutSignal;

        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
                signal,
            });
        } catch (err: any) {
            throw new OptimizerError(
                `Cannot reach optimizer service at ${this.baseUrl}. Is it running? (pip install -r requirements.txt && python ortools_runner.py)`,
                'CONNECTION_REFUSED',
                err,
            );
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            console.error('[OptimizerClient] Error Body:', body);
            throw new OptimizerError(
                `Optimizer returned HTTP ${response.status}: ${body}`,
                'HTTP_ERROR',
            );
        }

        const data = await response.json() as OptimizeResponse;

        console.debug('[OptimizerClient] Result:', {
            status: data.status,
            assignments: data.assignments.length,
            unassigned: data.unassigned_shift_ids.length,
            solve_ms: data.solve_time_ms,
        });

        return data;
    }
}

// =============================================================================
// ERROR CLASS
// =============================================================================

export class OptimizerError extends Error {
    constructor(
        message: string,
        public readonly code: 'CONNECTION_REFUSED' | 'HTTP_ERROR' | 'SOLVER_ERROR',
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'OptimizerError';
    }
}

/** Singleton client — uses VITE_OPTIMIZER_URL env variable. */
export const optimizerClient = new OptimizerClient();
