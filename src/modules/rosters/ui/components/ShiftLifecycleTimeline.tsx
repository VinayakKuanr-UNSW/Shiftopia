import React from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import type { AssignmentEpisode, ShiftLifecycleEvent, TerminalOutcome } from '@/modules/rosters/domain/shift-episodes';

// ─── Outcome → Badge variant/label mapping ──────────────────────────────────

const OUTCOME_CONFIG: Record<TerminalOutcome, {
  variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'info' | 'outline';
  label: string;
}> = {
  fulfilled:           { variant: 'success',     label: 'Fulfilled' },
  open:                { variant: 'info',        label: 'Open' },
  rejected:            { variant: 'warning',     label: 'Rejected' },
  ignored:             { variant: 'warning',     label: 'Ignored' },
  cancelled_standard:  { variant: 'warning',     label: 'Cancelled' },
  cancelled_late:      { variant: 'destructive', label: 'Late Cancel' },
  swapped_out:         { variant: 'secondary',   label: 'Swapped Out' },
  no_show:             { variant: 'destructive', label: 'No Show' },
  unassigned:          { variant: 'secondary',   label: 'Unassigned' },
  shift_deleted:       { variant: 'outline',     label: 'Deleted' },
};

/** Human-friendly event type labels. */
const EVENT_LABELS: Record<string, string> = {
  OFFERED:              'Offered',
  ACCEPTED:             'Accepted',
  REJECTED:             'Rejected',
  IGNORED:              'Ignored',
  ASSIGNED:             'Assigned',
  UNASSIGNED:           'Unassigned',
  EMERGENCY_ASSIGNED:   'Emergency Fill',
  CANCELLED:            'Cancelled',
  LATE_CANCELLED:       'Late Cancelled',
  SWAPPED_OUT:          'Swapped Out',
  SWAPPED_IN:           'Swapped In',
  CHECKED_IN:           'Checked In',
  LATE_IN:              'Late Arrival',
  EARLY_OUT:            'Early Departure',
  NO_SHOW:              'No Show',
};

/** Event type → dot colour for the timeline. */
const EVENT_DOT_CLASSES: Record<string, string> = {
  OFFERED:              'bg-blue-400 dark:bg-blue-500',
  ACCEPTED:             'bg-emerald-400 dark:bg-emerald-500',
  REJECTED:             'bg-amber-400 dark:bg-amber-500',
  IGNORED:              'bg-amber-400 dark:bg-amber-500',
  ASSIGNED:             'bg-blue-400 dark:bg-blue-500',
  UNASSIGNED:           'bg-slate-400 dark:bg-slate-500',
  EMERGENCY_ASSIGNED:   'bg-emerald-400 dark:bg-emerald-500',
  CANCELLED:            'bg-amber-400 dark:bg-amber-500',
  LATE_CANCELLED:       'bg-rose-400 dark:bg-rose-500',
  SWAPPED_OUT:          'bg-slate-400 dark:bg-slate-500',
  SWAPPED_IN:           'bg-blue-400 dark:bg-blue-500',
  CHECKED_IN:           'bg-emerald-400 dark:bg-emerald-500',
  LATE_IN:              'bg-amber-400 dark:bg-amber-500',
  EARLY_OUT:            'bg-amber-400 dark:bg-amber-500',
  NO_SHOW:              'bg-rose-400 dark:bg-rose-500',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

interface EventRowProps {
  event: ShiftLifecycleEvent;
}

function EventRow({ event }: EventRowProps) {
  const dotClass = EVENT_DOT_CLASSES[event.event_type] ?? 'bg-slate-400 dark:bg-slate-500';
  const label = EVENT_LABELS[event.event_type] ?? event.event_type;
  const time = new Date(event.event_time);

  return (
    <div className="flex items-center gap-3 py-1.5 group" id={`event-${event.event_id}`}>
      {/* Timeline dot */}
      <div className="relative flex items-center justify-center">
        <div className={`w-2.5 h-2.5 rounded-full ${dotClass} ring-2 ring-background shadow-sm`} />
      </div>

      {/* Event info */}
      <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          {time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
          {time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

interface EpisodeLaneProps {
  episode: AssignmentEpisode;
}

function EpisodeLane({ episode }: EpisodeLaneProps) {
  const outcomeConfig = OUTCOME_CONFIG[episode.terminalOutcome] ?? OUTCOME_CONFIG.open;

  return (
    <div
      className="rounded-lg border border-border bg-card/50 backdrop-blur-sm p-4 space-y-2"
      id={`episode-${episode.episodeSeq}`}
    >
      {/* Episode header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-muted-foreground">
            EP{episode.episodeSeq}
          </span>
          <span className="text-sm font-semibold text-foreground truncate">
            {episode.employeeName ?? episode.employeeId}
          </span>
          {episode.hadEmergency && (
            <Badge variant="success" className="text-[10px] px-1.5 py-0">
              Emergency Fill
            </Badge>
          )}
        </div>
        <Badge variant={outcomeConfig.variant}>{outcomeConfig.label}</Badge>
      </div>

      {/* Event timeline within this episode */}
      <div className="relative pl-1">
        {/* Vertical connector line */}
        {episode.events.length > 1 && (
          <div className="absolute left-[4px] top-3 bottom-3 w-px bg-border/50" />
        )}
        {episode.events.map((event) => (
          <EventRow key={event.event_id} event={event} />
        ))}
      </div>

      {/* Episode meta (attendance flags) */}
      {(episode.lateIn || episode.earlyOut || episode.attended) && (
        <div className="flex items-center gap-2 pt-1 border-t border-border/30">
          {episode.attended && (
            <span className="text-[10px] font-medium text-emerald-500 dark:text-emerald-400">
              ✓ Attended
            </span>
          )}
          {episode.lateIn && (
            <span className="text-[10px] font-medium text-amber-500 dark:text-amber-400">
              ⚠ Late In
            </span>
          )}
          {episode.earlyOut && (
            <span className="text-[10px] font-medium text-amber-500 dark:text-amber-400">
              ⚠ Early Out
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export interface ShiftLifecycleTimelineProps {
  /** Assignment episodes to display, one lane per episode. */
  episodes: AssignmentEpisode[];
  /** Optional class name for the container. */
  className?: string;
}

/**
 * ShiftLifecycleTimeline — presentational timeline showing a shift's lifecycle
 * as swimlanes, one per assignment episode.
 *
 * Each lane shows the holder's name, a colored outcome chip, and the ordered
 * events within that episode. Emergency fills get a positive (green) badge;
 * swapped_out a neutral badge; negative outcomes get amber/rose badges.
 *
 * Usage:
 * ```tsx
 * import { useShiftLifecycle } from '@/modules/rosters/ui/hooks/useShiftLifecycle';
 * import { ShiftLifecycleTimeline } from '@/modules/rosters/ui/components/ShiftLifecycleTimeline';
 *
 * function ShiftDetail({ shiftId }: { shiftId: string }) {
 *   const { data } = useShiftLifecycle(shiftId, { completed: true });
 *   if (!data) return null;
 *   return <ShiftLifecycleTimeline episodes={data.episodes} />;
 * }
 * ```
 */
export function ShiftLifecycleTimeline({ episodes, className }: ShiftLifecycleTimelineProps) {
  if (episodes.length === 0) {
    return (
      <div className={`text-sm text-muted-foreground italic px-4 py-8 text-center ${className ?? ''}`}>
        No assignment episodes found for this shift.
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className ?? ''}`} id="shift-lifecycle-timeline">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Assignment Lifecycle
      </h3>
      {episodes.map((episode) => (
        <EpisodeLane key={episode.episodeSeq} episode={episode} />
      ))}
    </div>
  );
}

export default ShiftLifecycleTimeline;
