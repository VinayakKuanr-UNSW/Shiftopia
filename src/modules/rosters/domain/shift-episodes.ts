/**
 * Shift Assignment Episodes — Pure TS Deriver
 *
 * Derives per-(shift, employee, attempt) assignment episodes from an ordered
 * list of shift lifecycle events. This is the TS-side mirror of the SQL view
 * `v_shift_assignment_episodes` — boundary rules are byte-identical.
 *
 * An "episode" is one contiguous span where a single employee holds or is
 * offered a shift, from the moment they enter to a terminal outcome.
 *
 * EPISODE BOUNDARY RULES (shared contract with SQL):
 *
 *   OPENING events: ASSIGNED, OFFERED, EMERGENCY_ASSIGNED, SWAPPED_IN
 *     - Start a NEW episode when no episode is currently open,
 *       OR the event's employeeId differs from the open episode's holder.
 *     - Consecutive opening events for the SAME holder while open
 *       stay in the SAME episode (set within-episode flags only).
 *
 *   CLOSING events → terminal_outcome:
 *     - REJECTED           → 'rejected'
 *     - IGNORED            → 'ignored'
 *     - CANCELLED/LATE_CANCELLED → 'cancelled_late'  if (scheduledStart - eventTime) <= 4h
 *                                   'cancelled_standard' otherwise
 *     - SWAPPED_OUT        → 'swapped_out'
 *     - NO_SHOW            → 'no_show'
 *     - UNASSIGNED         → 'unassigned'
 *
 *   No closing event + shift completed → 'fulfilled'
 *   No closing event otherwise → 'open'
 *
 *   POLICY:
 *     EMERGENCY_ASSIGNED = positive (good behaviour, never penalised)
 *     SWAPPED_OUT = neutral (feeds swap_ratio only)
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** Unified late-cancellation threshold in hours. A cancellation is "late" iff
 *  (scheduledStart - cancellationTime) <= this many hours. */
export const LATE_CANCEL_THRESHOLD_HOURS = 4;

const LATE_CANCEL_THRESHOLD_MS = LATE_CANCEL_THRESHOLD_HOURS * 60 * 60 * 1000;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Matches the RPC `get_shift_lifecycle` row. */
export interface ShiftLifecycleEvent {
  event_id: string;
  event_type: ShiftEventType;
  event_time: string; // ISO timestamp
  employee_id: string | null;
  employee_name: string | null;
  metadata: Record<string, unknown> | null;
}

/** All possible shift event types (mirrors the PG enum). */
export type ShiftEventType =
  | 'OFFERED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'IGNORED'
  | 'ASSIGNED'
  | 'UNASSIGNED'
  | 'EMERGENCY_ASSIGNED'
  | 'CANCELLED'
  | 'LATE_CANCELLED'
  | 'SWAPPED_OUT'
  | 'SWAPPED_IN'
  | 'CHECKED_IN'
  | 'LATE_IN'
  | 'EARLY_OUT'
  | 'NO_SHOW';

/** Terminal outcome vocabulary — shared with SQL side. */
export type TerminalOutcome =
  | 'rejected'
  | 'ignored'
  | 'cancelled_standard'
  | 'cancelled_late'
  | 'swapped_out'
  | 'no_show'
  | 'unassigned'
  | 'fulfilled'
  | 'open'
  | 'shift_deleted';

/** One assignment episode for a shift. */
export interface AssignmentEpisode {
  episodeSeq: number;
  employeeId: string;
  employeeName: string | null;
  openedAt: string;
  closedAt: string | null;
  openingEvent: ShiftEventType;
  terminalOutcome: TerminalOutcome;
  hadOffer: boolean;
  hadAccept: boolean;
  hadAssign: boolean;
  hadEmergency: boolean;
  hadSwapIn: boolean;
  attended: boolean;
  lateIn: boolean;
  earlyOut: boolean;
  events: ShiftLifecycleEvent[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const OPENING_EVENTS: ReadonlySet<ShiftEventType> = new Set([
  'ASSIGNED',
  'OFFERED',
  'EMERGENCY_ASSIGNED',
  'SWAPPED_IN',
]);

const CLOSING_EVENTS: ReadonlySet<ShiftEventType> = new Set([
  'REJECTED',
  'IGNORED',
  'CANCELLED',
  'LATE_CANCELLED',
  'SWAPPED_OUT',
  'NO_SHOW',
  'UNASSIGNED',
]);

function closingOutcome(
  eventType: ShiftEventType,
  eventTime: string,
  scheduledStart?: string,
): TerminalOutcome {
  switch (eventType) {
    case 'REJECTED':
      return 'rejected';
    case 'IGNORED':
      return 'ignored';
    case 'SWAPPED_OUT':
      return 'swapped_out';
    case 'NO_SHOW':
      return 'no_show';
    case 'UNASSIGNED':
      return 'unassigned';
    case 'CANCELLED':
    case 'LATE_CANCELLED': {
      if (scheduledStart) {
        const start = new Date(scheduledStart).getTime();
        const cancel = new Date(eventTime).getTime();
        if (start - cancel <= LATE_CANCEL_THRESHOLD_MS) {
          return 'cancelled_late';
        }
      }
      return 'cancelled_standard';
    }
    default:
      return 'open';
  }
}

// ─── Core Deriver ───────────────────────────────────────────────────────────

export interface DeriveEpisodesOptions {
  /** ISO timestamp of the shift's scheduled start. Used for late-cancel classification. */
  scheduledStart?: string;
  /** Whether the shift has reached Completed status. Used for fulfilled determination. */
  completed?: boolean;
}

/**
 * Derives assignment episodes from an ordered list of shift lifecycle events.
 *
 * Pure, deterministic, no I/O. Events MUST be pre-sorted by (event_time, event_id).
 *
 * @param events - Ordered lifecycle events for a single shift
 * @param opts   - Optional context: scheduledStart (for late-cancel), completed (for fulfilled)
 * @returns Array of AssignmentEpisode, one per (employee, attempt)
 */
export function deriveEpisodes(
  events: ShiftLifecycleEvent[],
  opts?: DeriveEpisodesOptions,
): AssignmentEpisode[] {
  const episodes: AssignmentEpisode[] = [];

  // Current open episode state
  let currentEpisode: {
    seq: number;
    employeeId: string;
    employeeName: string | null;
    openedAt: string;
    openingEvent: ShiftEventType;
    hadOffer: boolean;
    hadAccept: boolean;
    hadAssign: boolean;
    hadEmergency: boolean;
    hadSwapIn: boolean;
    hadCheckedIn: boolean;
    hadLateIn: boolean;
    hadEarlyOut: boolean;
    events: ShiftLifecycleEvent[];
    closed: boolean;
    closedAt: string | null;
    terminalOutcome: TerminalOutcome;
  } | null = null;

  let episodeCounter = 0;

  for (const event of events) {
    if (!event.employee_id) continue;

    const eventType = event.event_type;
    const isOpening = OPENING_EVENTS.has(eventType);
    const isClosing = CLOSING_EVENTS.has(eventType);

    // ── Opening event logic ─────────────────────────────────────────────
    if (isOpening) {
      // Start a new episode if:
      // 1. No episode is currently open
      // 2. Current episode is closed (previous close happened)
      // 3. Employee changed
      const needsNewEpisode =
        !currentEpisode ||
        currentEpisode.closed ||
        currentEpisode.employeeId !== event.employee_id;

      if (needsNewEpisode) {
        // Finalize the prior open episode. It is being SUPERSEDED by a new
        // episode (different holder / re-open after a close), so it can NEVER
        // be 'fulfilled' even on a Completed shift — only the FINAL episode of
        // the shift can be fulfilled. (Mirrors the SQL view, which gates
        // 'fulfilled' to episode_seq = max(episode_seq) per shift.)
        if (currentEpisode && !currentEpisode.closed) {
          currentEpisode.terminalOutcome = 'open';
          episodes.push(buildEpisode(currentEpisode));
        }

        episodeCounter++;
        currentEpisode = {
          seq: episodeCounter,
          employeeId: event.employee_id,
          employeeName: event.employee_name,
          openedAt: event.event_time,
          openingEvent: eventType,
          hadOffer: eventType === 'OFFERED',
          hadAccept: false,
          hadAssign: eventType === 'ASSIGNED',
          hadEmergency: eventType === 'EMERGENCY_ASSIGNED',
          hadSwapIn: eventType === 'SWAPPED_IN',
          hadCheckedIn: false,
          hadLateIn: false,
          hadEarlyOut: false,
          events: [event],
          closed: false,
          closedAt: null,
          terminalOutcome: 'open',
        };
      } else if (currentEpisode) {
        // Same employee, episode still open → update flags
        if (eventType === 'OFFERED') currentEpisode.hadOffer = true;
        if (eventType === 'ASSIGNED') currentEpisode.hadAssign = true;
        if (eventType === 'EMERGENCY_ASSIGNED') currentEpisode.hadEmergency = true;
        if (eventType === 'SWAPPED_IN') currentEpisode.hadSwapIn = true;
        currentEpisode.events.push(event);
      }
      continue;
    }

    // ── Closing event logic ─────────────────────────────────────────────
    if (isClosing && currentEpisode && !currentEpisode.closed) {
      currentEpisode.closed = true;
      currentEpisode.closedAt = event.event_time;
      currentEpisode.terminalOutcome = closingOutcome(
        eventType,
        event.event_time,
        opts?.scheduledStart,
      );
      currentEpisode.events.push(event);
      episodes.push(buildEpisode(currentEpisode));
      continue;
    }

    // ── Intra-episode events (ACCEPTED, CHECKED_IN, LATE_IN, EARLY_OUT) ─
    if (currentEpisode && !currentEpisode.closed) {
      if (eventType === 'ACCEPTED') currentEpisode.hadAccept = true;
      if (eventType === 'CHECKED_IN') currentEpisode.hadCheckedIn = true;
      if (eventType === 'LATE_IN') {
        currentEpisode.hadLateIn = true;
        currentEpisode.hadCheckedIn = true; // LATE_IN implies checked in
      }
      if (eventType === 'EARLY_OUT') currentEpisode.hadEarlyOut = true;
      currentEpisode.events.push(event);
    }
    // Events without an open episode are orphans — skip them
  }

  // Finalize any remaining open episode
  if (currentEpisode && !currentEpisode.closed) {
    currentEpisode.terminalOutcome = opts?.completed ? 'fulfilled' : 'open';
    episodes.push(buildEpisode(currentEpisode));
  }

  return episodes;
}

/** Converts internal mutable episode state to the public AssignmentEpisode.
 *
 *  IMPORTANT: openingEvent is derived from within-episode flags using the same
 *  priority hierarchy as the SQL view `v_shift_assignment_episodes`:
 *    EMERGENCY_ASSIGNED > SWAPPED_IN > ASSIGNED > OFFERED
 *  This ensures byte-identical results between TS and SQL.
 */
function buildEpisode(ep: {
  seq: number;
  employeeId: string;
  employeeName: string | null;
  openedAt: string;
  openingEvent: ShiftEventType;
  hadOffer: boolean;
  hadAccept: boolean;
  hadAssign: boolean;
  hadEmergency: boolean;
  hadSwapIn: boolean;
  hadCheckedIn: boolean;
  hadLateIn: boolean;
  hadEarlyOut: boolean;
  events: ShiftLifecycleEvent[];
  closedAt: string | null;
  terminalOutcome: TerminalOutcome;
}): AssignmentEpisode {
  // Derive openingEvent from flags (priority matches SQL CASE expression)
  let openingEvent: ShiftEventType = ep.openingEvent;
  if (ep.hadEmergency) openingEvent = 'EMERGENCY_ASSIGNED';
  else if (ep.hadSwapIn) openingEvent = 'SWAPPED_IN';
  else if (ep.hadAssign) openingEvent = 'ASSIGNED';
  else if (ep.hadOffer) openingEvent = 'OFFERED';

  return {
    episodeSeq: ep.seq,
    employeeId: ep.employeeId,
    employeeName: ep.employeeName,
    openedAt: ep.openedAt,
    closedAt: ep.closedAt,
    openingEvent,
    terminalOutcome: ep.terminalOutcome,
    hadOffer: ep.hadOffer,
    hadAccept: ep.hadAccept,
    hadAssign: ep.hadAssign,
    hadEmergency: ep.hadEmergency,
    hadSwapIn: ep.hadSwapIn,
    attended: ep.hadCheckedIn,
    lateIn: ep.hadLateIn,
    earlyOut: ep.hadEarlyOut,
    events: ep.events,
  };
}
