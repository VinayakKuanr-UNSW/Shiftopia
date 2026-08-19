/**
 * GrossPayPage — container page for the gross-pay surface. Owns a simple pay-
 * period selector, calls the `useGrossPay` container hook, and renders the
 * results through GrossPayPeriodView.
 *
 * GROSS pay only. Not a payslip of record (banner lives in GrossPayPeriodView).
 *
 * ROUTE: /management/payroll, behind the `management` FeatureGate. This block
 * used to say the page was deliberately NOT wired into the route table — true
 * when the lane that owned the router was separate, and stale from the moment
 * it was.
 *
 * Dark-first, light-mode safe: every colour utility is paired with a light
 * counterpart.
 */

import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';
import { Wallet } from 'lucide-react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import type { PeriodBounds } from '../domain/aggregatePeriodGrossPay';
import { useGrossPay } from '../state/useGrossPay';
import { GrossPayPeriodView } from './GrossPayPeriodView';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';

export interface GrossPayPageProps {
  /**
   * Optional fixed period bounds. When omitted the page shows its own
   * date-range selector (defaulting to the current Monday-anchored week).
   */
  bounds?: PeriodBounds;
  /** Optional employee-id → display-name map handed to the view. */
  employeeNames?: Record<string, string>;
}

/** Current Monday-anchored ISO week as inclusive YYYY-MM-DD bounds. */
function currentWeekBounds(): PeriodBounds {
  const now = new Date();
  return {
    periodStart: format(startOfWeekAU(now), 'yyyy-MM-dd'),
    periodEnd: format(endOfWeekAU(now), 'yyyy-MM-dd'),
  };
}

export const GrossPayPage: React.FC<GrossPayPageProps> = ({ bounds, employeeNames }) => {
  const [range, setRange] = useState<PeriodBounds>(() => bounds ?? currentWeekBounds());
  const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');

  const [approvedOnly, setApprovedOnly] = useState(true);
  // A caller-supplied fixed period locks the selector out.
  const controlled = !!bounds;
  const effectiveBounds = controlled ? bounds! : range;

  const { data, isLoading, error } = useGrossPay({ 
    bounds: effectiveBounds,
    options: {
      orgIds: scope.org_ids.length ? scope.org_ids : undefined,
      deptIds: scope.dept_ids.length ? scope.dept_ids : undefined,
      subDeptIds: scope.subdept_ids.length ? scope.subdept_ids : undefined,
      approvedOnly,
    }
  });

  const periods = useMemo(() => data ?? [], [data]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* ── GOLD STANDARD HEADER ── */}
      <GoldStandardHeader
        title="Gross Pay"
        Icon={Wallet}
        mode="managerial"
        scope={scope}
        setScope={setScope}
        isGammaLocked={isGammaLocked}
        functionBar={
          !controlled ? (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!approvedOnly}
                  onChange={(e) => setApprovedOnly(!e.target.checked)}
                  className="rounded border-slate-300 text-primary focus:ring-primary dark:border-white/15 dark:bg-slate-800"
                />
                Preview Unapproved
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                From
                <input
                  type="date"
                  value={range.periodStart}
                  max={range.periodEnd}
                  onChange={(e) =>
                    setRange((r) => ({ ...r, periodStart: e.target.value }))
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-800 dark:text-white"
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                To
                <input
                  type="date"
                  value={range.periodEnd}
                  min={range.periodStart}
                  onChange={(e) =>
                    setRange((r) => ({ ...r, periodEnd: e.target.value }))
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-800 dark:text-white"
                />
              </label>
            </div>
          ) : undefined
        }
      />

      {/* ── Body (Gold Standard Glassmorphic Body Card) ── */}
      <PageLayout.Body className="mx-4 lg:mx-6 mb-4 lg:mb-6">
        <GrossPayPeriodView
          periods={periods}
          periodStart={effectiveBounds.periodStart}
          periodEnd={effectiveBounds.periodEnd}
          employeeNames={employeeNames}
          isLoading={isLoading}
          error={error}
        />
      </PageLayout.Body>
    </div>
  );
};

export default GrossPayPage;
