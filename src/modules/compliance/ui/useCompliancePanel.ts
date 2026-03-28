/**
 * useCompliancePanel — Shared hook for manual compliance evaluation.
 *
 * Wraps the v2 compliance engine with:
 *   - Manual trigger only (NO auto-run ever)
 *   - Stale detection (call markStale() when inputs change after a run)
 *   - Warning acknowledgment
 *   - Unified status machine: idle → running → results | error | stale
 *   - canProceed gating: no blockers + no system fails + warnings ack'd
 *
 * Usage:
 *   const panel = useCompliancePanel({ buildInputs: async () => [myInput] });
 *   <CompliancePanel hook={panel} />
 *   // Gate action button on panel.canProceed
 */

import { useState, useCallback, useRef } from 'react';
import { evaluateCompliance } from '@/modules/compliance/v2';
import type {
    ComplianceInputV2,
    ComplianceResultV2,
    RuleHitV2,
} from '@/modules/compliance/v2/types';
import { classifyBuckets, getBucketSummary } from './bucket-map';
import type { BucketMap, BucketSummary } from './bucket-map';

export type PanelStatus = 'idle' | 'running' | 'results' | 'error' | 'stale';

export interface PanelResult {
    buckets:      BucketMap;
    summary:      BucketSummary;
    evaluatedAt:  Date;
    /** Raw v2 results */
    rawResult:    ComplianceResultV2;
    /** For swaps, we also have party B buckets/summary */
    partyB?: {
        buckets: BucketMap;
        summary: BucketSummary;
        rawResult: ComplianceResultV2;
    };
}

export interface UseCompliancePanelOptions {
    /**
     * Async function that returns the compliance input(s).
     * - Single party (add_shift, bid): return [ComplianceInputV2]
     * - Two parties (swap): return [inputA, inputB]
     * May perform DB fetches; called only on manual run.
     */
    buildInputs: () => Promise<[ComplianceInputV2] | [ComplianceInputV2, ComplianceInputV2]>;
    stage?: 'DRAFT' | 'PUBLISH';
}

export interface UseCompliancePanelReturn {
    status:               PanelStatus;
    result:               PanelResult | null;
    error:                string | null;
    warningsAcknowledged: boolean;
    /**
     * True when:
     *   - status === 'results'
     *   - No blockers (A.length === 0)
     *   - No system fails (D BLOCKING hits === 0)
     *   - No warnings OR warnings acknowledged
     */
    canProceed:           boolean;
    run:                  () => Promise<void>;
    acknowledgeWarnings:  (ack: boolean) => void;
    /** Call when inputs change after a run — marks result stale, disables action */
    markStale:            () => void;
    reset:                () => void;
}

export function useCompliancePanel(opts: UseCompliancePanelOptions): UseCompliancePanelReturn {
    const [status,               setStatus]               = useState<PanelStatus>('idle');
    const [result,               setResult]               = useState<PanelResult | null>(null);
    const [error,                setError]                = useState<string | null>(null);
    const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
    const runningRef = useRef(false);
    const stage = opts.stage ?? 'PUBLISH';

    const run = useCallback(async () => {
        if (runningRef.current) return;
        runningRef.current = true;
        setStatus('running');
        setError(null);
        setWarningsAcknowledged(false);

        try {
            const inputs = await opts.buildInputs();

            let allHits:   RuleHitV2[];
            let rawResult: ComplianceResultV2;
            let rawResultB: ComplianceResultV2 | undefined;

            if (inputs.length === 2) {
                // Swap: evaluate both parties independently
                const rawResult  = evaluateCompliance(inputs[0], { stage }) as ComplianceResultV2;
                const rawResultB = evaluateCompliance(inputs[1], { stage }) as ComplianceResultV2;
                
                const bucketsA = classifyBuckets(rawResult.rule_hits);
                const summaryA = getBucketSummary(bucketsA);
                const bucketsB = classifyBuckets(rawResultB.rule_hits);
                const summaryB = getBucketSummary(bucketsB);

                // For the main "canProceed" logic, we combine the summaries
                const combinedSummary: BucketSummary = {
                    blockers:    summaryA.blockers + summaryB.blockers,
                    warnings:    summaryA.warnings + summaryB.warnings,
                    passed:      0, // Will be recalculated from combined rules
                    systemFails: summaryA.systemFails + summaryB.systemFails,
                };

                // Combined buckets for the flat view fallback (though UI will now use dual columns)
                const mergedBuckets = classifyBuckets([...rawResult.rule_hits, ...rawResultB.rule_hits]);
                combinedSummary.passed = mergedBuckets.C.length;

                setResult({ 
                    buckets: mergedBuckets, 
                    summary: combinedSummary, 
                    evaluatedAt: new Date(), 
                    rawResult,
                    partyB: {
                        buckets: bucketsB,
                        summary: summaryB,
                        rawResult: rawResultB
                    }
                });
            } else {
                const rawResult = evaluateCompliance(inputs[0], { stage }) as ComplianceResultV2;
                const buckets = classifyBuckets(rawResult.rule_hits);
                const summary = getBucketSummary(buckets);

                setResult({ buckets, summary, evaluatedAt: new Date(), rawResult });
            }
            setStatus('results');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Compliance check failed';
            setError(msg);
            setStatus('error');
        } finally {
            runningRef.current = false;
        }
    }, [opts, stage]);

    const markStale = useCallback(() => {
        setStatus(prev => prev === 'results' ? 'stale' : prev);
    }, []);

    const reset = useCallback(() => {
        setStatus('idle');
        setResult(null);
        setError(null);
        setWarningsAcknowledged(false);
    }, []);

    const canProceed =
        status === 'results' &&
        result !== null &&
        result.buckets.A.length   === 0 &&
        result.summary.systemFails === 0 &&
        (result.buckets.B.length  === 0 || warningsAcknowledged);

    return {
        status,
        result,
        error,
        warningsAcknowledged,
        canProceed,
        run,
        acknowledgeWarnings: setWarningsAcknowledged,
        markStale,
        reset,
    };
}
