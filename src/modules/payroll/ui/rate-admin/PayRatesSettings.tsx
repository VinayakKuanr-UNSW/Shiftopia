/**
 * PayRatesSettings — Phase-2 EBA rate admin (Settings › Pay Rates).
 *
 * OVERHAULED: now a tabbed pay rates & award management module rather than a
 * flat configuration screen. The tabs are:
 *   - Overview: dashboard header + warnings + health + version timeline
 *   - Base Rates: enhanced searchable table with detail drawer
 *   - Allowances: card-based allowance display
 *   - Apprentices & Trainees: visual cards + reference matrices
 *   - CPI & Versions: multi-step CPI wizard + timeline
 *   - Settings: date resolver + architecture note (original features)
 *
 * Still READ-ONLY (Phase 2) — the CPI wizard emits SQL + TS but never writes.
 */

import React, { useMemo, useState } from 'react';
import {
  Loader2, Database, Info, Calendar,
} from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/modules/core/ui/primitives/tabs';
import { cn } from '@/modules/core/lib/utils';
import { useEbaRates, useTraineeRates } from '../../state/useEbaRates';
import { resolveEbaRateSetOnDate } from '../../data/ebaRates.read.api';
import { resolveTraineeRateSet } from '@/modules/rosters/domain/projections/utils/cost/trainee_matrix';

// Sub-components
import AwardDashboardHeader from './components/AwardDashboardHeader';
import AwardHealthPanel from './components/AwardHealthPanel';
import VersionTimeline from './components/VersionTimeline';
import BaseRatesSection from './components/BaseRatesSection';
import AllowancesSection from './components/AllowancesSection';
import ApprenticeCards from './components/ApprenticeCards';
import { ScheduleReferenceTables } from './ScheduleReferenceTables';
import CpiWizardPanel from './components/CpiWizardPanel';

// ── helpers ──────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0];

// ── sub-tab definitions ─────────────────────────────────────────────────────

const SUB_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'base-rates', label: 'Base Rates' },
  { id: 'allowances', label: 'Allowances' },
  { id: 'apprentices', label: 'Apprentices & Trainees' },
  { id: 'cpi', label: 'CPI & Versions' },
  { id: 'settings', label: 'Settings' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

// ── main ─────────────────────────────────────────────────────────────────────
export const PayRatesSettings: React.FC = () => {
  const { schedule, isLoading, error } = useEbaRates();
  const { schedule: traineeSchedule } = useTraineeRates();
  const [activeTab, setActiveTab] = useState<SubTab>('overview');
  const [resolveDate, setResolveDate] = useState(today());
  // Version selected from a VersionTimeline node (null = show the in-force set).
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

  const inForceToday = useMemo(() => resolveEbaRateSetOnDate(schedule, today()), [schedule]);
  const applicable = useMemo(
    () => resolveEbaRateSetOnDate(schedule, resolveDate),
    [schedule, resolveDate],
  );
  const traineeInForce = useMemo(
    () => resolveTraineeRateSet(today(), traineeSchedule.length ? traineeSchedule : undefined),
    [traineeSchedule],
  );

  // The rate set shown on the Base Rates tab: the one selected in the timeline
  // (by effective date), falling back to whatever is in force today.
  const baseRatesSet = useMemo(() => {
    const picked = selectedVersion
      ? schedule.find((s) => s.effectiveFrom === selectedVersion)
      : undefined;
    return picked ?? inForceToday;
  }, [selectedVersion, schedule, inForceToday]);

  const showVersion = (effectiveFrom: string) => {
    setSelectedVersion(effectiveFrom);
    setActiveTab('base-rates');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || schedule.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
        <div className="p-4 rounded-full bg-muted border border-border">
          <Database className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-foreground">No rate schedule found</h3>
          <p className="text-sm text-muted-foreground max-w-md mt-1">
            {error
              ? 'The EBA rate tables could not be read.'
              : 'The eba_rate / eba_allowance tables have no rows. Seed them via the Phase-2 migration.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SubTab)}>
        {/* Tab navigation */}
        <TabsList 
          className="bg-muted/30 border border-border/40 p-1.5 rounded-xl flex-wrap h-auto gap-1"
          aria-label="Pay rates and award management sections"
        >
          {SUB_TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-semibold transition-all',
                'data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-none',
              )}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Overview ──────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-8 space-y-8">
          <AwardDashboardHeader schedule={schedule} inForce={inForceToday} />

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-8">
              <AwardHealthPanel schedule={schedule} />
            </div>
            <div className="xl:col-span-1">
              <VersionTimeline
                schedule={schedule}
                inForceFrom={inForceToday?.effectiveFrom ?? null}
                onSelectVersion={showVersion}
              />
            </div>
          </div>
        </TabsContent>

        {/* ── Base Rates ────────────────────────────────────────────────── */}
        <TabsContent value="base-rates" className="mt-8">
          {baseRatesSet && (
            <BaseRatesSection
              rateSet={baseRatesSet}
              isActive={baseRatesSet.effectiveFrom === inForceToday?.effectiveFrom}
            />
          )}
        </TabsContent>

        {/* ── Allowances ────────────────────────────────────────────────── */}
        <TabsContent value="allowances" className="mt-8">
          {inForceToday && (
            <AllowancesSection
              allowances={inForceToday.allowances}
              effectiveFrom={inForceToday.effectiveFrom}
            />
          )}
        </TabsContent>

        {/* ── Apprentices & Trainees ────────────────────────────────────── */}
        <TabsContent value="apprentices" className="mt-8 space-y-10">
          <ApprenticeCards />

          {/* Detailed trainee matrices */}
          <div className="pt-8 border-t border-border/40">
            <h3 className="text-lg font-bold text-foreground mb-6">
              Detailed Trainee Matrices (Schedule 5)
            </h3>
            <ScheduleReferenceTables traineeSet={traineeInForce} />
          </div>
        </TabsContent>

        {/* ── CPI & Versions ────────────────────────────────────────────── */}
        <TabsContent value="cpi" className="mt-8 space-y-8">
          <CpiWizardPanel
            schedule={schedule}
            traineeSchedule={traineeSchedule.length ? traineeSchedule : [traineeInForce]}
          />

          <VersionTimeline
            schedule={schedule}
            inForceFrom={inForceToday?.effectiveFrom ?? null}
            onSelectVersion={showVersion}
          />
        </TabsContent>

        {/* ── Settings ──────────────────────────────────────────────────── */}
        <TabsContent value="settings" className="mt-8 space-y-8">
          {/* Architecture note */}
          <div 
            className="rounded-xl border border-border bg-muted/40 p-5 flex items-start gap-4"
            role="note"
            aria-label="Database architecture note"
          >
            <Info className="h-5 w-5 mt-0.5 flex-shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              These are the durable, effective-dated ICC Sydney EA 2025 wage &amp; allowance rates
              (<span className="font-semibold text-foreground">eba_rate</span> / <span className="font-semibold text-foreground">eba_allowance</span>).
              The roster cost engine reads an embedded copy of them, so this screen is read-only — use the CPI
              preview to generate the changes an engineer applies to both the database and the engine.
            </p>
          </div>

          {/* Rate-on-date resolver */}
          <div className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-6">
            <div className="flex flex-wrap items-end justify-between gap-6 mb-6">
              <div>
                <h3 className="text-base font-bold text-foreground">Rate Date Resolver</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {schedule.length} rate {schedule.length === 1 ? 'set' : 'sets'} on record.
                  Check which rates apply on a specific date.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="resolve-date-input" className="text-sm font-semibold text-muted-foreground">Which rates apply on…</Label>
                <Input
                  id="resolve-date-input"
                  type="date"
                  value={resolveDate}
                  onChange={(e) => setResolveDate(e.target.value)}
                  className="w-[180px]"
                />
              </div>
            </div>
            {applicable && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
                <p className="text-sm text-foreground">
                  On <span className="font-semibold">{resolveDate}</span>, the set effective{' '}
                  <span className="font-semibold text-primary">{applicable.effectiveFrom}</span> applies.
                </p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PayRatesSettings;
