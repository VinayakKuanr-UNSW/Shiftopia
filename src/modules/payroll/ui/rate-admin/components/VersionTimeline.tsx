/**
 * VersionTimeline — vertical timeline showing each effective-dated rate set.
 *
 * Visual representation of all rate versions with active/future indicators.
 * Clicking a node scrolls to / highlights that rate set.
 */

import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import type { EbaRateSet } from '../../../data/ebaRates.read.api';

interface VersionTimelineProps {
  schedule: EbaRateSet[];
  inForceFrom: string | null;
  onSelectVersion?: (effectiveFrom: string) => void;
}

const formatDate = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};

const VersionTimeline: React.FC<VersionTimelineProps> = ({
  schedule,
  inForceFrom,
  onSelectVersion,
}) => {
  // Reverse so newest is first
  const versions = [...schedule].reverse();

  return (
    <div 
      className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-6 shadow-sm"
      role="region" 
      aria-label="Award version timeline"
    >
      <h3 className="text-base font-bold text-foreground mb-5">Version Timeline</h3>

      <div className="relative pl-6">
        {/* Vertical line */}
        <div className="absolute left-[9px] top-2.5 bottom-2.5 w-px bg-border/60" aria-hidden="true" />

        <div className="space-y-5 font-sans" role="list" aria-label="Available rate versions">
          {versions.map((set, i) => {
            const isActive = set.effectiveFrom === inForceFrom;
            const isFuture = set.effectiveFrom > (inForceFrom ?? '');
            return (
              <div key={set.effectiveFrom} role="listitem">
                <button
                  onClick={() => onSelectVersion?.(set.effectiveFrom)}
                  className={cn(
                    'relative flex items-start gap-4 w-full text-left rounded-lg p-3 -ml-3 transition-all',
                    'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    isActive && 'bg-primary/5 border border-primary/10',
                  )}
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={`${formatDate(set.effectiveFrom)} rate version, ${isActive ? 'currently active' : isFuture ? 'scheduled' : 'superseded'}`}
                >
                  {/* Dot */}
                  <div 
                    className={cn(
                      'absolute left-[-15px] top-[18px] h-3.5 w-3.5 rounded-full border-2 flex-shrink-0 z-10',
                      isActive
                        ? 'bg-primary border-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]'
                        : isFuture
                          ? 'bg-blue-500 border-blue-500'
                          : 'bg-muted border-border',
                    )} 
                    aria-hidden="true"
                  />

                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className={cn(
                        'text-sm font-bold',
                        isActive ? 'text-primary' : 'text-foreground',
                      )}>
                        {formatDate(set.effectiveFrom)}
                      </span>
                      {isActive && (
                        <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-primary border border-primary/20">
                          Active
                        </span>
                      )}
                      {isFuture && (
                        <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-blue-400 border border-blue-500/20">
                          Scheduled
                        </span>
                      )}
                      {!isActive && !isFuture && i < versions.length - 1 && (
                        <span className="rounded-full bg-muted/50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-muted-foreground border border-border/10">
                          Superseded
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 font-medium">
                      {set.rates.length} classification rate{set.rates.length !== 1 ? 's' : ''} · {set.allowances.length} allowance{set.allowances.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </button>
              </div>
            );
          })}

          {/* Add new version placeholder */}
          <div className="relative flex items-center gap-4 -ml-3 p-3 opacity-65" role="listitem">
            <div className="absolute left-[-15px] top-[18px] h-3.5 w-3.5 rounded-full border-2 border-dashed border-muted-foreground flex-shrink-0 z-10" aria-hidden="true" />
            <span className="text-sm text-muted-foreground italic font-medium">
              + New version via CPI preview
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VersionTimeline;
