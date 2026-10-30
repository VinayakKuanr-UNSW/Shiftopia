/**
 * GrossPayPage — the one place money is shown (decision 2026-10-09). Owns the
 * period selector and four tabs (the active one is ?tab= in the URL):
 *
 *   Shifts       — every shift with its Scheduled / Actual / Billable Pay
 *                  (useShiftPayLedger → ShiftPayLedgerView).
 *   Labour cost  — the same ledger rolled up by department / sub-department /
 *                  role / employee against budgets (LabourCostView).
 *   Pay run      — per employee, the payable period: approved shifts, salary,
 *                  leave, time in lieu (useGrossPay → GrossPayPeriodView).
 *   Rates        — the EBA rate tables (moved from Settings; needs the
 *                  'configurations' permission, as it did there).
 *
 * GROSS pay only. Not a payslip of record (each view carries the banner).
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
import { useSearchParams } from 'react-router-dom';
import { BadgeDollarSign, ListChecks, PieChart, Shield, Users, Wallet } from 'lucide-react';
import { useAuth } from '@/platform/auth/useAuth';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import type { PeriodBounds } from '../domain/aggregatePeriodGrossPay';
import { useGrossPay } from '../state/useGrossPay';
import { useShiftPayLedger } from '../state/useShiftPayLedger';
import { useLabourCostContext } from '../state/useLabourCostContext';
import { LabourCostView } from './LabourCostView';
import { PayRatesSettings } from './rate-admin/PayRatesSettings';
import { GrossPayPeriodView } from './GrossPayPeriodView';
import { ShiftPayLedgerView } from './ShiftPayLedgerView';
import { Tabs, TabsContent } from '@/modules/core/ui/primitives/tabs';
import { cn } from '@/modules/core/lib/utils';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { ToolbarRow, ToolbarSegmented, toolbar } from '@/modules/core/ui/components/Toolbar';

interface GrossPayPageProps {
  /**
   * Optional fixed period bounds. When omitted the page shows its own
   * date-range selector (defaulting to the current Monday-anchored week).
   */
  bounds?: PeriodBounds;
  /** Optional employee-id → display-name map for the pay run. */
  employeeNames?: Record<string, string>;
}

type GrossPayTab = 'shifts' | 'labour' | 'payrun' | 'rates';

const TABS: { value: GrossPayTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'shifts', label: 'Shifts', Icon: ListChecks },
  { value: 'labour', label: 'Labour cost', Icon: PieChart },
  { value: 'payrun', label: 'Pay run', Icon: Users },
  { value: 'rates', label: 'Rates', Icon: BadgeDollarSign },
];

function isTab(v: string | null): v is GrossPayTab {
  return TABS.some((t) => t.value === v);
}

/** Current Monday-anchored ISO week as inclusive YYYY-MM-DD bounds. */
function currentWeekBounds(): PeriodBounds {
  const now = new Date();
  return {
    periodStart: format(startOfWeekAU(now), 'yyyy-MM-dd'),
    periodEnd: format(endOfWeekAU(now), 'yyyy-MM-dd'),
  };
}

const GrossPayPage: React.FC<GrossPayPageProps> = ({ bounds, employeeNames }) => {
  const [range, setRange] = useState<PeriodBounds>(() => bounds ?? currentWeekBounds());
  const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: GrossPayTab = isTab(tabParam) ? tabParam : 'shifts';
  const setTab = (next: GrossPayTab) => setSearchParams((prev) => {
    const params = new URLSearchParams(prev);
    params.set('tab', next);
    return params;
  }, { replace: true });
  const { hasPermission } = useAuth();
  const canManageRates = hasPermission('configurations');
  const [approvedOnly, setApprovedOnly] = useState(true);
  // A caller-supplied fixed period locks the selector out.
  const controlled = !!bounds;
  const effectiveBounds = controlled ? bounds! : range;

  const scopeIds = {
    orgIds: scope.org_ids.length ? scope.org_ids : undefined,
    deptIds: scope.dept_ids.length ? scope.dept_ids : undefined,
    subDeptIds: scope.subdept_ids.length ? scope.subdept_ids : undefined,
  };

  // Only the active tab fetches. Shifts and Labour cost share one ledger query.
  const ledger = useShiftPayLedger({
    bounds: effectiveBounds,
    scope: scopeIds,
    enabled: tab === 'shifts' || tab === 'labour',
  });
  const payRun = useGrossPay({
    bounds: effectiveBounds,
    options: { ...scopeIds, approvedOnly },
    enabled: tab === 'payrun',
  });

  const ledgerRows = useMemo(() => ledger.data ?? [], [ledger.data]);
  const labourContext = useLabourCostContext({
    rows: ledgerRows,
    bounds: effectiveBounds,
    scopeDepartmentIds: scopeIds.deptIds,
    enabled: tab === 'labour' && ledger.isSuccess,
  });
  const periods = useMemo(() => payRun.data ?? [], [payRun.data]);

  return (
    // Tabs wraps the shell (as on Insights) so the header and body are the
    // shell's own children.
    <Tabs value={tab} onValueChange={(v) => setTab(v as GrossPayTab)} className="h-full">
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
            <ToolbarRow
              views={
                <ToolbarSegmented
                  value={tab}
                  onValueChange={setTab}
                  options={TABS.map(({ value, label, Icon }) => ({
                    id: value,
                    label,
                    icon: <Icon className="h-3.5 w-3.5" />,
                  }))}
                />
              }
              // The period is this page's date control.
              modes={
                !controlled ? (
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
                ) : undefined
              }
              // Previewing unapproved hours is an action on the pay run.
              actions={
                tab === 'payrun' ? (
                  <label className={cn(toolbar.secondaryAction, 'cursor-pointer select-none', !approvedOnly && toolbar.secondaryActionOn)}>
                    <input
                      type="checkbox"
                      checked={!approvedOnly}
                      onChange={(e) => setApprovedOnly(!e.target.checked)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    Preview Unapproved
                  </label>
                ) : undefined
              }
            />
          }
        />

        {/* ── Body (Gold Standard Glassmorphic Body Card) ── */}
        <PageLayout.Body>
          <TabsContent value="shifts" className="mt-0 outline-none">
            {tab === 'shifts' && (
              <ShiftPayLedgerView
                rows={ledgerRows}
                periodStart={effectiveBounds.periodStart}
                periodEnd={effectiveBounds.periodEnd}
                isLoading={ledger.isLoading}
                error={ledger.error}
              />
            )}
          </TabsContent>
          <TabsContent value="labour" className="mt-0 outline-none">
            {tab === 'labour' && (
              <LabourCostView
                rows={ledgerRows}
                periodStart={effectiveBounds.periodStart}
                periodEnd={effectiveBounds.periodEnd}
                context={labourContext.data}
                isLoading={ledger.isLoading || labourContext.isLoading}
                error={ledger.error ?? labourContext.error}
              />
            )}
          </TabsContent>
          <TabsContent value="payrun" className="mt-0 outline-none">
            {tab === 'payrun' && (
              <GrossPayPeriodView
                periods={periods}
                periodStart={effectiveBounds.periodStart}
                periodEnd={effectiveBounds.periodEnd}
                employeeNames={employeeNames}
                isLoading={payRun.isLoading}
                error={payRun.error}
              />
            )}
          </TabsContent>
          <TabsContent value="rates" className="mt-0 outline-none">
            {tab === 'rates' && (canManageRates ? (
              <PayRatesSettings />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <Shield className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-[15px] font-semibold text-foreground">Not authorised</h3>
                <p className="max-w-sm text-[13px] text-muted-foreground">Pay-rate administration needs the configurations permission.</p>
              </div>
            ))}
          </TabsContent>
        </PageLayout.Body>
      </PageLayout>
    </Tabs>
  );
};

export default GrossPayPage;
