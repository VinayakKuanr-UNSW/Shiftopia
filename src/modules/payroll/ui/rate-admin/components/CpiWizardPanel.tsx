/**
 * CpiWizardPanel — multi-step CPI increase preview wizard.
 *
 * Replaces the old inline CPI form with a stepped experience:
 *   Step 1: Review current rates (compact summary)
 *   Step 2: Enter CPI % and effective date
 *   Step 3: Preview side-by-side current → projected with delta badges
 *   Step 4: Export SQL + TS snippets
 *
 * "Publish" is disabled (Phase 3). All projection logic reuses
 * cpiRateIncrease.ts unchanged.
 */

import React, { useMemo, useState } from 'react';
import {
  TrendingUp, ArrowRight, ArrowLeft, Check, Copy, Info,
  Database, Code2, Lock, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { toast } from '@/modules/core/ui/primitives/use-toast';
import { cn } from '@/modules/core/lib/utils';
import type { EbaRateSet, EbaRateRow, TraineeRateSet } from '../../../data/ebaRates.read.api';
import {
  projectCpiIncrease, toMigrationSql, toRateScheduleSnippet, cpiFactor,
  projectTraineeCpiIncrease, toTraineeMigrationSql, toTraineeSnippet,
} from '../../../domain/cpiRateIncrease';

const money = (n: number) => `$${n.toFixed(2)}`;

const CLASS_RANK: Record<string, number> = {
  TRAINEE: 0, LEVEL_1: 1, LEVEL_2: 2, LEVEL_3: 3, LEVEL_4: 4,
  LEVEL_5: 5, LEVEL_6: 6, LEVEL_7: 7,
  SECURITY_LEVEL_3: 8, SECURITY_LEVEL_4: 9, SECURITY_LEVEL_5: 10, SECURITY_LEVEL_6: 11,
};
const classLabel = (c: string) =>
  c.replace('SECURITY_LEVEL_', 'Security L').replace('LEVEL_', 'Level ').replace('TRAINEE', 'Trainee');

// ── step indicator ──────────────────────────────────────────────────────────

const STEPS = ['Current Rates', 'Enter CPI', 'Preview Changes', 'Export'] as const;

const StepIndicator: React.FC<{ current: number }> = ({ current }) => (
  <div className="flex items-center gap-2 mb-8" role="navigation" aria-label="CPI Wizard Steps Progress">
    {STEPS.map((label, i) => (
      <React.Fragment key={i}>
        <div className="flex items-center gap-3">
          <div className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold transition-all',
            i < current
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : i === current
                ? 'bg-primary/20 text-primary border border-primary/40 shadow-[0_0_8px_rgba(var(--primary),0.3)]'
                : 'bg-muted/40 text-muted-foreground border border-border/40',
          )}
          aria-current={i === current ? 'step' : undefined}
          >
            {i < current ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
          </div>
          <span className={cn(
            'text-sm font-semibold hidden md:inline',
            i === current ? 'text-foreground font-bold' : 'text-muted-foreground',
          )}>
            {label}
          </span>
        </div>
        {i < STEPS.length - 1 && (
          <div className={cn(
            'flex-1 h-px mx-3 min-w-[20px]',
            i < current ? 'bg-emerald-500/30' : 'bg-border/40',
          )} aria-hidden="true" />
        )}
      </React.Fragment>
    ))}
  </div>
);

// ── code block (reused from original) ────────────────────────────────────────

const CodeBlock: React.FC<{ title: string; code: string; Icon: React.ElementType }> = ({ title, code, Icon }) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lines = code.split('\n');
  const isLong = lines.length > 12;
  const displayCode = isLong && !expanded ? lines.slice(0, 12).join('\n') + '\n...' : code;

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
    <div className="rounded-xl border border-border bg-muted/40 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/60">
        <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" /> {title}
        </div>
        <div className="flex items-center gap-2">
          {isLong && (
            <Button size="xs" variant="ghost" onClick={() => setExpanded(!expanded)} className="gap-1 text-xs h-7">
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {expanded ? 'Collapse' : 'Expand'}
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={copy} className="gap-1.5 text-xs h-7">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <pre className="p-4 text-xs leading-relaxed overflow-x-auto text-foreground/80 font-mono whitespace-pre">
        {displayCode}
      </pre>
    </div>
  );
};

// ── compact rate summary for step 1 ──────────────────────────────────────────

function buildSummaryRows(set: EbaRateSet) {
  const m = new Map<string, { ordinary: number; permanent?: number; casual?: number; annualised?: number }>();
  for (const r of set.rates) {
    const e = m.get(r.classification) ?? { ordinary: 0 };
    if (r.employmentBasis === 'permanent') {
      e.ordinary = r.ordinaryHourlyRate;
      e.permanent = r.paidHourlyRate;
    } else if (r.employmentBasis === 'casual') {
      e.casual = r.paidHourlyRate;
    } else {
      // annualised (security, Schedule 3) — no FT/PT or casual base. Surface the
      // ordinary rate so the row isn't rendered as $0.00, and keep the annualised
      // salary for the preview delta.
      e.annualised = r.paidHourlyRate;
      if (!e.ordinary) e.ordinary = r.ordinaryHourlyRate;
    }
    m.set(r.classification, e);
  }
  return [...m.entries()]
    .sort((a, b) => (CLASS_RANK[a[0]] ?? 99) - (CLASS_RANK[b[0]] ?? 99));
}

// ── main wizard ──────────────────────────────────────────────────────────────

interface CpiWizardPanelProps {
  schedule: EbaRateSet[];
  traineeSchedule: TraineeRateSet[];
}

const CpiWizardPanel: React.FC<CpiWizardPanelProps> = ({ schedule, traineeSchedule }) => {
  const latest = schedule[schedule.length - 1];
  const latestTrainee = traineeSchedule[traineeSchedule.length - 1];
  const [step, setStep] = useState(0);
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

  const baseSummary = buildSummaryRows(latest);

  const canNext = step === 0
    ? true
    : step === 1
      ? valid
      : step === 2
        ? !!projection
        : false;

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-6 space-y-6 shadow-sm">
      <div className="flex items-center gap-2.5">
        <TrendingUp className="h-6 w-6 text-primary" aria-hidden="true" />
        <h3 className="text-xl font-bold text-foreground">CPI Increase Preview</h3>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground ml-3 bg-muted px-2.5 py-0.5 rounded-full border border-border/40">cl 25.1 — CPI + 0.5%</span>
      </div>

      <StepIndicator current={step} />

      {/* Step 0: Current Rates */}
      {step === 0 && (
        <div className="space-y-4" role="tabpanel" aria-label="Step 1 of 4: Review Current Rates">
          <p className="text-base text-muted-foreground font-medium">
            Review the current rate set (effective <span className="font-bold text-foreground">{latest.effectiveFrom}</span>) before applying a CPI increase.
          </p>
          <div className="rounded-lg border border-border/40 overflow-hidden bg-muted/10">
            <table className="w-full text-sm" aria-label="Current base rates breakdown">
              <thead>
                <tr className="text-muted-foreground border-b border-border bg-muted/30">
                  <th scope="col" className="text-left font-bold py-3 px-4 text-xs uppercase tracking-wider">Classification</th>
                  <th scope="col" className="text-right font-bold py-3 px-4 text-xs uppercase tracking-wider">Ordinary</th>
                  <th scope="col" className="text-right font-bold py-3 px-4 text-xs uppercase tracking-wider">FT/PT</th>
                  <th scope="col" className="text-right font-bold py-3 px-4 text-xs uppercase tracking-wider">Casual</th>
                </tr>
              </thead>
              <tbody className="text-foreground font-semibold">
                {baseSummary.map(([cls, v]) => (
                  <tr key={cls} className="border-b border-border/30 last:border-0 hover:bg-muted/15 transition-colors">
                    <td className="py-3 px-4 font-bold text-foreground">{classLabel(cls)}</td>
                    <td className="text-right py-3 px-4 tabular-nums text-muted-foreground font-medium">{money(v.ordinary)}</td>
                    <td className="text-right py-3 px-4 tabular-nums">{v.permanent != null ? money(v.permanent) : '—'}</td>
                    <td className="text-right py-3 px-4 tabular-nums">{v.casual != null ? money(v.casual) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 1: Enter CPI */}
      {step === 1 && (
        <div className="space-y-6" role="tabpanel" aria-label="Step 2 of 4: Enter CPI details">
          <p className="text-base text-muted-foreground font-medium">
            Enter the ABS All-Groups CPI (Sydney, March-quarter YoY %) and the effective date for the new rate set.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
            <div className="space-y-2.5">
              <Label htmlFor="cpi-percentage-input" className="text-sm font-bold text-muted-foreground">ABS All-Groups CPI (March-qtr YoY %)</Label>
              <Input
                id="cpi-percentage-input"
                type="number" step="0.1" min="0" inputMode="decimal"
                placeholder="e.g. 3.6"
                value={cpi} onChange={(e) => setCpi(e.target.value)}
                className="text-xl font-bold h-11"
                aria-required="true"
              />
            </div>
            <div className="space-y-2.5">
              <Label htmlFor="effective-date-input" className="text-sm font-bold text-muted-foreground">Effective from (first pay period on/after)</Label>
              <Input 
                id="effective-date-input"
                type="date" 
                value={effectiveFrom} 
                onChange={(e) => setEffectiveFrom(e.target.value)} 
                className="h-11 text-sm font-medium"
                aria-required="true"
              />
            </div>
          </div>

          {cpi.trim() !== '' && valid && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-5 py-4 max-w-2xl shadow-sm">
              <p className="text-base text-foreground font-medium">
                Multiplier: <span className="font-extrabold tabular-nums text-primary">×{cpiFactor(cpiNum).toFixed(4)}</span>
                <span className="text-muted-foreground ml-3">({cpiNum}% + 0.5% EBA uplift)</span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 2 && projection && (
        <div className="space-y-6" role="tabpanel" aria-label="Step 3 of 4: Preview Changes">
          <p className="text-base text-muted-foreground font-medium">
            Compare current rates against the projected increase. All values rounded to cents independently.
          </p>

          <div className="rounded-lg border border-border/40 overflow-hidden bg-muted/10">
            <table className="w-full text-sm" aria-label="Comparison table of current rates versus new projected rates">
              <thead>
                <tr className="text-muted-foreground border-b border-border bg-muted/30">
                  <th scope="col" className="text-left font-bold py-3 px-4 text-xs uppercase tracking-wider">Classification</th>
                  <th scope="col" className="text-right font-bold py-3 px-4 text-xs uppercase tracking-wider">Current Rate</th>
                  <th scope="col" className="text-center font-bold py-3 px-4 text-xs uppercase tracking-wider" aria-label="Transition arrow"></th>
                  <th scope="col" className="text-right font-bold py-3 px-4 text-xs uppercase tracking-wider">New Rate</th>
                  <th scope="col" className="text-right font-bold py-3 px-4 text-xs uppercase tracking-wider">Projected Change</th>
                </tr>
              </thead>
              <tbody className="text-foreground font-semibold">
                {baseSummary.map(([cls, current]) => {
                  // Security classifications have no 'permanent' basis — they are
                  // salaried on the annualised (Schedule 3) rate, which also gets
                  // the CPI uplift. Compare against whichever base the row carries.
                  const newRate = projection.rates.find(
                    (r) => r.classification === cls
                      && (r.employmentBasis === 'permanent' || r.employmentBasis === 'annualised'),
                  );
                  const compareRate = current.permanent ?? current.annualised;
                  const delta = newRate && compareRate
                    ? ((newRate.paidHourlyRate / compareRate - 1) * 100).toFixed(1)
                    : null;
                  return (
                    <tr key={cls} className="border-b border-border/30 last:border-0 hover:bg-muted/15 transition-colors">
                      <td className="py-3 px-4 font-bold text-foreground">{classLabel(cls)}</td>
                      <td className="text-right py-3 px-4 tabular-nums text-muted-foreground font-medium">
                        {compareRate != null ? money(compareRate) : money(current.ordinary)}
                      </td>
                      <td className="text-center py-3 px-4 text-muted-foreground" aria-hidden="true">→</td>
                      <td className="text-right py-3 px-4 tabular-nums font-extrabold text-foreground text-sm">
                        {newRate ? money(newRate.paidHourlyRate) : '—'}
                      </td>
                      <td className="text-right py-3 px-4">
                        {delta && (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 text-xs font-bold text-emerald-400">
                            +{delta}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3.5 max-w-4xl">
            <Info className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <p className="text-sm text-amber-400/90 leading-relaxed font-semibold">
              cl 25.3: confirm the new rates stay ≥ 2% above the Amusement, Events &amp; Recreation Award before applying.
            </p>
          </div>
        </div>
      )}

      {/* Step 3: Export */}
      {step === 3 && projection && (
        <div className="space-y-6" role="tabpanel" aria-label="Step 4 of 4: Export Migration SQL and Snippets">
          <p className="text-base text-muted-foreground font-medium">
            Copy the migration SQL and TS snippet below. Apply both to keep the DB and cost engine in sync.
          </p>

          <div className="space-y-4">
            <div>
              <p className="text-sm font-bold text-foreground/80 mb-2">Schedule 2 — base classifications &amp; allowances</p>
              <div className="space-y-4">
                <CodeBlock title="Migration SQL (eba_rate + eba_allowance)" code={toMigrationSql(projection)} Icon={Database} />
                <CodeBlock title="RATE_SCHEDULE snippet (embedded cost engine)" code={toRateScheduleSnippet(projection, schedule.length - 1)} Icon={Code2} />
              </div>
            </div>

            {traineeProjection && (
              <div className="pt-2">
                <p className="text-sm font-bold text-foreground/80 mb-2">Schedule 5 — trainees (same increase applied)</p>
                <div className="space-y-4">
                  <CodeBlock title="Migration SQL (eba_trainee_schedule)" code={toTraineeMigrationSql(traineeProjection)} Icon={Database} />
                  <CodeBlock title="TRAINEE_RATE_SCHEDULE snippet (embedded cost engine)" code={toTraineeSnippet(traineeProjection, cpiNum, traineeSchedule.length - 1)} Icon={Code2} />
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground leading-relaxed font-semibold">
              Apprentice (Schedule 4) and Supported-Wage (Schedule 6) rates are percentages of a
              base that already gets this increase, so they need no separate change.
            </p>
          </div>

          {/* Publish placeholder */}
          <div 
            className="rounded-xl border border-border/40 bg-muted/30 p-5 flex items-start gap-4"
            role="note"
            aria-label=" Direct publish details"
          >
            <Lock className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-foreground">Direct publish coming in Phase 3</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed font-medium">
                For now, copy the SQL migration and TS snippet above. An engineer applies both to keep the DB and cost engine in sync.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border/40">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="gap-2 text-sm h-10 font-bold"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>

        {step < STEPS.length - 1 ? (
          <Button
            size="sm"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext}
            className="gap-2 text-sm h-10 font-bold px-4"
          >
            Next
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button 
            size="sm" 
            variant="ghost" 
            onClick={() => { setStep(0); setCpi(''); setEffectiveFrom(''); }} 
            className="gap-2 text-sm h-10 font-bold"
          >
            Start Over
          </Button>
        )}
      </div>
    </div>
  );
};

export default CpiWizardPanel;
