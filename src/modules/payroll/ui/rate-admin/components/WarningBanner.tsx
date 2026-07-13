/**
 * WarningBanner — contextual alert cards for the Pay Rates dashboard.
 *
 * Displays time-sensitive warnings about rate expiry, missing CPI versions,
 * etc. Computed from the loaded schedule data — no new API calls.
 */

import React from 'react';
import { AlertTriangle, Clock, CalendarClock } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

export interface PayRateWarning {
  id: string;
  severity: 'warning' | 'error';
  icon: React.ElementType;
  title: string;
  description: string;
}

/** Compute contextual warnings from the schedule data. */
export function computeWarnings(
  schedule: { effectiveFrom: string }[],
  now: Date = new Date(),
): PayRateWarning[] {
  const warnings: PayRateWarning[] = [];
  const currentYear = now.getFullYear();
  const nextJuly = new Date(currentYear, 6, 1); // July = month 6
  if (nextJuly <= now) nextJuly.setFullYear(currentYear + 1);

  const daysUntilJuly = Math.ceil(
    (nextJuly.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Check if any future rate set covers next July
  const nextJulyISO = nextJuly.toISOString().split('T')[0];
  const hasFutureSet = schedule.some((s) => s.effectiveFrom >= nextJulyISO);

  if (daysUntilJuly <= 90 && !hasFutureSet) {
    warnings.push({
      id: 'rates-expiring',
      severity: daysUntilJuly <= 30 ? 'error' : 'warning',
      icon: Clock,
      title: `Current rates need review in ${daysUntilJuly} days`,
      description: `The next annual CPI review is due 1 July ${nextJuly.getFullYear()}. No updated rate set has been prepared yet.`,
    });
  }

  if (!hasFutureSet) {
    warnings.push({
      id: 'no-future-set',
      severity: 'warning',
      icon: CalendarClock,
      title: `No CPI version exists for 1 July ${nextJuly.getFullYear()}`,
      description:
        'Use the CPI & Versions tab to preview and generate the next rate increase (cl 25.1).',
    });
  }

  return warnings;
}

const WarningBanner: React.FC<{ warnings: PayRateWarning[] }> = ({ warnings }) => {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-4" role="region" aria-label="System notifications and alerts">
      {warnings.map((w) => (
        <div
          key={w.id}
          className={cn(
            'flex items-start gap-4 rounded-xl border p-5 transition-all shadow-sm',
            w.severity === 'error'
              ? 'border-red-500/30 bg-red-500/8 text-red-400'
              : 'border-amber-500/30 bg-amber-500/8 text-amber-400',
          )}
          role="alert"
        >
          <w.icon className="h-5 w-5 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h4 className="text-base font-bold tracking-tight">{w.title}</h4>
            <p className={cn(
              'text-sm mt-1 leading-relaxed font-medium',
              w.severity === 'error' ? 'text-red-400/80' : 'text-amber-400/80',
            )}>
              {w.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default WarningBanner;
