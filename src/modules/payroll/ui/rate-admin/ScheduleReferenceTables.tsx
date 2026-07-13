/**
 * Read-only reference tables for Schedule 5 (Trainees) — the training-contract
 * wage matrices that are NOT part of the base Schedule-2 wage table.
 *
 * Apprentices (Schedule 4) and the Supported Wage System (Schedule 6) are owned
 * by <ApprenticeCards/> on the same tab, so they are intentionally NOT rendered
 * here (they used to be, which duplicated both sections).
 *
 * The numbers come straight from the cost engine's own source of truth
 * (trainee_matrix.ts), so the screen can never drift from what is actually
 * charged.
 */

import React from 'react';
import { GraduationCap } from 'lucide-react';
import type { TraineeRateSet } from '../../data/ebaRates.read.api';

const money = (n: number) => `$${n.toFixed(2)}`;
const EXPERIENCE = ['School leaver', '+1 yr out', '+2 yrs out', '+3 yrs out', '+4 yrs out', '+5 yrs out'];
const SCHOOL_YEARS = [10, 11, 12] as const;

const SectionHeader: React.FC<{ Icon: React.ElementType; title: string; sub: string }> = ({ Icon, title, sub }) => (
  <div className="flex items-center gap-3 mb-4">
    <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
    <div>
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">{sub}</p>
    </div>
  </div>
);

/** A schooling-year × experience matrix (weekly or hourly), formatted as money. */
const TraineeMatrixTable: React.FC<{
  title: string;
  matrix: Record<10 | 11 | 12, number[]>;
  suffix?: string;
}> = ({ title, matrix, suffix }) => (
  <div className="space-y-2">
    <p className="text-sm font-bold text-foreground/80">{title}</p>
    <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
      <table className="w-full text-sm" aria-label={title}>
        <thead>
          <tr className="text-muted-foreground border-b border-border bg-muted/40">
            <th scope="col" className="text-left font-bold py-3 px-4">Experience</th>
            {SCHOOL_YEARS.map((y) => (
              <th scope="col" key={y} className="text-right font-bold py-3 px-4">Year {y}</th>
            ))}
          </tr>
        </thead>
        <tbody className="text-foreground font-semibold">
          {EXPERIENCE.map((label, i) => (
            <tr key={label} className="border-b border-border/50 last:border-0 hover:bg-muted/10 transition-colors">
              <td className="py-3 px-4 font-medium">{label}</td>
              {SCHOOL_YEARS.map((y) => (
                <td key={y} className="text-right py-3 px-4 tabular-nums text-muted-foreground font-medium">
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
      <section role="region" aria-label="Trainees wage schedule matrix">
        <SectionHeader
          Icon={GraduationCap}
          title="Trainees (Schedule 5)"
          sub={`Training-contract wages · effective ${traineeSet.effectiveFrom} · gets CPI + 0.5% (cl 25.1)`}
        />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <TraineeMatrixTable title="Full-time weekly — Wage Level A (cl 1.4.1)" matrix={traineeSet.weeklyLevelA} suffix="/wk" />
          <TraineeMatrixTable title="Full-time weekly — Wage Level B (cl 1.4.2)" matrix={traineeSet.weeklyLevelB} suffix="/wk" />
          <TraineeMatrixTable title="Part-time hourly — Wage Level A (cl 1.5.1)" matrix={traineeSet.hourlyLevelA} suffix="/hr" />
          <TraineeMatrixTable title="Part-time hourly — Wage Level B (cl 1.5.2)" matrix={traineeSet.hourlyLevelB} suffix="/hr" />
        </div>
        <div className="mt-6 flex flex-wrap gap-3 text-sm font-semibold" role="list" aria-label="Trainee wage conditions">
          <span role="listitem" className="rounded-lg border border-border bg-muted/40 px-3.5 py-1.5 text-foreground/80">
            Adult Cert IV FT/wk — A: <span className="font-extrabold tabular-nums text-foreground">{money(traineeSet.adult.ftWeekly.A[0])} → {money(traineeSet.adult.ftWeekly.A[1])}</span>, B: <span className="font-extrabold tabular-nums text-foreground">{money(traineeSet.adult.ftWeekly.B[0])} → {money(traineeSet.adult.ftWeekly.B[1])}</span>
          </span>
          <span role="listitem" className="rounded-lg border border-border bg-muted/40 px-3.5 py-1.5 text-foreground/80">
            Adult Cert IV PT/hr — A: <span className="font-extrabold tabular-nums text-foreground">{money(traineeSet.adult.ptHourly.A[0])} → {money(traineeSet.adult.ptHourly.A[1])}</span>, B: <span className="font-extrabold tabular-nums text-foreground">{money(traineeSet.adult.ptHourly.B[0])} → {money(traineeSet.adult.ptHourly.B[1])}</span>
          </span>
          <span role="listitem" className="rounded-lg border border-border bg-muted/40 px-3.5 py-1.5 text-foreground/80">
            School-based/hr (cl 1.5.3) — Yr12: <span className="font-extrabold tabular-nums text-foreground">{money(traineeSet.schoolBasedHourly.yr12)}</span>, ≤Yr11: <span className="font-extrabold tabular-nums text-foreground">{money(traineeSet.schoolBasedHourly.other)}</span>
          </span>
          <span role="listitem" className="rounded-lg border border-border bg-muted/40 px-3.5 py-1.5 text-foreground/80">
            AQF Cert IV uplift: <span className="font-extrabold tabular-nums text-primary">+{traineeSet.certIvUpliftPct}%</span>
          </span>
        </div>
      </section>
    </div>
  );
};

export default ScheduleReferenceTables;
