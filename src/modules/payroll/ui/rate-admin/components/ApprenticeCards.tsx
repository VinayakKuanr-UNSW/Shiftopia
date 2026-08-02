/**
 * ApprenticeCards — visual cards for apprentice & SWS percentage rates.
 *
 * Replaces the dense percentage table with readable cards showing each
 * apprentice type and their year-by-year percentage of Level 4.
 */

import React from 'react';
import { Wrench, HeartHandshake, Info } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
  APPRENTICE_MATRIX, SWS_CAPACITY_STEPS, SWS_MIN_WEEKLY, getAdultApprenticeEffectivePct,
} from '@/modules/rosters/domain/projections/utils/cost/apprentice_matrix';
import { resolveRateSet } from '@/modules/rosters/domain/projections/utils/cost/rate-schedule';

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

interface ApprenticeCardProps {
  title: string;
  subtitle: string;
  years: { year: number; value: number | null }[];
  accent?: string;
}

const ApprenticeCard: React.FC<ApprenticeCardProps> = ({ title, subtitle, years, accent }) => (
  <div className={cn(
    'rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-6',
    'transition-all hover:border-primary/30 hover:bg-card/60 shadow-sm',
    'flex flex-col gap-4 justify-between',
  )}
  role="article"
  aria-label={`${title} apprentice type, ${subtitle}`}
  >
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className={cn('rounded-lg p-2', accent ?? 'bg-primary/10')}>
          <Wrench className={cn('h-5 w-5', accent ? 'text-inherit' : 'text-primary')} aria-hidden="true" />
        </div>
        <div>
          <p className="text-base font-bold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground font-medium">{subtitle}</p>
        </div>
      </div>

      <div className="space-y-2" role="list" aria-label="Yearly multiplier rates">
        {years.map(({ year, value }) => (
          <div 
            key={year} 
            className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0"
            role="listitem"
          >
            <span className="text-sm font-medium text-muted-foreground">Year {year}</span>
            {value != null ? (
              <span className={cn(
                'text-base font-bold tabular-nums',
                value >= 1 ? 'text-emerald-400' : 'text-foreground',
              )}>
                {pct(value)}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground font-semibold">—</span>
            )}
          </div>
        ))}
      </div>
    </div>

    <p className="text-xs font-semibold text-muted-foreground pt-2 border-t border-border/40 mt-1">
      % of Level 4 rate
    </p>
  </div>
);

const ApprenticeCards: React.FC = () => {
  const standard = APPRENTICE_MATRIX.standard;
  const schoolBased = APPRENTICE_MATRIX.school_based;
  // cl 1.3 (years 2-4): the adult apprentice floor is "greater of Level 1 or
  // the junior %-table rate," not a fixed percentage — resolved against
  // TODAY's effective-dated rate set purely for this display. hasYr12=false
  // is used for the comparison; with the current published rate tables it
  // makes no numeric difference (Level 1 wins years 2-3 either way, and the
  // year-4 junior % is identical for both branches).
  const todayRateSet = resolveRateSet(new Date().toISOString().slice(0, 10));

  const cards: ApprenticeCardProps[] = [
    {
      title: 'Junior Apprentice',
      subtitle: 'No Year 12 completed',
      years: [1, 2, 3, 4].map((y) => ({
        year: y,
        value: (standard.no_yr12 as Record<number, number>)[y] ?? null,
      })),
    },
    {
      title: 'Junior Apprentice',
      subtitle: 'Completed Year 12',
      years: [1, 2, 3, 4].map((y) => ({
        year: y,
        value: (standard.yr12 as Record<number, number>)[y] ?? null,
      })),
    },
    {
      title: 'Adult Apprentice',
      subtitle: 'All apprentices aged 21+ — years 2-4 shown are the greater of Level 1 or the junior rate, as of today',
      years: [1, 2, 3, 4].map((y) => ({
        year: y,
        value: getAdultApprenticeEffectivePct(todayRateSet, y as 1 | 2 | 3 | 4, false),
      })),
    },
    {
      title: 'School-Based Apprentice',
      subtitle: 'Part-time school enrolment',
      years: [1, 2, 3, 4].map((y) => ({
        year: y,
        value: (schoolBased as Record<number, number>)[y] ?? null,
      })),
    },
  ];

  return (
    <div className="space-y-10">
      {/* Apprentices (Schedule 4) */}
      <section role="region" aria-label="Apprenticeship wage rates">
        <div className="flex items-center gap-3 mb-6">
          <Wrench className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h3 className="text-xl font-bold text-foreground">Apprentices (Schedule 4)</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Percentage of Level 4 rate · tracks CPI automatically via Level 4
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((card, i) => (
            <ApprenticeCard key={i} {...card} />
          ))}
        </div>
      </section>

      {/* SWS (Schedule 6) */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <HeartHandshake className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-base font-semibold text-foreground">Supported Wage System (Schedule 6)</h3>
            <p className="text-xs text-muted-foreground">
              Assessed capacity maps 1:1 to % of the relevant minimum wage · tracks CPI automatically
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {SWS_CAPACITY_STEPS.map((s) => (
            <div
              key={s}
              className="rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-center min-w-[80px] transition-all hover:border-primary/30"
            >
              <span className="text-lg font-bold text-foreground tabular-nums">{s}%</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">capacity</p>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-px flex-shrink-0" />
          Assessed capacity maps 1:1 to % of the relevant minimum wage (cl 1.4.1), with a
          hard floor of {money(SWS_MIN_WEEKLY)}/week (cl 1.4.2). The cost engine enforces
          this floor once a member's weekly SWS hours are known.
        </p>
      </section>
    </div>
  );
};

export default ApprenticeCards;
