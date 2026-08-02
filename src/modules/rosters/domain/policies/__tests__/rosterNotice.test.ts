import { describe, it, expect } from 'vitest';
import { checkRosterPublishNotice } from '../canPublishRoster.policy';
import { checkShiftChangeNotice } from '../canEditShift.policy';

describe('checkRosterPublishNotice (cl 38.1)', () => {
  // Midnight, so day-counting isn't skewed by a time-of-day offset eating
  // into the boundary day.
  const publishDate = new Date('2026-07-28T00:00:00');

  it('warns when publishing with less than 7 days notice', () => {
    const warning = checkRosterPublishNotice('2026-08-01', publishDate); // 4 days out
    expect(warning).toBeDefined();
    expect(warning).toContain('cl 38.1');
  });

  it('does not warn at exactly 7 days notice', () => {
    const warning = checkRosterPublishNotice('2026-08-04', publishDate); // 7 days out
    expect(warning).toBeUndefined();
  });

  it('does not warn with more than 7 days notice', () => {
    const warning = checkRosterPublishNotice('2026-08-15', publishDate);
    expect(warning).toBeUndefined();
  });

  it('warns when the roster start is already in the past', () => {
    const warning = checkRosterPublishNotice('2026-07-20', publishDate);
    expect(warning).toBeDefined();
  });
});

describe('checkShiftChangeNotice (cl 38.2/38.3)', () => {
  const now = new Date('2026-07-28T09:00:00');

  it('warns for an FT employee changed with less than 48h notice', () => {
    const warning = checkShiftChangeNotice({
      shiftDate: '2026-07-29', // ~24h out
      originalStartTime: '09:00',
      employmentType: 'Full-Time',
      now,
    });
    expect(warning).toBeDefined();
    expect(warning).toContain('cl 38.2');
  });

  it('does not warn for an FT employee changed with 48h+ notice', () => {
    const warning = checkShiftChangeNotice({
      shiftDate: '2026-07-31', // 72h out
      originalStartTime: '09:00',
      employmentType: 'Part-Time',
      now,
    });
    expect(warning).toBeUndefined();
  });

  it('warns for a casual changed with less than 2h notice', () => {
    const warning = checkShiftChangeNotice({
      shiftDate: '2026-07-28',
      originalStartTime: '10:00', // 1h out
      employmentType: 'Casual',
      now,
    });
    expect(warning).toBeDefined();
    expect(warning).toContain('cl 38.3');
  });

  it('does not warn for a casual changed with 2h+ notice', () => {
    const warning = checkShiftChangeNotice({
      shiftDate: '2026-07-28',
      originalStartTime: '12:00', // 3h out
      employmentType: 'Casual',
      now,
    });
    expect(warning).toBeUndefined();
  });

  it('never warns when isEmergency is true, regardless of notice given', () => {
    const warning = checkShiftChangeNotice({
      shiftDate: '2026-07-28',
      originalStartTime: '09:30',
      employmentType: 'Full-Time',
      isEmergency: true,
      now,
    });
    expect(warning).toBeUndefined();
  });

  it('applies the shorter casual threshold, not the FT/PT one, based on employment type', () => {
    // 3h notice: fails FT/PT's 48h bar but should pass casual's 2h bar.
    const casualWarning = checkShiftChangeNotice({
      shiftDate: '2026-07-28',
      originalStartTime: '12:00',
      employmentType: 'Casual',
      now,
    });
    const ftWarning = checkShiftChangeNotice({
      shiftDate: '2026-07-28',
      originalStartTime: '12:00',
      employmentType: 'Full-Time',
      now,
    });
    expect(casualWarning).toBeUndefined();
    expect(ftWarning).toBeDefined();
  });
});
