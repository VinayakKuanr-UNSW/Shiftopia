/**
 * First-aid appointments (EBA cl 28.2) — the rules the screen applies before
 * the database does.
 *
 * cl 28.2 pays the allowance to a Team Member "appointed by the Employer to
 * perform First Aid duties", on every ordinary hour they work. The appointment
 * is a dated fact about the PERSON (`public.first_aid_appointments`); shifts
 * pick it up through the computed field `shifts.is_first_aid_duty`.
 *
 * The database is the authority: an exclusion constraint forbids overlapping
 * ranges, a CHECK forbids an end before the start, RLS decides who may write,
 * and a trigger (20261005064116) freezes the part of an appointment that has
 * already elapsed, because payroll and every cost engine re-read it live. This
 * module mirrors those rules so the UI only offers actions the database will
 * accept, and can explain a refusal before the round-trip.
 *
 * All dates are 'yyyy-MM-dd' calendar dates in Australia/Sydney, so plain
 * string comparison orders them correctly.
 */

export interface FirstAidAppointment {
  id: string;
  organization_id: string;
  employee_id: string;
  effective_from: string;
  /** Last day the appointment applies; null = until ended. */
  effective_to: string | null;
  appointed_by: string | null;
  notes: string | null;
  created_at: string;
  appointer?: { first_name: string | null; last_name: string | null } | null;
}

export type AppointmentStatus = 'scheduled' | 'current' | 'ended';

const OPEN_END = '9999-12-31';

export function appointmentStatus(
  a: Pick<FirstAidAppointment, 'effective_from' | 'effective_to'>,
  today: string,
): AppointmentStatus {
  if (a.effective_from > today) return 'scheduled';
  if (a.effective_to !== null && a.effective_to < today) return 'ended';
  return 'current';
}

/** The calendar day before `isoDate`, computed in UTC so no zone can shift it. */
export function previousDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export interface AppointmentActions {
  /** May its end date be set or moved? */
  canEnd: boolean;
  /** May it be removed outright? Only before it has started. */
  canDelete: boolean;
  /** Earliest end date the database will accept, when `canEnd`. */
  earliestEnd: string | null;
}

/**
 * Mirrors the history guard: a scheduled appointment can be deleted; a current
 * one can only be ended, no earlier than yesterday (and never before its own
 * start); an ended one is frozen.
 */
export function allowedActions(
  a: Pick<FirstAidAppointment, 'effective_from' | 'effective_to'>,
  today: string,
): AppointmentActions {
  switch (appointmentStatus(a, today)) {
    case 'scheduled':
      return { canEnd: false, canDelete: true, earliestEnd: null };
    case 'ended':
      return { canEnd: false, canDelete: false, earliestEnd: null };
    case 'current': {
      const yesterday = previousDay(today);
      return {
        canEnd: true,
        canDelete: false,
        earliestEnd: a.effective_from > yesterday ? a.effective_from : yesterday,
      };
    }
  }
}

function rangesOverlap(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
  return aFrom <= (bTo ?? OPEN_END) && bFrom <= (aTo ?? OPEN_END);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Null when the new appointment is acceptable; otherwise the reason it is not. */
export function validateNewAppointment(
  input: { organizationId: string; from: string; to: string | null },
  existing: Pick<FirstAidAppointment, 'organization_id' | 'effective_from' | 'effective_to'>[],
): string | null {
  if (!ISO_DATE.test(input.from)) return 'Choose the date the appointment starts.';
  if (input.to !== null && !ISO_DATE.test(input.to)) return 'The end date is not a valid date.';
  if (input.to !== null && input.to < input.from) return 'The end date cannot be before the start date.';
  const clash = existing.find(e =>
    e.organization_id === input.organizationId
    && rangesOverlap(input.from, input.to, e.effective_from, e.effective_to));
  if (clash) {
    return `This overlaps the appointment from ${clash.effective_from}`
      + `${clash.effective_to ? ` to ${clash.effective_to}` : ' (still in force)'}. End that one first.`;
  }
  return null;
}

/** Null when `newEnd` is acceptable for this appointment today. */
export function validateEndDate(
  a: Pick<FirstAidAppointment, 'effective_from' | 'effective_to'>,
  newEnd: string,
  today: string,
): string | null {
  const { canEnd, earliestEnd } = allowedActions(a, today);
  if (!canEnd || earliestEnd === null) return 'This appointment can no longer be changed.';
  if (!ISO_DATE.test(newEnd)) return 'Choose the last day the appointment applies.';
  if (newEnd < earliestEnd) {
    return `The earliest end date is ${earliestEnd}. Ending it earlier would re-price shifts already worked.`;
  }
  return null;
}

// ── Qualification (warning only) ────────────────────────────────────────────

export interface FirstAidQualification {
  source: 'licence' | 'skill';
  name: string;
  expires: string | null;
}

interface QualificationRecord {
  status?: string | null;
  expiration_date?: string | null;
  name: string | null | undefined;
}

const FIRST_AID = /first\s*aid/i;
const LAPSED = new Set(['expired', 'suspended', 'revoked', 'inactive']);

/**
 * First-aid licences and skills current on `onDate`. cl 28.2 requires a
 * qualification, but the records have never been audited (two sources that
 * disagree), so the app WARNS when none is found and never blocks: the pay
 * engine follows the appointment.
 */
export function currentQualifications(
  licences: QualificationRecord[],
  skills: QualificationRecord[],
  onDate: string,
): FirstAidQualification[] {
  const isCurrent = (r: QualificationRecord) =>
    !!r.name && FIRST_AID.test(r.name)
    && !LAPSED.has((r.status ?? '').toLowerCase())
    && (!r.expiration_date || r.expiration_date.slice(0, 10) >= onDate);
  return [
    ...licences.filter(isCurrent).map(r => ({ source: 'licence' as const, name: r.name!, expires: r.expiration_date?.slice(0, 10) ?? null })),
    ...skills.filter(isCurrent).map(r => ({ source: 'skill' as const, name: r.name!, expires: r.expiration_date?.slice(0, 10) ?? null })),
  ];
}

/** Turn a database refusal into a sentence a manager can act on. */
export function describeAppointmentError(error: { code?: string; message?: string } | null | undefined): string {
  switch (error?.code) {
    case '23P01': return 'This overlaps an existing first-aid appointment for this person.';
    case '23514': return 'The end date cannot be before the start date.';
    case '42501': return "You don't have permission to manage this person's first-aid appointments, or you tried to appoint yourself.";
    case 'P0001': return error.message ?? 'The change was refused.';
    default:      return error?.message ?? 'Something went wrong saving the appointment.';
  }
}
