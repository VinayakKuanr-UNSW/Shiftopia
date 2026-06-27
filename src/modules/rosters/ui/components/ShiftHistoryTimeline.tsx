/**
 * ShiftHistoryTimeline — read-only audit ledger UI.
 *
 * A vertical, day-grouped, oldest→newest timeline of a single shift's audit
 * events, sourced from the get_shift_event_timeline RPC (the public.shift_events
 * ledger). This surface NEVER writes or emits events — it is purely presentational.
 *
 * Self-contained: pass a shiftId and it owns its own data fetch (TanStack Query,
 * matching the useShiftLifecycle pattern). Drop it into any detail surface.
 *
 *   <ShiftHistoryTimeline shiftId={shift.id} />
 *
 * Each row shows:
 *   • a domain-coloured dot/icon
 *   • an actor-role chip (Manager / Employee / System)
 *   • a human label (derived from op || event_type)
 *   • a Δstate transition (from_state → to_state) when present
 *
 * Rows with a `changes` field-diff (or a reason / version delta) are expandable.
 * System-actor rows are visually dimmed so human actions stand out.
 */

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  Clock,
  Cog,
  Edit3,
  Gavel,
  Store,
  ArrowLeftRight,
  UserMinus,
  LogIn,
  Receipt,
  ShieldAlert,
  History,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Inbox,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { FSM_COLOR_HEX, FSM_STATE_META, type ShiftFSMStateInfo } from '../../domain/shift-fsm';
import { shiftsQueries } from '../../api/shifts.queries';
import type {
  ShiftEventTimelineRow,
  ShiftEventDomain,
  ShiftEventActorRole,
} from '../../api/shifts.queries';

// ─── Domain → FSM colour token mapping ───────────────────────────────────────
// REUSE the existing FSM hex palette (no new colour system). Each domain maps to
// a sensible existing token, then resolves to a hex via FSM_COLOR_HEX.

type FsmColorToken = ShiftFSMStateInfo['color'];

const DOMAIN_COLOR_TOKEN: Record<ShiftEventDomain, FsmColorToken> = {
  schedule:   'amber',   // edits / schedule changes
  assignment: 'emerald', // assign / confirm
  lifecycle:  'blue',    // create / publish / complete / lifecycle transitions
  offer:      'blue',    // offered / accepted / rejected
  trade:      'orange',  // trade requested / accepted
  attendance: 'violet',  // clock-in / clock-out
  compliance: 'red',     // compliance / cancel
  marketplace:'violet',  // bidding / marketplace
  drop:       'red',     // employee drop / cancel-like
  payroll:    'emerald', // timesheet finalize / adjust
};

const DOMAIN_ICON: Record<ShiftEventDomain, LucideIcon> = {
  schedule:   Edit3,
  assignment: Calendar,
  lifecycle:  History,
  offer:      Inbox,
  trade:      ArrowLeftRight,
  attendance: LogIn,
  compliance: ShieldAlert,
  marketplace:Gavel,
  drop:       UserMinus,
  payroll:    Receipt,
};

function isKnownDomain(d: string | null | undefined): d is ShiftEventDomain {
  return !!d && d in DOMAIN_COLOR_TOKEN;
}

/** Resolve a domain to its FSM hex colour (falls back to the neutral slate token). */
function domainColor(domain: string | null | undefined): string {
  const token: FsmColorToken = isKnownDomain(domain)
    ? DOMAIN_COLOR_TOKEN[domain]
    : 'slate';
  return FSM_COLOR_HEX[token];
}

/** Resolve a domain to its icon (falls back to a neutral cog). */
function domainIcon(domain: string | null | undefined): LucideIcon {
  return isKnownDomain(domain) ? DOMAIN_ICON[domain] : Cog;
}

// ─── Marketplace gets its own icon when domain is the violet store-front ──────
// (kept here so Store import is meaningful and not dead.)
const MARKETPLACE_ICON: LucideIcon = Store;

// ─── Actor-role chip config ──────────────────────────────────────────────────

const ACTOR_ROLE_CONFIG: Record<
  ShiftEventActorRole,
  { label: string; variant: 'info' | 'success' | 'secondary' }
> = {
  manager:  { label: 'Manager',  variant: 'info' },
  employee: { label: 'Employee', variant: 'success' },
  system:   { label: 'System',   variant: 'secondary' },
};

function isSystemActor(role: string | null | undefined): boolean {
  return (role ?? 'system').toLowerCase() === 'system';
}

// ─── Label derivation ────────────────────────────────────────────────────────

/**
 * Turn a raw op/event_type token (e.g. "EMERGENCY_ASSIGNED", "publish_shift")
 * into a human label ("Emergency Assigned", "Publish Shift").
 */
function humanizeToken(token: string): string {
  return token
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Explicit, friendly labels for the verbs the ledger emits. `op` (the true verb,
// in metadata) wins; `event_type` is the coarse enum fallback for trigger rows.
const OP_LABELS: Record<string, string> = {
  create:             'Created',
  assign:             'Assigned',
  unassign:           'Unassigned',
  publish:            'Published',
  unpublish:          'Unpublished',
  edit:               'Edited',
  move:               'Moved',
  delete:             'Deleted',
  select_winner:      'Bid Winner Selected',
  approve_trade:      'Trade Approved',
  reject_trade:       'Trade Rejected',
  complete:           'Completed',
  timesheet_finalize: 'Timesheet Finalized',
  timesheet_adjust:   'Timesheet Adjusted',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  OFFERED:            'Offered',
  ACCEPTED:           'Offer Accepted',
  REJECTED:           'Offer Rejected',
  IGNORED:            'Offer Expired',
  ASSIGNED:           'Assigned',
  UNASSIGNED:         'Unassigned',
  EMERGENCY_ASSIGNED: 'Emergency Assigned',
  CANCELLED:          'Cancelled',
  LATE_CANCELLED:     'Late Cancelled',
  SWAPPED_OUT:        'Swapped Out',
  SWAPPED_IN:         'Swapped In',
  CHECKED_IN:         'Clocked In',
  LATE_IN:            'Late In',
  EARLY_OUT:          'Early Out',
  NO_SHOW:            'No Show',
};

/** Human label for a row — prefers `op`, falls back to `event_type`. */
function eventLabel(row: ShiftEventTimelineRow): string {
  // Clock-out: surface the early/late qualifier the event_type carries.
  if (row.op === 'clock_out') {
    return row.event_type === 'EARLY_OUT' ? 'Clocked Out (Early)' : 'Clocked Out';
  }
  if (row.op && OP_LABELS[row.op]) return OP_LABELS[row.op];
  if (row.event_type && EVENT_TYPE_LABELS[row.event_type]) return EVENT_TYPE_LABELS[row.event_type];
  return humanizeToken(row.op || row.event_type || 'Event');
}

/** Canonical FSM id (S1…S15) → the gapless display id (S1…S10) shown on cards. */
function displayState(s: string | null): string | null {
  if (!s) return null;
  const meta = (FSM_STATE_META as Record<string, ShiftFSMStateInfo | undefined>)[s];
  return meta ? meta.displayId : s;
}

// ─── Value formatting for field diffs ────────────────────────────────────────

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value.length === 0 ? '∅' : value;
  if (typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ─── Date / time helpers ─────────────────────────────────────────────────────

/** Day bucket key (YYYY-MM-DD in local time) for grouping. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayHeading(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatFullTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ─── Version-delta extraction ────────────────────────────────────────────────
// If the changes diff carries a `version` field, surface it as "v3 → v4".

function versionDelta(
  row: ShiftEventTimelineRow,
): { from: string; to: string } | null {
  if (row.from_version && row.to_version && row.from_version !== row.to_version) {
    return { from: row.from_version, to: row.to_version };
  }
  return null;
}

// ─── Single event row ────────────────────────────────────────────────────────

interface EventRowProps {
  row: ShiftEventTimelineRow;
  isLast: boolean;
}

const EventRow: React.FC<EventRowProps> = ({ row, isLast }) => {
  const [expanded, setExpanded] = useState(false);

  const color = useMemo(() => domainColor(row.domain), [row.domain]);
  const Icon = useMemo<LucideIcon>(() => {
    if (row.domain === 'marketplace') return MARKETPLACE_ICON;
    return domainIcon(row.domain);
  }, [row.domain]);

  const system = isSystemActor(row.actor_role);
  const roleKey = (row.actor_role ?? 'system').toLowerCase() as ShiftEventActorRole;
  const actorCfg = ACTOR_ROLE_CONFIG[roleKey] ?? ACTOR_ROLE_CONFIG.system;

  // Only show the transition when it's an ACTUAL state change — hides the
  // confusing "S1 → S1" on in-place edits and the bare arrow on trigger rows
  // that carry no state. Mapped to the gapless display ids the cards use.
  const fromDisp = displayState(row.from_state);
  const toDisp = displayState(row.to_state);
  const hasStateDelta = !!toDisp && fromDisp !== toDisp;
  const changeEntries = row.changes ? Object.entries(row.changes) : [];
  const vDelta = useMemo(() => versionDelta(row), [row]);
  const isExpandable = changeEntries.length > 0 || !!row.reason || !!vDelta;

  return (
    <li className="relative flex gap-3">
      {/* Vertical connector line (skipped on the last row of the group) */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[11px] top-6 bottom-0 w-px bg-border"
        />
      )}

      {/* Domain dot / icon */}
      <div className="relative z-10 mt-0.5 shrink-0">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-background shadow-sm',
            system && 'opacity-60',
          )}
          style={{ backgroundColor: `${color}1A` /* ~10% alpha */ }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden="true" />
        </span>
      </div>

      {/* Row body */}
      <div
        className={cn(
          'min-w-0 flex-1 pb-4',
          system && 'opacity-70',
        )}
      >
        <div
          className={cn(
            'rounded-lg border border-border bg-card/50 px-3 py-2 transition-colors',
            isExpandable && 'cursor-pointer hover:bg-card/80',
            system && 'bg-muted/20 dark:bg-muted/10',
          )}
          onClick={isExpandable ? () => setExpanded((v) => !v) : undefined}
          role={isExpandable ? 'button' : undefined}
          tabIndex={isExpandable ? 0 : undefined}
          onKeyDown={
            isExpandable
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpanded((v) => !v);
                  }
                }
              : undefined
          }
        >
          {/* Top line: label + actor chip + time */}
          <div className="flex items-center gap-2">
            {isExpandable && (
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                  expanded && 'rotate-90',
                )}
                aria-hidden="true"
              />
            )}
            <span className="truncate text-sm font-semibold text-foreground">
              {eventLabel(row)}
            </span>

            <Badge variant={actorCfg.variant} className="h-5 shrink-0 px-1.5 text-[10px]">
              {actorCfg.label}
            </Badge>

            <span className="ml-auto flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {formatTime(row.event_time)}
            </span>
          </div>

          {/* Δstate transition */}
          {hasStateDelta && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {fromDisp ?? '—'}
              </span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold"
                style={{ backgroundColor: `${color}1A`, color }}
              >
                {toDisp ?? '—'}
              </span>
            </div>
          )}

          {/* Expanded detail: field diffs, reason, version delta, full timestamp */}
          {expanded && isExpandable && (
            <div className="mt-2.5 space-y-2 border-t border-border/60 pt-2.5">
              {changeEntries.length > 0 && (
                <ul className="space-y-1">
                  {changeEntries
                    .filter(([field]) => field !== 'version' && field !== '_version')
                    .map(([field, diff]) => (
                      <li
                        key={field}
                        className="flex flex-wrap items-baseline gap-1.5 text-xs"
                      >
                        <span className="font-medium text-foreground">
                          {humanizeToken(field)}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground line-through decoration-rose-400/60">
                          {formatValue(diff.old)}
                        </span>
                        <ChevronRight
                          className="h-3 w-3 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                          {formatValue(diff.new)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}

              {vDelta && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Version</span>
                  <span className="font-mono text-[11px]">
                    v{vDelta.from} → v{vDelta.to}
                  </span>
                </div>
              )}

              {row.reason && (
                <div className="flex items-start gap-1.5 text-xs">
                  <span className="font-medium text-foreground">Reason</span>
                  <span className="italic text-muted-foreground">{row.reason}</span>
                </div>
              )}

              <div className="text-[11px] tabular-nums text-muted-foreground/70">
                {formatFullTimestamp(row.event_time)}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
};

// ─── Day group ───────────────────────────────────────────────────────────────

interface DayGroupProps {
  day: string;
  rows: ShiftEventTimelineRow[];
}

const DayGroup: React.FC<DayGroupProps> = ({ day, rows }) => (
  <div className="space-y-2">
    <div className="flex items-center gap-2 px-0.5">
      <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {formatDayHeading(day)}
      </h4>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
    <ol className="space-y-0">
      {rows.map((row, i) => (
        <EventRow key={row.event_id} row={row} isLast={i === rows.length - 1} />
      ))}
    </ol>
  </div>
);

// ─── Main component ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ShiftHistoryTimelineProps {
  /** UUID of the shift whose audit history to render. */
  shiftId: string | null | undefined;
  /** Optional container class name. */
  className?: string;
}

/**
 * Read-only "History" timeline for a single shift's audit ledger.
 * Owns its own data fetch — just give it a shiftId.
 */
export function ShiftHistoryTimeline({ shiftId, className }: ShiftHistoryTimelineProps) {
  const isValid = typeof shiftId === 'string' && UUID_RE.test(shiftId);

  const query = useQuery<ShiftEventTimelineRow[]>({
    queryKey: ['shift_event_timeline', shiftId],
    queryFn: () => shiftsQueries.getShiftEventTimeline(shiftId as string),
    enabled: isValid,
  });

  // Group events by day, oldest → newest. The RPC is expected to return ordered
  // rows, but we sort defensively so the UI never depends on RPC ordering.
  const grouped = useMemo(() => {
    const rows = [...(query.data ?? [])].sort(
      (a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime(),
    );
    const buckets = new Map<string, ShiftEventTimelineRow[]>();
    for (const row of rows) {
      const key = dayKey(row.event_time);
      const list = buckets.get(key);
      if (list) list.push(row);
      else buckets.set(key, [row]);
    }
    return Array.from(buckets.entries()); // already oldest→newest (insertion order)
  }, [query.data]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (query.isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground',
          className,
        )}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Loading history…
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (query.isError) {
    return (
      <div
        className={cn(
          'flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-xs text-destructive',
          className,
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Failed to load shift history.
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (grouped.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground',
          className,
        )}
      >
        <History className="h-5 w-5 opacity-50" aria-hidden="true" />
        <span className="italic">No history recorded for this shift yet.</span>
      </div>
    );
  }

  // ── Timeline ───────────────────────────────────────────────────────────────
  return (
    <div className={cn('space-y-5', className)} id="shift-history-timeline">
      {grouped.map(([day, rows]) => (
        <DayGroup key={day} day={day} rows={rows} />
      ))}
    </div>
  );
}

export default ShiftHistoryTimeline;
