/**
 * PayRatesSettings — Phase-2 EBA rate admin (Settings › Pay Rates).
 *
 * A READ + PREVIEW surface for the effective-dated ICC Sydney EA 2025 wage /
 * allowance schedule (cl 25 CPI machinery). It does three things:
 *   1. Views the effective-dated schedule from the DB (eba_rate/eba_allowance).
 *   2. Resolves which rate set applies on a chosen date.
 *   3. Previews an annual CPI + 0.5% increase (cl 25.1) and emits the migration
 *      SQL + the RATE_SCHEDULE TS snippet an engineer applies to BOTH copies.
 *
 * It deliberately does NOT write rates: the worker cost engine reads an embedded
 * TS copy it can't hydrate from the DB, and RLS denies authenticated writes — so
 * a direct write would be denied and/or drift from the engine. Making the DB the
 * single writable source is the explicit Phase-3 milestone.
 */

import React, { useMemo, useState } from 'react';
import {
  Loader2, Copy, Check, Info, TrendingUp, Calendar, Database, Code2,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { toast } from '@/modules/core/ui/primitives/use-toast';
import { cn } from '@/modules/core/lib/utils';
import { useEbaRates, useTraineeRates } from '../../state/useEbaRates';
import { resolveEbaRateSetOnDate, type EbaRateSet, type TraineeRateSet } from '../../data/ebaRates.read.api';
import {
  projectCpiIncrease, toMigrationSql, toRateScheduleSnippet, cpiFactor,
  projectTraineeCpiIncrease, toTraineeMigrationSql, toTraineeSnippet,
} from '../../domain/cpiRateIncrease';
import { resolveTraineeRateSet } from '@/modules/rosters/domain/projections/utils/cost/trainee_matrix';
import { ScheduleReferenceTables } from './ScheduleReferenceTables';

// ── helpers ──────────────────────────────────────────────────────────────────
const money = (n: number) => `$${n.toFixed(2)}`;
const today = () => new Date().toISOString().split('T')[0];

/** Stable, human classification order for the rate tables. */
const CLASS_RANK: Record<string, number> = {
  TRAINEE: 0, LEVEL_1: 1, LEVEL_2: 2, LEVEL_3: 3, LEVEL_4: 4, LEVEL_5: 5, LEVEL_6: 6, LEVEL_7: 7,
  SECURITY_LEVEL_3: 8, SECURITY_LEVEL_4: 9, SECURITY_LEVEL_5: 10, SECURITY_LEVEL_6: 11,
};
const classLabel = (c: string) =>
  c.replace('SECURITY_LEVEL_', 'Security L').replace('LEVEL_', 'Level ').replace('TRAINEE', 'Trainee');
const ALLOWANCE_LABEL: Record<string, string> = {
  meal: 'Meal (cl 28.1)', first_aid_per_hour: 'First aid (cl 28.2)',
  protein_spill: 'Protein spill (cl 28.3)', split_shift: 'Split shift (cl 28.4)',
};

// ── copy-to-clipboard code block ─────────────────────────────────────────────
const CodeBlock: React.FC<{ title: string; code: string; Icon: React.ElementType }> = ({ title, code, Icon }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: `${title} copied to clipboard` });
    } catch {
      toast({ title: 'Copy failed', description: 'Select the text and copy manually.', variant: 'destructive' });
    }
  };
  return (
    <div className="rounded-xl border border-border bg-muted/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/60">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {title}
        </div>
        <Button size="xs" variant="ghost" onClick={copy} className="gap-1.5">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="p-3 text-[11px] leading-relaxed overflow-x-auto text-foreground/80 font-mono whitespace-pre">{code}</pre>
    </div>
  );
};

// ── one effective-dated rate set ─────────────────────────────────────────────
const RateSetCard: React.FC<{ set: EbaRateSet; inForce: boolean }> = ({ set, inForce }) => {
  const rates = useMemo(
    () => [...set.rates].sort((a, b) => (CLASS_RANK[a.classification] ?? 99) - (CLASS_RANK[b.classification] ?? 99)),
    [set.rates],
  );
  // Collapse permanent+casual rows for a classification into one display row.
  const byClass = useMemo(() => {
    const m = new Map<string, { ordinary?: number; permanent?: number; casual?: number; annualised?: number; annOrdinary?: number }>();
    for (const r of rates) {
      const e = m.get(r.classification) ?? {};
      if (r.employmentBasis === 'permanent') { e.permanent = r.paidHourlyRate; e.ordinary = r.ordinaryHourlyRate; }
      else if (r.employmentBasis === 'casual') { e.casual = r.paidHourlyRate; }
      else { e.annualised = r.paidHourlyRate; e.annOrdinary = r.ordinaryHourlyRate; }
      m.set(r.classification, e);
    }
    return [...m.entries()].sort((a, b) => (CLASS_RANK[a[0]] ?? 99) - (CLASS_RANK[b[0]] ?? 99));
  }, [rates]);

  return (
    <div className={cn(
      'rounded-2xl border p-5 transition-all',
      inForce ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
    )}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Effective {set.effectiveFrom}</span>
        </div>
        {inForce && (
          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            In force today
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left font-medium py-1.5 pr-4">Classification</th>
              <th className="text-right font-medium py-1.5 px-3">Ordinary</th>
              <th className="text-right font-medium py-1.5 px-3">Permanent</th>
              <th className="text-right font-medium py-1.5 px-3">Casual</th>
              <th className="text-right font-medium py-1.5 pl-3">Annualised</th>
            </tr>
          </thead>
          <tbody className="text-foreground/90">
            {byClass.map(([cls, e]) => (
              <tr key={cls} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 pr-4 font-medium">{classLabel(cls)}</td>
                <td className="text-right py-1.5 px-3 tabular-nums text-muted-foreground">{money(e.ordinary ?? e.annOrdinary ?? 0)}</td>
                <td className="text-right py-1.5 px-3 tabular-nums">{e.permanent != null ? money(e.permanent) : '—'}</td>
                <td className="text-right py-1.5 px-3 tabular-nums">{e.casual != null ? money(e.casual) : '—'}</td>
                <td className="text-right py-1.5 pl-3 tabular-nums">{e.annualised != null ? money(e.annualised) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {set.allowances.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {[...set.allowances].sort((a, b) => a.code.localeCompare(b.code)).map((a) => (
            <span key={a.code} className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-foreground/80">
              {ALLOWANCE_LABEL[a.code] ?? a.code}: <span className="font-semibold tabular-nums">{money(a.amount)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ── CPI increase preview / export ────────────────────────────────────────────
const CpiPreviewPanel: React.FC<{ schedule: EbaRateSet[]; traineeSchedule: TraineeRateSet[] }> = ({ schedule, traineeSchedule }) => {
  const latest = schedule[schedule.length - 1];
  const latestTrainee = traineeSchedule[traineeSchedule.length - 1];
  const [cpi, setCpi] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');

  const cpiNum = Number(cpi);
  const valid = cpi.trim() !== '' && Number.isFinite(cpiNum) && cpiNum >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom);

  const projection = useMemo(() => {
    if (!valid || !latest) return null;
    return projectCpiIncrease({ base: latest, cpiPercent: cpiNum, effectiveFrom });
  }, [valid, latest, cpiNum, effectiveFrom]);

  const traineeProjection = useMemo(() => {
    if (!valid || !latestTrainee) return null;
    return projectTraineeCpiIncrease(latestTrainee, cpiNum, effectiveFrom);
  }, [valid, latestTrainee, cpiNum, effectiveFrom]);

  if (!latest) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold text-foreground">Preview an annual CPI increase (cl 25.1)</h4>
      </div>
      <p className="text-xs text-muted-foreground">
        Applies <span className="font-medium text-foreground">CPI% + 0.5%</span> to the latest set
        (effective {latest.effectiveFrom}) and generates the migration SQL and the RATE_SCHEDULE snippet.
        Nothing is written — apply both to keep the DB and the cost engine in sync.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">ABS All-Groups CPI, Sydney (March-qtr YoY %)</Label>
          <Input
            type="number" step="0.1" min="0" inputMode="decimal" placeholder="e.g. 3.6"
            value={cpi} onChange={(e) => setCpi(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Effective from (first pay period on/after)</Label>
          <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </div>
      </div>

      {cpi.trim() !== '' && valid && (
        <p className="text-xs text-muted-foreground">
          Multiplier: <span className="font-semibold text-foreground tabular-nums">×{cpiFactor(cpiNum).toFixed(4)}</span>
          {' '}({cpiNum}% + 0.5%)
        </p>
      )}

      {projection && (
        <div className="space-y-4 pt-1">
          <RateSetCard set={{ effectiveFrom: projection.effectiveFrom, rates: projection.rates, allowances: projection.allowances }} inForce={false} />
          <p className="text-xs font-medium text-foreground/80">Schedule 2 — base classifications &amp; allowances</p>
          <CodeBlock title="Migration SQL (eba_rate + eba_allowance)" code={toMigrationSql(projection)} Icon={Database} />
          <CodeBlock title="RATE_SCHEDULE snippet (embedded cost engine)" code={toRateScheduleSnippet(projection, schedule.length - 1)} Icon={Code2} />
          {traineeProjection && (
            <>
              <p className="text-xs font-medium text-foreground/80 pt-1">Schedule 5 — trainees (same increase applied)</p>
              <CodeBlock title="Migration SQL (eba_trainee_schedule)" code={toTraineeMigrationSql(traineeProjection)} Icon={Database} />
              <CodeBlock title="TRAINEE_RATE_SCHEDULE snippet (embedded cost engine)" code={toTraineeSnippet(traineeProjection, cpiNum, traineeSchedule.length - 1)} Icon={Code2} />
            </>
          )}
          <p className="text-[11px] text-muted-foreground">
            Apprentice (Schedule 4) and Supported-Wage (Schedule 6) rates are percentages of a
            base that already gets this increase, so they need no separate change.
          </p>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-px flex-shrink-0" />
            cl 25.3: confirm the new rates stay ≥ 2% above the Amusement, Events &amp; Recreation Award before applying.
          </p>
        </div>
      )}
    </div>
  );
};

// ── main ─────────────────────────────────────────────────────────────────────
export const PayRatesSettings: React.FC = () => {
  const { schedule, isLoading, error } = useEbaRates();
  const { schedule: traineeSchedule } = useTraineeRates();
  const [resolveDate, setResolveDate] = useState(today());

  const applicable = useMemo(
    () => resolveEbaRateSetOnDate(schedule, resolveDate),
    [schedule, resolveDate],
  );
  const inForceToday = useMemo(() => resolveEbaRateSetOnDate(schedule, today()), [schedule]);
  // In-force trainee set for the reference tables (falls back to embedded baseline).
  const traineeInForce = useMemo(
    () => resolveTraineeRateSet(today(), traineeSchedule.length ? traineeSchedule : undefined),
    [traineeSchedule],
  );

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
    <div className="space-y-8 max-w-4xl">
      {/* Architecture note */}
      <div className="rounded-xl border border-border bg-muted/40 p-4 flex items-start gap-3">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          These are the durable, effective-dated ICC Sydney EA 2025 wage &amp; allowance rates
          (<span className="font-medium text-foreground">eba_rate</span> / <span className="font-medium text-foreground">eba_allowance</span>).
          The roster cost engine reads an embedded copy of them, so this screen is read-only — use the CPI
          preview below to generate the changes an engineer applies to both the database and the engine.
        </p>
      </div>

      {/* Rate-on-date resolver */}
      <div>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">Effective-dated schedule</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{schedule.length} rate {schedule.length === 1 ? 'set' : 'sets'} on record.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Which rates apply on…</Label>
            <Input type="date" value={resolveDate} onChange={(e) => setResolveDate(e.target.value)} className="w-[180px]" />
          </div>
        </div>
        {applicable && (
          <p className="text-xs text-muted-foreground mb-4">
            On <span className="font-medium text-foreground">{resolveDate}</span> the set effective{' '}
            <span className="font-medium text-foreground">{applicable.effectiveFrom}</span> applies.
          </p>
        )}
        <div className="space-y-4">
          {[...schedule].reverse().map((set) => (
            <RateSetCard key={set.effectiveFrom} set={set} inForce={set.effectiveFrom === inForceToday?.effectiveFrom} />
          ))}
        </div>
      </div>

      {/* Schedule 4/5/6 reference tables */}
      <ScheduleReferenceTables traineeSet={traineeInForce} />

      {/* CPI preview */}
      <CpiPreviewPanel schedule={schedule} traineeSchedule={traineeSchedule.length ? traineeSchedule : [traineeInForce]} />
    </div>
  );
};

export default PayRatesSettings;
