import { describe, expect, it } from 'vitest';
import { formatLeaveConflictWarning } from '../domain/leave-conflicts';

describe('formatLeaveConflictWarning', () => {
  it('returns null when there are no conflicts', () => {
    expect(formatLeaveConflictWarning([])).toBeNull();
  });

  it('names a single overlapping shift with its date', () => {
    const msg = formatLeaveConflictWarning([{ shiftDate: '2026-07-07' }]);
    expect(msg).toContain('1 rostered shift overlaps');
    expect(msg).toContain('2026-07-07');
  });

  it('lists at most 3 sorted dates and counts the rest', () => {
    const msg = formatLeaveConflictWarning([
      { shiftDate: '2026-07-10' },
      { shiftDate: '2026-07-07' },
      { shiftDate: '2026-07-08' },
      { shiftDate: '2026-07-09' },
      { shiftDate: '2026-07-09' }, // duplicate date, distinct shift
    ]);
    expect(msg).toContain('5 rostered shifts overlap');
    expect(msg).toContain('2026-07-07, 2026-07-08, 2026-07-09 +1 more');
    expect(msg).not.toContain('2026-07-10');
  });
});
