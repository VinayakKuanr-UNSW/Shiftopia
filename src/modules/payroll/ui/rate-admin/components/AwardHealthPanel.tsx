/**
 * AwardHealthPanel — diagnostics checklist for the Pay Rates dashboard.
 *
 * Scans the loaded schedule data to produce a health report: are all expected
 * classifications present? Are allowances configured? Is a future rate set
 * scheduled? Pure computation — no new API calls.
 */

import React, { useMemo } from 'react';
import { ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { EbaRateSet } from '../../../data/ebaRates.read.api';

interface HealthCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

const EXPECTED_CLASSIFICATIONS = [
  'TRAINEE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5', 'LEVEL_6', 'LEVEL_7',
];
const EXPECTED_SECURITY = ['SECURITY_LEVEL_3', 'SECURITY_LEVEL_4', 'SECURITY_LEVEL_5', 'SECURITY_LEVEL_6'];
const EXPECTED_ALLOWANCES = ['meal', 'first_aid_per_hour', 'protein_spill', 'split_shift'];

function computeHealthChecks(schedule: EbaRateSet[]): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const latest = schedule.length > 0 ? schedule[schedule.length - 1] : null;

  if (!latest) {
    checks.push({ id: 'no-rates', label: 'No rate schedule loaded', ok: false });
    return checks;
  }

  const classSet = new Set(latest.rates.map((r) => r.classification));

  // Base classifications
  const missingBase = EXPECTED_CLASSIFICATIONS.filter((c) => !classSet.has(c));
  checks.push({
    id: 'base-rates',
    label: `Base rates configured (${EXPECTED_CLASSIFICATIONS.length - missingBase.length}/${EXPECTED_CLASSIFICATIONS.length} classifications)`,
    ok: missingBase.length === 0,
    detail: missingBase.length > 0 ? `Missing: ${missingBase.join(', ')}` : undefined,
  });

  // Security classifications
  const missingSec = EXPECTED_SECURITY.filter((c) => !classSet.has(c));
  checks.push({
    id: 'security-rates',
    label: `Security rates configured (${EXPECTED_SECURITY.length - missingSec.length}/${EXPECTED_SECURITY.length})`,
    ok: missingSec.length === 0,
    detail: missingSec.length > 0 ? `Missing: ${missingSec.join(', ')}` : undefined,
  });

  // Casual loading check — every casual basis should be exactly 25% above its
  // ordinary rate (cl 12.5(b)). Verify the actual loading, not just that a casual
  // row exists. A 1-cent tolerance absorbs per-cent rounding on the stored rates.
  const casualRows = latest.rates.filter((r) => r.employmentBasis === 'casual');
  const hasCasual = casualRows.length > 0;
  const offLoadingRows = casualRows.filter(
    (r) => !(r.ordinaryHourlyRate > 0 && Math.abs(r.paidHourlyRate / r.ordinaryHourlyRate - 1.25) <= 0.01),
  );
  checks.push({
    id: 'casual-loading',
    label: `Casual loading is 25% (${casualRows.length - offLoadingRows.length}/${casualRows.length} rows)`,
    ok: hasCasual && offLoadingRows.length === 0,
    detail: !hasCasual
      ? 'No casual rates found'
      : offLoadingRows.length > 0
        ? `Not 25% above ordinary: ${offLoadingRows.map((r) => r.classification).join(', ')}`
        : undefined,
  });

  // Allowances
  const allowanceCodes = new Set(latest.allowances.map((a) => a.code));
  const missingAllow = EXPECTED_ALLOWANCES.filter((c) => !allowanceCodes.has(c));
  checks.push({
    id: 'allowances',
    label: `Allowances configured (${EXPECTED_ALLOWANCES.length - missingAllow.length}/${EXPECTED_ALLOWANCES.length} types)`,
    ok: missingAllow.length === 0,
    detail: missingAllow.length > 0 ? `Missing: ${missingAllow.join(', ')}` : undefined,
  });

  // Future rate set
  const today = new Date().toISOString().split('T')[0];
  const hasFuture = schedule.some((s) => s.effectiveFrom > today);
  checks.push({
    id: 'future-set',
    label: 'Future rate version scheduled',
    ok: hasFuture,
    detail: hasFuture ? undefined : 'No upcoming rate set — use CPI preview to prepare one',
  });

  // Multiple employment bases
  const hasPermanent = latest.rates.some((r) => r.employmentBasis === 'permanent');
  checks.push({
    id: 'employment-bases',
    label: 'Permanent & casual employment bases',
    ok: hasPermanent && hasCasual,
  });

  return checks;
}

const AwardHealthPanel: React.FC<{ schedule: EbaRateSet[] }> = ({ schedule }) => {
  const checks = useMemo(() => computeHealthChecks(schedule), [schedule]);
  const passCount = checks.filter((c) => c.ok).length;
  const total = checks.length;

  return (
    <div 
      className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-6 shadow-sm"
      role="region" 
      aria-label="Award compliance health diagnostics"
    >
      <div className="flex items-center justify-between mb-6 pb-3 border-b border-border/30">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          <h3 className="text-base font-bold text-foreground">Award Health Checklist</h3>
        </div>
        <span 
          className={cn(
            'text-sm font-bold tabular-nums px-2.5 py-0.5 rounded-full border',
            passCount === total 
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' 
              : 'text-amber-400 bg-amber-500/10 border-amber-500/20',
          )}
          aria-live="polite"
        >
          {passCount} of {total} checks passed
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {checks.map((check) => (
          <div 
            key={check.id} 
            className="flex items-start gap-3 p-3 rounded-lg border border-border/20 bg-muted/10 transition-all hover:bg-muted/20"
          >
            {check.ok ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <p className={cn(
                'text-sm font-semibold',
                check.ok ? 'text-foreground' : 'text-amber-300',
              )}>
                {check.label}
              </p>
              {check.detail && (
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{check.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AwardHealthPanel;
