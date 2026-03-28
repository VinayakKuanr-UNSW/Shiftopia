/**
 * Compliance Audit Logger
 *
 * Persists every compliance interaction to the compliance_audit_log table
 * for debugging, legal compliance, and replay purposes.
 *
 * Each checkpoint (add_shift, bid, swap) calls logComplianceEvent() after:
 *   - Running compliance (action='run')
 *   - Approving (action='approve')
 *   - Rejecting (action='reject')
 *   - Manager override (action='override', requires overrideReason)
 */

import { supabase } from '@/platform/realtime/client';

export type ComplianceContext = 'add_shift' | 'bid' | 'swap';
export type ComplianceAction = 'run' | 'approve' | 'reject' | 'override';

export interface ComplianceAuditEntry {
  userId: string;
  action: ComplianceAction;
  context: ComplianceContext;
  /** Serializable snapshot of the compliance input (employee, shift details) */
  inputSnapshot?: Record<string, unknown>;
  /** Serializable snapshot of the compliance result (buckets, summary) */
  resultSnapshot?: Record<string, unknown>;
  /** Reference ID: shiftId for add_shift, bidId for bid, swapId for swap */
  referenceId?: string;
  /** Required when action='override' */
  overrideReason?: string;
}

/**
 * Log a compliance event.
 * Fire-and-forget — does NOT throw on failure (audit failures must not block workflows).
 */
export async function logComplianceEvent(entry: ComplianceAuditEntry): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const userId = entry.userId || user?.id || 'unknown';

    await supabase.from('compliance_audit_log').insert({
      user_id:         userId,
      action:          entry.action,
      context:         entry.context,
      reference_id:    entry.referenceId ?? null,
      input_snapshot:  entry.inputSnapshot ?? null,
      result_snapshot: entry.resultSnapshot ?? null,
      override_reason: entry.overrideReason ?? null,
      // created_at is auto-set by DB default
    });
  } catch (err) {
    // Silent fail — audit log failures must NEVER block the main workflow
    console.warn('[compliance-audit] Failed to log event:', err);
  }
}

/**
 * Build a compact result snapshot from v2 RuleHitV2[] for storage.
 * Strips large data, keeps only what's needed for audit/replay.
 */
export function buildResultSnapshot(
  hits: Array<{ rule_id: string; severity: string; message: string }>
): Record<string, unknown> {
  const blockers = hits
    .filter(h => h.severity === 'BLOCKING')
    .map(h => ({ rule: h.rule_id, msg: h.message }));
  const warnings = hits
    .filter(h => h.severity === 'WARNING')
    .map(h => ({ rule: h.rule_id, msg: h.message }));
  return {
    total_hits:    hits.length,
    blockers,
    warnings,
    passed_count:  0, // caller can compute from RULE_METADATA
    evaluated_at:  new Date().toISOString(),
  };
}
