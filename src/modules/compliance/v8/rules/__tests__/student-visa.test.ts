import { describe, it, expect } from 'vitest';
import { studentVisaRule } from '../student-visa';
import { maxDailyEngagementsRule } from '../max-daily-engagements';
import { buildContext, buildConsecutiveShifts, resetIdCounter } from './_helpers';

/**
 * Migration Act 1958 (Cth), visa condition 8105 — 48 hours per fortnight.
 *
 * The visa condition is an axis of its own, NOT a `contract_type` value. It
 * used to be modelled as a fifth member of that union, which made the two
 * facts mutually exclusive: setting it erased whether the holder was FT, PT,
 * flexi or casual. The last three tests here are the reason that mattered —
 * they fail if the two axes are ever collapsed back into one.
 */
describe('studentVisaRule', () => {
  it('does not apply to employees without the visa condition', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME' },
      shifts: buildConsecutiveShifts(14, '2026-06-01', {
        start_time: '08:00',
        end_time: '17:00',
      }),
    });
    expect(studentVisaRule(ctx)).toEqual([]);
  });

  it('passes when fortnightly hours are within the 48h limit', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL', is_student_visa: true },
      shifts: buildConsecutiveShifts(6, '2026-06-01', {
        start_time: '09:00',
        end_time: '16:00',
      }),
    });
    expect(studentVisaRule(ctx)).toEqual([]);
  });

  it('blocks when a 14-day window exceeds 48 hours', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL', is_student_visa: true },
      shifts: buildConsecutiveShifts(7, '2026-06-01', {
        start_time: '08:00',
        end_time: '16:00',
      }),
    });
    const hits = studentVisaRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_STUDENT_VISA_LIMIT');
    expect(hits[0].status).toBe('BLOCKING');
    expect(hits[0].calculation?.total_hours).toBeGreaterThan(48);
  });

  it('fires for a FULL-TIME holder — the employment type is not the guard', () => {
    // Under the old single-axis model this case was unrepresentable: marking
    // someone a visa holder overwrote 'FULL_TIME', so the two facts could
    // never be asserted together.
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', is_student_visa: true },
      shifts: buildConsecutiveShifts(7, '2026-06-01', {
        start_time: '08:00',
        end_time: '16:00',
      }),
    });
    expect(studentVisaRule(ctx)).toHaveLength(1);
  });

  it('leaves an explicit false alone', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL', is_student_visa: false },
      shifts: buildConsecutiveShifts(7, '2026-06-01', {
        start_time: '08:00',
        end_time: '16:00',
      }),
    });
    expect(studentVisaRule(ctx)).toEqual([]);
  });
});

describe('the visa condition no longer masks the employment type', () => {
  /**
   * cl 35.4(f) caps a casual at two engagements a day. When the visa condition
   * lived on `contract_type`, a student-visa casual read as 'STUDENT_VISA'
   * rather than 'CASUAL', so this BLOCKING rule — and every other rule scoped
   * to an employment type — silently exempted exactly the cohort most likely
   * to be working multiple short engagements.
   */
  it('still applies cl 35.4(f) to a casual who holds a student visa', () => {
    resetIdCounter();
    const day = '2026-06-01';
    const shift = (id: string, start: string, end: string) => ({
      id,
      date: day,
      shift_date: day,
      start_time: start,
      end_time: end,
      is_ordinary_hours: true,
      is_candidate: true,
    });
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL', is_student_visa: true },
      shifts: [
        shift('a', '06:00', '09:00'),
        shift('b', '11:00', '14:00'),
        shift('c', '16:00', '19:00'),
      ],
    });

    const hits = maxDailyEngagementsRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_MAX_DAILY_ENGAGEMENTS');
  });
});
