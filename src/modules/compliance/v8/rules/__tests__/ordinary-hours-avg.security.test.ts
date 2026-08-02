import { describe, it, expect } from 'vitest';
import { ordinaryHoursAvgRule } from '../ordinary-hours-avg';
import { buildContext, buildConsecutiveShifts, resetIdCounter } from './_helpers';

describe('ordinaryHoursAvgRule — Schedule 3 §3 Full-Time Security (audit H-5)', () => {
  it('a genuinely lawful 42h/week Security roster produces zero hits', () => {
    // 56 days (8 weeks) at 6h/day = 336h total, exactly the 8-week/336h
    // Security cap — and exactly 42h in every 7-day window. This same
    // pattern would BLOCK under the general 28-day/152h cap (see the next
    // test), which is the false-positive the audit flagged.
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 42, is_security_role: true },
      shifts: buildConsecutiveShifts(56, '2026-06-01', { start_time: '08:00', end_time: '14:00' }),
    });
    expect(ordinaryHoursAvgRule(ctx)).toEqual([]);
  });

  it('the identical 42h/week pattern WOULD block a general (non-Security) employee', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 42, is_security_role: false },
      shifts: buildConsecutiveShifts(56, '2026-06-01', { start_time: '08:00', end_time: '14:00' }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    const blocking = hits.find(h => h.blocking);
    expect(blocking).toBeDefined();
  });

  it('a Security roster that genuinely exceeds 336h/8-weeks still blocks', () => {
    // 56 days at 8h/day = 448h — well over the 336h Security cycle limit.
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 42, is_security_role: true },
      shifts: buildConsecutiveShifts(56, '2026-06-01', { start_time: '08:00', end_time: '16:00' }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    const blocking = hits.find(h => h.blocking);
    expect(blocking).toBeDefined();
    expect(blocking!.rule_id).toBe('V8_ORD_HOURS_AVG');
    expect(blocking!.details).toContain('Schedule 3');
    expect(blocking!.calculation?.limit).toBe(336);
  });

  it('is_security_role has no effect on a PART_TIME employee (Sch 3 §3 is FT-only)', () => {
    // Same 168h/28-day pattern that blocks general FULL_TIME staff — a
    // PART_TIME security-flagged employee should still be evaluated
    // against the general structure (Sch 3 §5), not get the FT exemption.
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME', contracted_weekly_hours: 20, is_security_role: true },
      shifts: buildConsecutiveShifts(28, '2026-06-01', { start_time: '08:00', end_time: '14:00' }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    const blocking = hits.find(h => h.blocking);
    expect(blocking).toBeDefined();
    expect(blocking!.calculation?.limit).toBe(152);
  });
});
