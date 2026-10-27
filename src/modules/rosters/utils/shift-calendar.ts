/**
 * Calendar exports for a single shift: an RFC 5545 .ics file plus Google and
 * Outlook "add event" links. Pure; ported from the t19b-donut fork
 * (6bd75b84 / 8d9a09a4, Jianwei Gao) with one shared description builder and
 * an Outlook link for work accounts.
 */
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import type { Shift } from '@/modules/rosters/domain/shift.entity';

const PRODUCT_ID = '-//Shiftopia//Shift Calendar//EN';
const ICS_LINE_OCTETS = 75;

export interface ShiftCalendarOptions {
  shift: Shift;
  groupName?: string;
  subGroupName?: string;
  /** Where "Open in Shiftopia" points. Omitted from the event when absent. */
  appUrl?: string;
  now?: Date;
}

export interface ShiftCalendarFile {
  content: string;
  filename: string;
}

interface ShiftEvent {
  start: Date;
  end: Date;
  title: string;
  description: string;
  location: string;
}

const escapeIcsText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');

const formatUtc = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const addCalendarDay = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

const validTimestamp = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Canonical UTC instants when stored; otherwise wall clock in the shift's zone. */
const resolveShiftTimes = (shift: Shift) => {
  const timezone = shift.tz_identifier || shift.timezone || SYDNEY_TZ;
  const start = validTimestamp(shift.start_at) ?? parseZonedDateTime(shift.shift_date, shift.start_time, timezone);

  let end = validTimestamp(shift.end_at);
  if (!end) {
    const sameDayEnd = parseZonedDateTime(shift.shift_date, shift.end_time, timezone);
    const crossesMidnight = shift.is_overnight || sameDayEnd.getTime() <= start.getTime();
    end = crossesMidnight
      ? parseZonedDateTime(addCalendarDay(shift.shift_date), shift.end_time, timezone)
      : sameDayEnd;
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    throw new Error('The shift end time must be after its start time.');
  }
  return { start, end };
};

const describeShift = ({ shift, groupName, subGroupName, appUrl }: ShiftCalendarOptions): ShiftEvent => {
  const { start, end } = resolveShiftTimes(shift);
  const teamName = shift.sub_departments?.name || subGroupName;
  const description = [
    shift.departments?.name ? `Department: ${shift.departments.name}` : null,
    teamName ? `Team: ${teamName}` : null,
    appUrl ? `Open in Shiftopia: ${appUrl}` : null,
  ].filter(Boolean).join('\n');

  return {
    start,
    end,
    title: `Shiftopia - ${shift.roles?.name || 'Shift'}`,
    description,
    location: [groupName, teamName].filter(Boolean).join(' - '),
  };
};

/** RFC 5545 content lines are limited to 75 UTF-8 octets, including folds. */
const foldLine = (line: string) => {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk = '';
  let byteLength = 0;

  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    const limit = chunks.length === 0 ? ICS_LINE_OCTETS : ICS_LINE_OCTETS - 1;
    if (chunk && byteLength + characterBytes > limit) {
      chunks.push(chunk);
      chunk = character;
      byteLength = characterBytes;
    } else {
      chunk += character;
      byteLength += characterBytes;
    }
  }

  if (chunk || chunks.length === 0) chunks.push(chunk);
  return chunks.join('\r\n ');
};

export const buildShiftCalendarFile = (options: ShiftCalendarOptions): ShiftCalendarFile => {
  const { shift, appUrl, now = new Date() } = options;
  const event = describeShift(options);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:shift-${shift.id}@shiftopia.app`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatUtc(event.start)}`,
    `DTEND:${formatUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    ...(appUrl ? [`URL:${escapeIcsText(appUrl)}`] : []),
    // Re-importing an edited shift updates the existing event instead of duplicating it.
    `SEQUENCE:${Math.max(0, shift.version || 0)}`,
    `STATUS:${shift.is_cancelled || shift.lifecycle_status === 'Cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const safeRole = (shift.roles?.name || 'shift')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'shift';

  return {
    content: `${lines.map(foldLine).join('\r\n')}\r\n`,
    filename: `shiftopia-${shift.shift_date}-${safeRole}.ics`,
  };
};

export const buildGoogleCalendarUrl = (options: ShiftCalendarOptions): string => {
  const event = describeShift(options);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatUtc(event.start)}/${formatUtc(event.end)}`,
    details: event.description,
    ...(event.location ? { location: event.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

/** Microsoft 365 work/school accounts (consumer Outlook lives on outlook.live.com). */
export const buildOutlookCalendarUrl = (options: ShiftCalendarOptions): string => {
  const event = describeShift(options);
  const params = new URLSearchParams({
    rru: 'addevent',
    subject: event.title,
    startdt: event.start.toISOString(),
    enddt: event.end.toISOString(),
    body: event.description,
    ...(event.location ? { location: event.location } : {}),
  });
  return `https://outlook.office.com/calendar/0/action/compose?${params.toString()}`;
};
