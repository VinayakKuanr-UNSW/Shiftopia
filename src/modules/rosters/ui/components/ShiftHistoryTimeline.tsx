/**
 * ShiftHistoryTimeline — read-only audit ledger UI.
 *
 * A forensic, day-grouped trace of a single shift's lifecycle, sourced from the
 * get_shift_event_timeline RPC (the public.shift_events ledger). Purely
 * presentational — this surface NEVER writes or emits events.
 *
 *   <ShiftHistoryTimeline shiftId={shift.id} />
 *
 * Design: a connected state-machine ledger. Each event is a node on a vertical
 * spine, rendered as an aligned row:
 *
 *   ●  ┃  S2  ·  Published   ·  Kurry Admin (Manager)  ·  S4  ·  10:17:02
 *
 * The header shows the shift's full lifecycle journey (S2 → S4 → S11 → S13) so
 * the flow is legible at a glance. State chips are monospace; the destination
 * ("to") chip is accented in the event colour. Rows reveal with a staggered
 * entrance. Field edits show an inline Original → New diff under the action.
 */

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Bot,
  Calendar,
  Clock,
  Cog,
  Cpu,
  Edit3,
  Gavel,
  Store,
  ArrowLeftRight,
  ArrowRight,
  UserMinus,
  UserCheck,
  UserX,
  LogIn,
  LogOut,
  Receipt,
  ShieldAlert,
  History,
  Loader2,
  AlertTriangle,
  Inbox,
  Plus,
  PlayCircle,
  Zap,
  Send,
  RotateCcw,
  XCircle,
  CheckCircle2,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
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
const MARKETPLACE_ICON: LucideIcon = Store;

// ─── Event-specific icon + accent ────────────────────────────────────────────
// The domain colour/icon is a coarse bucket; a per-verb icon + accent makes the
// ledger scannable at a glance. Resolution: op (true verb) → event_type → domain.

const EVENT_ICON_BY_OP: Record<string, LucideIcon> = {
  create:             Plus,
  assign:             UserCheck,
  unassign:           UserMinus,
  publish:            Send,
  unpublish:          RotateCcw,
  in_progress:        PlayCircle,
  edit:               Edit3,
  move:               Edit3,
  delete:             XCircle,
  complete:           CheckCircle2,
  clock_out:          LogOut,
  select_winner:      Gavel,
  approve_trade:      ArrowLeftRight,
  reject_trade:       ArrowLeftRight,
  timesheet_finalize: Receipt,
  timesheet_adjust:   Receipt,
};

const EVENT_ICON_BY_TYPE: Record<string, LucideIcon> = {
  ASSIGNED:           UserCheck,
  UNASSIGNED:         UserMinus,
  EMERGENCY_ASSIGNED: Zap,
  OFFERED:            Inbox,
  ACCEPTED:           Check,
  REJECTED:           XCircle,
  IGNORED:            Clock,
  CHECKED_IN:         LogIn,
  LATE_IN:            LogIn,
  EARLY_OUT:          LogOut,
  NO_SHOW:            UserX,
  CANCELLED:          XCircle,
  LATE_CANCELLED:     XCircle,
  SWAPPED_OUT:        ArrowLeftRight,
  SWAPPED_IN:         ArrowLeftRight,
};

/** Most-specific icon for a row: op → event_type → domain fallback. */
function eventIcon(row: ShiftEventTimelineRow): LucideIcon {
  if (row.op && EVENT_ICON_BY_OP[row.op]) return EVENT_ICON_BY_OP[row.op];
  if (row.event_type && EVENT_ICON_BY_TYPE[row.event_type]) return EVENT_ICON_BY_TYPE[row.event_type];
  if (row.domain === 'marketplace') return MARKETPLACE_ICON;
  return domainIcon(row.domain);
}

// Accent overrides for events whose meaning is stronger than their domain colour.
const EVENT_COLOR_BY_OP: Record<string, string> = {
  create:      FSM_COLOR_HEX.slate,
  publish:     FSM_COLOR_HEX.blue,
  unpublish:   FSM_COLOR_HEX.orange,
  in_progress: FSM_COLOR_HEX.violet,
  delete:      FSM_COLOR_HEX.red,
  complete:    FSM_COLOR_HEX.emerald,
};

const EVENT_COLOR_BY_TYPE: Record<string, string> = {
  EMERGENCY_ASSIGNED: FSM_COLOR_HEX.amber,
  EARLY_OUT:          FSM_COLOR_HEX.amber,
  LATE_IN:            FSM_COLOR_HEX.amber,
  NO_SHOW:            FSM_COLOR_HEX.red,
  CANCELLED:          FSM_COLOR_HEX.red,
  LATE_CANCELLED:     FSM_COLOR_HEX.red,
  REJECTED:           FSM_COLOR_HEX.red,
};

/** Most-specific accent for a row: op/event_type override → domain colour. */
function eventColor(row: ShiftEventTimelineRow): string {
  if (row.op && EVENT_COLOR_BY_OP[row.op]) return EVENT_COLOR_BY_OP[row.op];
  if (row.event_type && EVENT_COLOR_BY_TYPE[row.event_type]) return EVENT_COLOR_BY_TYPE[row.event_type];
  return domainColor(row.domain);
}

// ─── Actor-role config ───────────────────────────────────────────────────────

const ACTOR_ROLE_CONFIG: Record<
  ShiftEventActorRole,
  { label: string; variant: 'info' | 'success' | 'secondary' }
> = {
  manager:       { label: 'Manager',        variant: 'info' },
  employee:      { label: 'Employee',       variant: 'success' },
  system:        { label: 'System',         variant: 'secondary' },
  autoscheduler: { label: 'Auto-Scheduler', variant: 'secondary' },
};

const ROLE_COLOR: Record<ShiftEventActorRole, string> = {
  manager:       FSM_COLOR_HEX.blue,
  employee:      FSM_COLOR_HEX.emerald,
  system:        FSM_COLOR_HEX.slate,
  autoscheduler: FSM_COLOR_HEX.violet,
};

// ─── Label derivation ────────────────────────────────────────────────────────

/** Turn a raw token ("EMERGENCY_ASSIGNED") into a human label ("Emergency Assigned"). */
function humanizeToken(token: string): string {
  return token
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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
  in_progress:        'In Progress',
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
  if (row.op === 'clock_out') {
    return row.event_type === 'EARLY_OUT' ? 'Clocked Out (Early)' : 'Clocked Out';
  }
  if (row.op && OP_LABELS[row.op]) return OP_LABELS[row.op];
  if (row.event_type && EVENT_TYPE_LABELS[row.event_type]) return EVENT_TYPE_LABELS[row.event_type];
  return humanizeToken(row.op || row.event_type || 'Event');
}

// ─── Source attribution (created-by mode + assigned-by) ──────────────────────
// Surfaced on the single Create/Update record so the ledger reads as one row
// with provenance instead of separate confusing assignment / emergency lines.

/** creation_source (manual | template | synthesizer) → display label. */
const CREATION_SOURCE_LABELS: Record<string, string> = {
  manual:      'Manual',
  template:    'Template',
  synthesizer: 'Labor Engine',
};

/** assignment_source → display label (assigned-by). */
const ASSIGNMENT_SOURCE_LABELS: Record<string, string> = {
  direct:        'Manager',
  manual:        'Manager',
  autoscheduler: 'Autoscheduler',
  bid:           'Bid won',
  swap:          'Trade',
  offer:         'Offer accepted',
  emergency:     'Emergency',
};

/** Accent per assigned-by label (reuses the FSM hex palette — no new colours). */
const ASSIGNED_BY_COLOR: Record<string, string> = {
  Manager:           FSM_COLOR_HEX.blue,
  Autoscheduler:     FSM_COLOR_HEX.violet,
  'Bid won':         FSM_COLOR_HEX.amber,
  Trade:             FSM_COLOR_HEX.orange,
  'Offer accepted':  FSM_COLOR_HEX.emerald,
  Emergency:         FSM_COLOR_HEX.red,
};

/** Created-by label for a `create` row, or null. */
function creationSourceLabel(row: ShiftEventTimelineRow): string | null {
  if (!row.creation_source) return null;
  return CREATION_SOURCE_LABELS[row.creation_source] ?? humanizeToken(row.creation_source);
}

/** Assigned-by label, resolved from the strongest available signal. */
function assignedByLabel(row: ShiftEventTimelineRow): string | null {
  // Event/op signals beat the stored source string (the actor knows best).
  if (row.event_type === 'EMERGENCY_ASSIGNED') return 'Emergency';
  if (row.actor_role === 'autoscheduler') return 'Autoscheduler';
  if (row.event_type === 'ACCEPTED') return 'Offer accepted';
  if (row.op === 'select_winner') return 'Bid won';
  if (row.op === 'approve_trade') return 'Trade';
  if (row.assignment_source) {
    return ASSIGNMENT_SOURCE_LABELS[row.assignment_source] ?? humanizeToken(row.assignment_source);
  }
  return null;
}

/** Does this row represent (or carry) an assignment worth showing inline? */
function hasAssignmentContext(row: ShiftEventTimelineRow): boolean {
  if (row.changes && Object.prototype.hasOwnProperty.call(row.changes, 'assignment')) return true;
  if (row.op === 'create' && row.employee_id) return true;
  if (['ASSIGNED', 'EMERGENCY_ASSIGNED', 'ACCEPTED'].includes(row.event_type)) return true;
  if (['assign', 'select_winner', 'approve_trade'].includes(row.op ?? '')) return true;
  return false;
}

/** Small provenance chip (created-via / assigned-by). */
const SourceChip: React.FC<{ label: string; color: string; prefix?: string }> = ({
  label,
  color,
  prefix,
}) => (
  <span
    className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-semibold"
    style={{ color, borderColor: `${color}55`, backgroundColor: `${color}14` }}
  >
    {prefix && <span className="font-normal opacity-70">{prefix}</span>}
    {label}
  </span>
);

/** Canonical FSM id (S1…S15) → the gapless display id (S1…S10) shown on cards. */
function displayState(s: string | null): string | null {
  if (!s) return null;
  const meta = (FSM_STATE_META as Record<string, ShiftFSMStateInfo | undefined>)[s];
  return meta ? meta.displayId : s;
}

/** Hex colour for a canonical FSM state (for the lifecycle journey chips). */
function stateColor(canonical: string | null): string {
  if (!canonical) return FSM_COLOR_HEX.slate;
  const meta = (FSM_STATE_META as Record<string, ShiftFSMStateInfo | undefined>)[canonical];
  return meta ? FSM_COLOR_HEX[meta.color] : FSM_COLOR_HEX.slate;
}

/** Two-letter initials for an actor avatar ("Kurry Admin" → "KA"). */
function actorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Value formatting for field diffs ────────────────────────────────────────

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.length === 0 ? '∅' : value.join(', ');
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

/** Precise HH:MM:SS (24h) for the per-event row — the audit format wants seconds. */
function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// ─── Layout constant ─────────────────────────────────────────────────────────
// Shared grid so the column header and every event row align like a table. The
// action column (1fr) absorbs slack, so the table always fills its container
// width — no clipped right edge. node | from | action | actor | to | time
const GRID_TEMPLATE = '32px 52px minmax(0,1fr) 176px 52px 88px';

// ─── State pill ──────────────────────────────────────────────────────────────
// Monospace FSM-state chip. The "to" pill is accented with the event colour; the
// "from" pill is muted. A null state renders a dim "—" so the row keeps its shape.

const StatePill: React.FC<{ state: string | null; color?: string }> = ({ state, color }) => {
  if (!state) {
    return (
      <span className="select-none rounded-md bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground/50">
        —
      </span>
    );
  }
  if (color) {
    return (
      <span
        className="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ring-1"
        style={{ backgroundColor: `${color}1F`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}
      >
        {state}
      </span>
    );
  }
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
      {state}
    </span>
  );
};

// ─── Actor cell ──────────────────────────────────────────────────────────────

const ActorCell: React.FC<{ row: ShiftEventTimelineRow }> = ({ row }) => {
  const role = (row.actor_role ?? 'system').toLowerCase() as ShiftEventActorRole;
  const cfg = ACTOR_ROLE_CONFIG[role] ?? ACTOR_ROLE_CONFIG.system;
  const color = ROLE_COLOR[role] ?? ROLE_COLOR.system;
  const name = row.actor_name;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ backgroundColor: `${color}1F`, color, boxShadow: `inset 0 0 0 1px ${color}3A` }}
        aria-hidden="true"
      >
        {name
          ? actorInitials(name)
          : role === 'autoscheduler'
            ? <Bot className="h-3.5 w-3.5" />
            : <Cpu className="h-3 w-3" />}
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        {name && <span className="truncate text-xs font-semibold text-foreground">{name}</span>}
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
          {cfg.label}
        </span>
      </div>
    </div>
  );
};

// ─── Action cell (label + inline Original → New diff + reason) ────────────────

const FIELD_LABELS: Record<string, string> = {
  role_id: 'Role',
  shift_group_id: 'Shift Group',
  roster_subgroup_id: 'Roster Subgroup',
  remuneration_level_id: 'Remuneration Level',
  sub_department_id: 'Sub Department',
  required_skills: 'Required Skills',
  required_licenses: 'Required Certifications',
  event_ids: 'Event Tags',
};

const ActionCell: React.FC<{ row: ShiftEventTimelineRow }> = ({ row }) => {
  const label = eventLabel(row);
  // `assignment` is rendered specially (named worker + source), not as a raw
  // uuid→uuid diff; `version` is internal bookkeeping.
  const entries = (row.changes ? Object.entries(row.changes) : []).filter(
    ([field]) => field !== 'version' && field !== '_version' && field !== 'assignment',
  );

  const createdBy = row.op === 'create' ? creationSourceLabel(row) : null;
  const showAssignment = hasAssignmentContext(row);
  const assignedBy = showAssignment ? assignedByLabel(row) : null;
  const assigneeName = showAssignment ? row.assignee_name : null;
  const hasProvenance = Boolean(createdBy || assignedBy || assigneeName);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-semibold leading-tight text-foreground">{label}</span>

      {hasProvenance && (
        <div className="flex flex-wrap items-center gap-1.5">
          {assigneeName && (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-foreground/80">
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/50" aria-hidden="true" />
              {assigneeName}
            </span>
          )}
          {createdBy && <SourceChip label={createdBy} color={FSM_COLOR_HEX.slate} prefix="via" />}
          {assignedBy && (
            <SourceChip label={assignedBy} color={ASSIGNED_BY_COLOR[assignedBy] ?? FSM_COLOR_HEX.slate} />
          )}
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {entries.map(([field, diff]) => (
            <div key={field} className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="font-medium text-muted-foreground/80">
                {FIELD_LABELS[field] ?? humanizeToken(field)}
              </span>
              <span className="rounded bg-rose-500/10 px-1 py-px font-mono text-[10px] text-rose-500/90 line-through decoration-rose-500/40">
                {formatValue(diff.old)}
              </span>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40" aria-hidden="true" />
              <span className="rounded bg-emerald-500/10 px-1 py-px font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                {formatValue(diff.new)}
              </span>
            </div>
          ))}
        </div>
      )}

      {row.reason && (
        <span className="text-[11px] italic text-muted-foreground/80">“{row.reason}”</span>
      )}
    </div>
  );
};

// ─── Single event row ────────────────────────────────────────────────────────

interface EventRowProps {
  row: ShiftEventTimelineRow;
  index: number;
  isFirst: boolean;
  isLast: boolean;
}

const EventRow: React.FC<EventRowProps> = ({ row, index, isFirst, isLast }) => {
  const color = eventColor(row);
  const Icon = eventIcon(row);
  const fromDisp = displayState(row.from_state);
  const toDisp = displayState(row.to_state);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.022, 0.4), ease: [0.22, 1, 0.36, 1] }}
      className="group relative grid items-start transition-colors hover:bg-foreground/[0.025] dark:hover:bg-white/[0.025]"
      style={{ gridTemplateColumns: GRID_TEMPLATE }}
    >
      {/* hover accent rail */}
      <span
        className="absolute left-0 top-0 bottom-0 w-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />

      {/* spine + node */}
      <div className="relative flex justify-center py-3">
        {!isFirst && <span className="absolute left-1/2 top-0 h-[26px] w-px -translate-x-1/2 bg-border/70" aria-hidden="true" />}
        {!isLast && <span className="absolute left-1/2 top-[26px] bottom-0 w-px -translate-x-1/2 bg-border/70" aria-hidden="true" />}
        <span
          className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-background"
          style={{ backgroundColor: `${color}1F`, boxShadow: `inset 0 0 0 1px ${color}40` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden="true" />
        </span>
      </div>

      {/* from-state */}
      <div className="flex justify-center py-3.5">
        <StatePill state={fromDisp} />
      </div>

      {/* action + diffs */}
      <div className="min-w-0 py-3 pr-2">
        <ActionCell row={row} />
      </div>

      {/* actor */}
      <div className="flex items-center py-3 pr-2">
        <ActorCell row={row} />
      </div>

      {/* to-state */}
      <div className="flex justify-center py-3.5">
        <StatePill state={toDisp} color={color} />
      </div>

      {/* timestamp */}
      <div className="flex items-center justify-end gap-1 py-3.5 pr-1 text-xs tabular-nums text-muted-foreground">
        <Clock className="h-3 w-3 opacity-50" aria-hidden="true" />
        {formatClock(row.event_time)}
      </div>
    </motion.div>
  );
};

// ─── Day group ───────────────────────────────────────────────────────────────

interface DayGroupProps {
  day: string;
  rows: ShiftEventTimelineRow[];
  startIndex: number;
}

const DayGroup: React.FC<DayGroupProps> = ({ day, rows, startIndex }) => (
  <div className="space-y-2">
    <div className="flex items-center gap-2 px-1">
      <Calendar className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden="true" />
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
        {formatDayHeading(day)}
      </h4>
      <span className="h-px flex-1 bg-border/50" aria-hidden="true" />
    </div>

    <div className="max-w-full overflow-x-auto rounded-xl border border-border/60 bg-card/40 shadow-sm backdrop-blur-sm">
      <div className="min-w-[460px]">
        {/* column header */}
        <div
          className="grid items-center border-b border-border/60 bg-muted/30 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          <span aria-hidden="true" />
          <span className="py-2 text-center">From</span>
          <span className="py-2">Action</span>
          <span className="py-2">Actor</span>
          <span className="py-2 text-center">To</span>
          <span className="py-2 pr-1 text-right">Time</span>
        </div>

        {/* rows */}
        <div className="divide-y divide-border/40 px-2">
          {rows.map((row, i) => (
            <EventRow
              key={row.event_id}
              row={row}
              index={startIndex + i}
              isFirst={i === 0}
              isLast={i === rows.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  </div>
);

// ─── Derived data helpers ────────────────────────────────────────────────────

/**
 * Drop the trigger-emitted ASSIGNED that coincides with a `create` event. An
 * assigned-at-creation shift emits BOTH; the create row already conveys it. The
 * ledger keeps both rows (metrics count ASSIGNED) — this de-dupes the DISPLAY.
 */
// One user action = one row. New DB data already writes a single record (the
// gateway folds the assignment in), so this is a no-op there; it keeps HISTORICAL
// multi-row data clean by absorbing a same-transaction ASSIGNED/UNASSIGNED sibling
// into its create/edit/move parent (carrying the worker + source onto the parent).
function foldShiftMutations(rows: ShiftEventTimelineRow[]): ShiftEventTimelineRow[] {
  const PARENT_OPS = new Set(['create', 'edit', 'move']);
  const parentTimes = new Set(
    rows.filter((r) => r.op != null && PARENT_OPS.has(r.op)).map((r) => r.event_time),
  );
  if (parentTimes.size === 0) return rows;

  const isAssignSibling = (r: ShiftEventTimelineRow) =>
    r.op == null &&
    (r.event_type === 'ASSIGNED' || r.event_type === 'UNASSIGNED') &&
    parentTimes.has(r.event_time);

  // Capture the first sibling's assignment context per parent timestamp.
  const foldCtx = new Map<string, ShiftEventTimelineRow>();
  for (const r of rows) {
    if (isAssignSibling(r) && !foldCtx.has(r.event_time)) foldCtx.set(r.event_time, r);
  }

  const out: ShiftEventTimelineRow[] = [];
  for (const r of rows) {
    if (isAssignSibling(r)) continue; // dropped — folded into the parent below
    const ctx = r.op != null && PARENT_OPS.has(r.op) ? foldCtx.get(r.event_time) : undefined;
    if (ctx) {
      out.push({
        ...r,
        employee_id: r.employee_id ?? ctx.employee_id,
        assignee_name: r.assignee_name ?? ctx.assignee_name,
        assignment_source: r.assignment_source ?? ctx.assignment_source,
        changes:
          ctx.event_type === 'ASSIGNED'
            ? { ...(r.changes ?? {}), assignment: { old: null, new: ctx.employee_id } }
            : r.changes,
      });
      continue;
    }
    out.push(r);
  }
  return out;
}

/**
 * Fill the state column across rows that don't record one (legacy trigger rows,
 * backfilled create/complete) so it reads as one continuous lifecycle.
 *
 * Two passes, because a single forward carry leaves leading rows blank — e.g. a
 * backfilled `create` that predates any known state would render "— → —", the
 * very thing it shouldn't. Instead:
 *   • forward  — a missing `from` inherits the prior row's resolved `to`;
 *   • backward — a still-missing `to` inherits the next row's resolved `from`,
 *     so `create` lands on the lifecycle's initial state (— → S1).
 * A `create` row keeps a null `from` (nothing precedes creation → "—"); explicit
 * states are never overwritten, so the pass only ever removes spurious dashes.
 */
function interpolateStateTransitions(rows: ShiftEventTimelineRow[]): ShiftEventTimelineRow[] {
  const out = rows.map((row) => ({ ...row }));

  // Forward: carry the last-known state into rows missing a `from`/`to`.
  let running: string | null = null;
  for (const row of out) {
    if (!row.from_state && row.op !== 'create') row.from_state = running;
    if (!row.to_state) row.to_state = row.from_state ?? running;
    running = row.to_state ?? running;
  }

  // Backward: seed leading rows (notably `create`) with the first known state.
  let nextKnown: string | null = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (!out[i].to_state) out[i].to_state = nextKnown;
    if (!out[i].from_state && out[i].op !== 'create') out[i].from_state = nextKnown;
    nextKnown = out[i].from_state ?? out[i].to_state ?? nextKnown;
  }

  return out;
}

interface TimelineSummary {
  count: number;
  firstTime: string;
  lastTime: string;
  finalState: string | null;
  finalColor: string;
}

/** One-line summary: event count, time span, and the shift's most-recent state. */
function summarize(rows: ShiftEventTimelineRow[]): TimelineSummary | null {
  if (rows.length === 0) return null;
  let finalState: string | null = null;
  let finalColor = FSM_COLOR_HEX.slate;
  for (let i = rows.length - 1; i >= 0; i--) {
    const ts = displayState(rows[i].to_state);
    if (ts) {
      finalState = ts;
      finalColor = stateColor(rows[i].to_state);
      break;
    }
  }
  return {
    count: rows.length,
    firstTime: rows[0].event_time,
    lastTime: rows[rows.length - 1].event_time,
    finalState,
    finalColor,
  };
}

interface JourneyStop {
  state: string;
  color: string;
}

/** Distinct-consecutive sequence of states the shift moved through. */
function buildJourney(rows: ShiftEventTimelineRow[]): JourneyStop[] {
  const stops: JourneyStop[] = [];
  let prev: string | null = null;
  for (const r of rows) {
    const canon = r.to_state;
    if (!canon || canon === prev) continue;
    prev = canon;
    const disp = displayState(canon);
    if (disp) stops.push({ state: disp, color: stateColor(canon) });
  }
  return stops;
}

const JourneyMap: React.FC<{ stops: JourneyStop[] }> = ({ stops }) => (
  <div className="flex flex-wrap items-center gap-1">
    {stops.map((s, i) => (
      <React.Fragment key={i}>
        {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground/40" aria-hidden="true" />}
        <span
          className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold"
          style={{ backgroundColor: `${s.color}1F`, color: s.color }}
        >
          {s.state}
        </span>
      </React.Fragment>
    ))}
  </div>
);

// ─── Domain filter chip ──────────────────────────────────────────────────────

const FilterChip: React.FC<{
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}> = ({ label, active, color, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all',
      active
        ? 'border-transparent text-white shadow-sm'
        : 'border-border/70 text-muted-foreground hover:border-border hover:bg-muted/60',
    )}
    style={active ? { backgroundColor: color ?? 'hsl(var(--primary))' } : undefined}
  >
    {label}
  </button>
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
 * Read-only "History" ledger for a single shift's audit trail.
 * Owns its own data fetch — just give it a shiftId.
 */
export function ShiftHistoryTimeline({ shiftId, className }: ShiftHistoryTimelineProps) {
  const isValid = typeof shiftId === 'string' && UUID_RE.test(shiftId);

  const query = useQuery<ShiftEventTimelineRow[]>({
    queryKey: ['shift_event_timeline', shiftId],
    queryFn: () => shiftsQueries.getShiftEventTimeline(shiftId as string),
    enabled: isValid,
  });

  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  // Sorted + display-deduped + state-interpolated event list.
  const allRows = useMemo(() => {
    const rows = [...(query.data ?? [])].sort((a, b) => {
      const dt = new Date(a.event_time).getTime() - new Date(b.event_time).getTime();
      if (dt !== 0) return dt;
      return (a.op === 'create' ? 0 : 1) - (b.op === 'create' ? 0 : 1);
    });
    return interpolateStateTransitions(foldShiftMutations(rows));
  }, [query.data]);

  const domains = useMemo(() => {
    const seen: string[] = [];
    for (const r of allRows) {
      const d = (r.domain ?? '').toString();
      if (d && !seen.includes(d)) seen.push(d);
    }
    return seen;
  }, [allRows]);

  const summary = useMemo(() => summarize(allRows), [allRows]);
  const journey = useMemo(() => buildJourney(allRows), [allRows]);

  const visibleRows = useMemo(
    () => (selectedDomain ? allRows.filter((r) => r.domain === selectedDomain) : allRows),
    [allRows, selectedDomain],
  );

  const grouped = useMemo(() => {
    const buckets = new Map<string, ShiftEventTimelineRow[]>();
    for (const row of visibleRows) {
      const key = dayKey(row.event_time);
      const list = buckets.get(key);
      if (list) list.push(row);
      else buckets.set(key, [row]);
    }
    return Array.from(buckets.entries());
  }, [visibleRows]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (query.isLoading) {
    return (
      <div className={cn('flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading history…
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (query.isError) {
    return (
      <div
        className={cn(
          'flex items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-xs text-destructive',
          className,
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Failed to load shift history.
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (allRows.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-xs text-muted-foreground',
          className,
        )}
      >
        <History className="h-6 w-6 opacity-40" aria-hidden="true" />
        <span className="italic">No history recorded for this shift yet.</span>
      </div>
    );
  }

  let runningIndex = 0;

  // ── Ledger ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn('space-y-3.5', className)} id="shift-history-timeline">
      {/* Summary band: count · span · current state, plus the lifecycle journey */}
      {summary && (
        <div className="space-y-2.5 rounded-xl border border-border/70 bg-gradient-to-br from-muted/50 to-muted/10 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 font-bold text-foreground">
                <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {summary.count} event{summary.count !== 1 ? 's' : ''}
              </span>
              <span className="text-muted-foreground/30">•</span>
              <span className="tabular-nums">
                {formatTime(summary.firstTime)} – {formatTime(summary.lastTime)}
              </span>
            </div>
            {summary.finalState && (
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Current
                </span>
                <span
                  className="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ring-1"
                  style={{
                    backgroundColor: `${summary.finalColor}1F`,
                    color: summary.finalColor,
                    boxShadow: `inset 0 0 0 1px ${summary.finalColor}33`,
                  }}
                >
                  {summary.finalState}
                </span>
              </span>
            )}
          </div>

          {journey.length > 1 && (
            <div className="flex items-center gap-2 border-t border-border/40 pt-2.5">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                Lifecycle
              </span>
              <JourneyMap stops={journey} />
            </div>
          )}
        </div>
      )}

      {/* Domain filter chips (only worth showing with >1 domain) */}
      {domains.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip label="All" active={selectedDomain === null} onClick={() => setSelectedDomain(null)} />
          {domains.map((d) => (
            <FilterChip
              key={d}
              label={humanizeToken(d)}
              color={domainColor(d)}
              active={selectedDomain === d}
              onClick={() => setSelectedDomain(d)}
            />
          ))}
        </div>
      )}

      {/* Events */}
      {grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-xs italic text-muted-foreground">
          No events in this category.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, rows]) => {
            const start = runningIndex;
            runningIndex += rows.length;
            return <DayGroup key={day} day={day} rows={rows} startIndex={start} />;
          })}
        </div>
      )}
    </div>
  );
}

export default ShiftHistoryTimeline;
