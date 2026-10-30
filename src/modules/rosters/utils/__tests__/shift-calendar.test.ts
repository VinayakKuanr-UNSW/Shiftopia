import { describe, expect, it } from 'vitest';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import {
  buildShiftCalendarFile,
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
} from '../shift-calendar';

const createShift = (overrides: Partial<Shift> = {}) => ({
  id: '7972e4cc-5857-4bc7-98c1-17d7564dbf44',
  shift_date: '2026-08-03',
  start_time: '09:00:00',
  end_time: '17:00:00',
  start_at: null,
  end_at: null,
  timezone: 'Australia/Sydney',
  tz_identifier: 'Australia/Sydney',
  is_overnight: false,
  is_cancelled: false,
  lifecycle_status: 'Published',
  version: 3,
  roles: { id: 'role-1', name: 'Team Member' },
  departments: { id: 'dept-1', name: 'Event Operations' },
  sub_departments: { id: 'subdept-1', name: 'Convention Services' },
  ...overrides,
} as Shift);

const NOW = new Date('2026-07-28T01:02:03Z');

describe('buildShiftCalendarFile', () => {
  it('creates an importable UTC event with a stable shift UID', () => {
    const result = buildShiftCalendarFile({
      shift: createShift(),
      appUrl: 'https://shiftopia.example/my-roster',
      groupName: 'Convention',
      now: NOW,
    });

    expect(result.filename).toBe('shiftopia-2026-08-03-team-member.ics');
    expect(result.content).toContain('UID:shift-7972e4cc-5857-4bc7-98c1-17d7564dbf44@shiftopia.app');
    expect(result.content).toContain('DTSTAMP:20260728T010203Z');
    // 09:00 AEST (UTC+10) is 23:00 UTC the previous day.
    expect(result.content).toContain('DTSTART:20260802T230000Z');
    expect(result.content).toContain('DTEND:20260803T070000Z');
    expect(result.content).toContain('SUMMARY:Shiftopia - Team Member');
    expect(result.content).toContain('LOCATION:Convention - Convention Services');
    expect(result.content).toContain('URL:https://shiftopia.example/my-roster');
    expect(result.content).toContain('SEQUENCE:3');
    expect(result.content).toContain('STATUS:CONFIRMED');
    expect(result.content.endsWith('\r\n')).toBe(true);
  });

  it('leaves out the app link when there is no public app URL', () => {
    const { content } = buildShiftCalendarFile({ shift: createShift(), now: NOW });

    expect(content).not.toContain('URL:');
    expect(content).not.toContain('Open in Shiftopia');
  });

  it('moves an overnight end time to the next calendar day', () => {
    const { content } = buildShiftCalendarFile({
      shift: createShift({ start_time: '22:30', end_time: '06:15', is_overnight: true }),
      now: NOW,
    });

    expect(content).toContain('DTSTART:20260803T123000Z');
    expect(content).toContain('DTEND:20260803T201500Z');
  });

  it('prefers canonical UTC timestamps and marks cancelled shifts', () => {
    const { content } = buildShiftCalendarFile({
      shift: createShift({
        start_at: '2026-08-03T01:15:00Z',
        end_at: '2026-08-03T09:45:00Z',
        lifecycle_status: 'Cancelled',
        is_cancelled: true,
      }),
      now: NOW,
    });

    expect(content).toContain('DTSTART:20260803T011500Z');
    expect(content).toContain('DTEND:20260803T094500Z');
    expect(content).toContain('STATUS:CANCELLED');
  });

  it('escapes calendar text and folds every physical line to 75 UTF-8 bytes', () => {
    const { content } = buildShiftCalendarFile({
      shift: createShift({
        roles: { id: 'role-1', name: 'Lead, Events; Night \\ Shift 团队团队团队团队团队团队团队团队团队团队' },
      }),
      groupName: 'Convention, Hall; A',
      now: NOW,
    });

    expect(content).toContain('Lead\\, Events\\; Night \\\\ Shift');
    for (const line of content.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('refuses a shift whose end is not after its start', () => {
    expect(() =>
      buildShiftCalendarFile({
        shift: createShift({ start_at: '2026-08-03T09:00:00Z', end_at: '2026-08-03T09:00:00Z' }),
      }),
    ).toThrow('end time must be after');
  });
});

describe('calendar links', () => {
  it('builds a Google Calendar template URL', () => {
    const url = buildGoogleCalendarUrl({ shift: createShift(), groupName: 'Convention' });

    expect(url).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE');
    expect(url).toContain('text=Shiftopia+-+Team+Member');
    expect(url).toContain('dates=20260802T230000Z%2F20260803T070000Z');
  });

  it('builds an Outlook link for Microsoft 365 work accounts', () => {
    const url = buildOutlookCalendarUrl({ shift: createShift(), groupName: 'Convention' });

    expect(url).toContain('https://outlook.office.com/calendar/0/action/compose?rru=addevent');
    expect(url).toContain('subject=Shiftopia+-+Team+Member');
    expect(url).toContain('startdt=2026-08-02T23%3A00%3A00.000Z');
  });
});
