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
import { ToolbarRow, toolbar } from '@/modules/core/ui/components/Toolbar';
import { cn } from '@/modules/core/lib/utils';

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
    <PageLayout>
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
            <ToolbarRow
              // The period is this page's date control; previewing unapproved hours is an action on it.
              modes={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <label className={toolbar.field}>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">From</span>
                    <input
                      type="date"
                      value={range.periodStart}
                      max={range.periodEnd}
                      onChange={(e) => setRange((r) => ({ ...r, periodStart: e.target.value }))}
                      className="bg-transparent text-[16px] md:text-[11px] font-bold focus:outline-none"
                    />
                  </label>
                  <label className={toolbar.field}>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">To</span>
                    <input
                      type="date"
                      value={range.periodEnd}
                      min={range.periodStart}
                      onChange={(e) => setRange((r) => ({ ...r, periodEnd: e.target.value }))}
                      className="bg-transparent text-[16px] md:text-[11px] font-bold focus:outline-none"
                    />
                  </label>
                </div>
              }
              actions={
                <label className={cn(toolbar.secondaryAction, 'cursor-pointer select-none', !approvedOnly && toolbar.secondaryActionOn)}>
                  <input
                    type="checkbox"
                    checked={!approvedOnly}
                    onChange={(e) => setApprovedOnly(!e.target.checked)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  Preview Unapproved
                </label>
              }
            />
          ) : undefined
        }
      />

      {/* ── Body (Gold Standard Glassmorphic Body Card) ── */}
      <PageLayout.Body>
        <GrossPayPeriodView
          periods={periods}
          periodStart={effectiveBounds.periodStart}
          periodEnd={effectiveBounds.periodEnd}
          employeeNames={employeeNames}
          isLoading={isLoading}
          error={error}
        />
      </PageLayout.Body>
    </PageLayout>
  );
};

export default GrossPayPage;
