/**
 * AwardDashboardHeader — summary stat cards for the Pay Rates dashboard.
 *
 * Shows at-a-glance: award name, effective date, next review, number of
 * classifications, and award status. All derived from the loaded schedule
 * data — no new API calls.
 */

import React, { useMemo } from 'react';
import {
  Award, Calendar, CalendarClock, Layers, CheckCircle2,
  AlertTriangle, XCircle,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { EbaRateSet } from '../../../data/ebaRates.read.api';
import WarningBanner, { computeWarnings } from './WarningBanner';

// ── status logic ─────────────────────────────────────────────────────────────

type AwardStatus = 'active' | 'expiring' | 'expired';

function deriveStatus(inForce: EbaRateSet | null): AwardStatus {
  if (!inForce) return 'expired';
  const now = new Date();
  const currentYear = now.getFullYear();
  const nextJuly = new Date(currentYear, 6, 1);
  if (nextJuly <= now) nextJuly.setFullYear(currentYear + 1);
  const daysUntilJuly = Math.ceil(
    (nextJuly.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  return daysUntilJuly <= 60 ? 'expiring' : 'active';
}

const STATUS_CONFIG: Record<AwardStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  active:   { label: '✓ Active',        color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/25', Icon: CheckCircle2 },
  expiring: { label: '⚠ Review Soon',   color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/25',   Icon: AlertTriangle },
  expired:  { label: '✕ Expired',       color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/25',       Icon: XCircle },
};

// ── stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: string;
  badge?: { text: string; className: string };
}

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, value, accent, badge }) => (
  <div className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-6 flex flex-col gap-3 min-w-0 transition-all hover:border-primary/30 hover:bg-card/60 shadow-sm">
    <div className="flex items-center gap-2.5">
      <Icon className={cn('h-5 w-5 flex-shrink-0', accent ?? 'text-muted-foreground')} aria-hidden="true" />
      <span className="text-sm font-semibold text-muted-foreground truncate">{label}</span>
    </div>
    <div className="flex items-baseline gap-2.5 flex-wrap">
      <span className={cn('text-2xl font-bold tracking-tight', accent ?? 'text-foreground')}>
        {value}
      </span>
      {badge && (
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider border', badge.className)}>
          {badge.text}
        </span>
      )}
    </div>
  </div>
);

// ── header ───────────────────────────────────────────────────────────────────

interface AwardDashboardHeaderProps {
  schedule: EbaRateSet[];
  inForce: EbaRateSet | null;
}

const AwardDashboardHeader: React.FC<AwardDashboardHeaderProps> = ({ schedule, inForce }) => {
  const status = useMemo(() => deriveStatus(inForce), [inForce]);
  const statusCfg = STATUS_CONFIG[status];
  const warnings = useMemo(() => computeWarnings(schedule), [schedule]);

  // Unique classifications in the in-force set
  const classificationCount = useMemo(() => {
    if (!inForce) return 0;
    return new Set(inForce.rates.map((r) => r.classification)).size;
  }, [inForce]);

  // Next review date: 1 July of the year after the latest effective date
  const nextReview = useMemo(() => {
    if (schedule.length === 0) return '—';
    const latest = schedule[schedule.length - 1];
    const year = parseInt(latest.effectiveFrom.slice(0, 4), 10);
    return `1 July ${year + 1}`;
  }, [schedule]);

  const effectiveSince = inForce?.effectiveFrom
    ? new Date(inForce.effectiveFrom + 'T00:00:00').toLocaleDateString('en-AU', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : '—';

  return (
    <div className="space-y-6">
      {/* Title row */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h2 className="text-2xl font-extrabold text-foreground tracking-tight flex items-center gap-3">
            <Award className="h-6 w-6 text-primary" aria-hidden="true" />
            ICC Sydney EBA (2025–2028)
          </h2>
          <p className="text-base text-muted-foreground mt-2 font-medium">
            Enterprise Agreement pay rates, allowances, and award schedules
          </p>
        </div>
        <div className={cn(
          'rounded-full px-4 py-1.5 text-xs font-bold border flex items-center gap-2 shadow-sm',
          statusCfg.bg, statusCfg.color,
        )}>
          <statusCfg.Icon className="h-4 w-4" aria-hidden="true" />
          {statusCfg.label}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" role="region" aria-label="Award status summary metrics">
        <StatCard
          icon={Calendar}
          label="Effective Since"
          value={effectiveSince}
        />
        <StatCard
          icon={CalendarClock}
          label="Next Review"
          value={nextReview}
          accent="text-blue-400"
        />
        <StatCard
          icon={Layers}
          label="Classifications"
          value={String(classificationCount)}
        />
        <StatCard
          icon={Award}
          label="Rate Sets"
          value={`${schedule.length} version${schedule.length !== 1 ? 's' : ''}`}
        />
      </div>

      {/* Warnings */}
      <WarningBanner warnings={warnings} />
    </div>
  );
};

export default AwardDashboardHeader;
