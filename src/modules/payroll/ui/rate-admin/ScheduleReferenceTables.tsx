/**
 * Read-only reference tables for the EBA pay structures that are NOT part of the
 * base Schedule-2 wage table: Schedule 5 (Trainees), Schedule 4 (Apprentices)
 * and Schedule 6 (Supported Wage System).
 *
 * These are surfaced so managers can see/audit every rate the cost engine
 * prices with — the numbers come straight from the engine's own source of truth
 * (trainee_matrix.ts / apprentice_matrix.ts), so the screen can never drift from
 * what is actually charged.
 */

import React from 'react';
import { GraduationCap, Wrench, HeartHandshake, Info } from 'lucide-react';
import type { TraineeRateSet } from '../../data/ebaRates.read.api';
import {
  APPRENTICE_MATRIX, SWS_CAPACITY_STEPS, SWS_MIN_WEEKLY,
} from '@/modules/rosters/domain/projections/utils/cost/apprentice_matrix';

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const EXPERIENCE = ['School leaver', '+1 yr out', '+2 yrs out', '+3 yrs out', '+4 yrs out', '+5 yrs out'];
const SCHOOL_YEARS = [10, 11, 12] as const;

const SectionHeader: React.FC<{ Icon: React.ElementType; title: string; sub: string }> = ({ Icon, title, sub }) => (
  <div className="flex items-center gap-2 mb-3">
    <Icon className="h-4 w-4 text-muted-foreground" />
    <div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  </div>
);

/** A schooling-year × experience matrix (weekly or hourly), formatted as money. */
const TraineeMatrixTable: React.FC<{
  title: string;
  matrix: Record<10 | 11 | 12, number[]>;
  suffix?: string;
}> = ({ title, matrix, suffix }) => (
  <div>
    <p className="text-xs font-medium text-foreground/80 mb-1.5">{title}</p>
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b border-border bg-muted/40">
            <th className="text-left font-medium py-1.5 px-3">Experience</th>
            {SCHOOL_YEARS.map((y) => (
              <th key={y} className="text-right font-medium py-1.5 px-3">Year {y}</th>
            ))}
          </tr>
        </thead>
        <tbody className="text-foreground/90">
          {EXPERIENCE.map((label, i) => (
            <tr key={label} className="border-b border-border/50 last:border-0">
              <td className="py-1.5 px-3">{label}</td>
              {SCHOOL_YEARS.map((y) => (
                <td key={y} className="text-right py-1.5 px-3 tabular-nums">
                  {money(matrix[y][i])}{suffix}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export const ScheduleReferenceTables: React.FC<{ traineeSet: TraineeRateSet }> = ({ traineeSet }) => {
  return (
    <div className="space-y-10">
      {/* ── Schedule 5 — Trainees ─────────────────────────────────────────── */}
      <section>
        <SectionHeader
          Icon={GraduationCap}
          title="Trainees (Schedule 5)"
          sub={`Training-contract wages · effective ${traineeSet.effectiveFrom} · gets CPI + 0.5% (cl 25.1)`}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <TraineeMatrixTable title="Full-time weekly — Wage Level A (cl 1.4.1)" matrix={traineeSet.weeklyLevelA} suffix="/wk" />
          <TraineeMatrixTable title="Full-time weekly — Wage Level B (cl 1.4.2)" matrix={traineeSet.weeklyLevelB} suffix="/wk" />
          <TraineeMatrixTable title="Part-time hourly — Wage Level A (cl 1.5.1)" matrix={traineeSet.hourlyLevelA} suffix="/hr" />
          <TraineeMatrixTable title="Part-time hourly — Wage Level B (cl 1.5.2)" matrix={traineeSet.hourlyLevelB} suffix="/hr" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-foreground/80">
            Adult Cert IV FT/wk — A: <span className="font-semibold tabular-nums">{money(traineeSet.adult.ftWeekly.A[0])} → {money(traineeSet.adult.ftWeekly.A[1])}</span>, B: <span className="font-semibold tabular-nums">{money(traineeSet.adult.ftWeekly.B[0])} → {money(traineeSet.adult.ftWeekly.B[1])}</span>
          </span>
          <span className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-foreground/80">
            Adult Cert IV PT/hr — A: <span className="font-semibold tabular-nums">{money(traineeSet.adult.ptHourly.A[0])} → {money(traineeSet.adult.ptHourly.A[1])}</span>, B: <span className="font-semibold tabular-nums">{money(traineeSet.adult.ptHourly.B[0])} → {money(traineeSet.adult.ptHourly.B[1])}</span>
          </span>
          <span className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-foreground/80">
            School-based/hr (cl 1.5.3) — Yr12: <span className="font-semibold tabular-nums">{money(traineeSet.schoolBasedHourly.yr12)}</span>, ≤Yr11: <span className="font-semibold tabular-nums">{money(traineeSet.schoolBasedHourly.other)}</span>
          </span>
          <span className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-foreground/80">
            AQF Cert IV uplift: <span className="font-semibold tabular-nums">+{traineeSet.certIvUpliftPct}%</span>
          </span>
        </div>
      </section>

      {/* ── Schedule 4 — Apprentices ──────────────────────────────────────── */}
      <section>
        <SectionHeader
          Icon={Wrench}
          title="Apprentices (Schedule 4)"
          sub="Percentage of the Level 4 rate · tracks CPI automatically via Level 4"
        />
        <div className="overflow-x-auto rounded-lg border border-border max-w-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border bg-muted/40">
                <th className="text-left font-medium py-1.5 px-3">Apprentice type</th>
                <th className="text-right font-medium py-1.5 px-3">Yr 1</th>
                <th className="text-right font-medium py-1.5 px-3">Yr 2</th>
                <th className="text-right font-medium py-1.5 px-3">Yr 3</th>
                <th className="text-right font-medium py-1.5 px-3">Yr 4</th>
              </tr>
            </thead>
            <tbody className="text-foreground/90 tabular-nums">
              <tr className="border-b border-border/50">
                <td className="py-1.5 px-3">Junior, no Year 12</td>
                {[1, 2, 3, 4].map((y) => <td key={y} className="text-right py-1.5 px-3">{pct((APPRENTICE_MATRIX.standard.no_yr12 as any)[y])}</td>)}
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-1.5 px-3">Junior, completed Year 12</td>
                {[1, 2, 3, 4].map((y) => <td key={y} className="text-right py-1.5 px-3">{pct((APPRENTICE_MATRIX.standard.yr12 as any)[y])}</td>)}
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-1.5 px-3">Adult</td>
                {[1, 2, 3, 4].map((y) => <td key={y} className="text-right py-1.5 px-3">{pct((APPRENTICE_MATRIX.adult as any)[y])}</td>)}
              </tr>
              <tr>
                <td className="py-1.5 px-3">School-based</td>
                {[1, 2, 3, 4].map((y) => <td key={y} className="text-right py-1.5 px-3">{(APPRENTICE_MATRIX.school_based as any)[y] != null ? pct((APPRENTICE_MATRIX.school_based as any)[y]) : '—'}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Schedule 6 — Supported Wage System ────────────────────────────── */}
      <section>
        <SectionHeader
          Icon={HeartHandshake}
          title="Supported Wage System (Schedule 6)"
          sub="Percentage of the relevant minimum wage · tracks CPI automatically"
        />
        <div className="flex flex-wrap gap-1.5">
          {SWS_CAPACITY_STEPS.map((s) => (
            <span key={s} className="rounded-lg border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground/80 tabular-nums">
              {s}% → {s}%
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-px flex-shrink-0" />
          Assessed capacity maps 1:1 to % of the relevant minimum wage (cl 1.4.1), with a
          hard floor of {money(SWS_MIN_WEEKLY)}/week (cl 1.4.2). The weekly floor is not yet
          enforced by the per-shift cost engine.
        </p>
      </section>
    </div>
  );
};

export default ScheduleReferenceTables;
