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
    // 2026-06-15 opens an eight-week Security cycle, which is exactly 56 days.
    // Worked end to end at 8h/day that is 448h against the 336h ceiling.
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 42, is_security_role: true },
      shifts: buildConsecutiveShifts(56, '2026-06-15', { start_time: '08:00', end_time: '16:00' }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    const blocking = hits.find(h => h.blocking);
    expect(blocking).toBeDefined();
    expect(blocking!.rule_id).toBe('V8_ORD_HOURS_AVG');
    expect(blocking!.details).toContain('Schedule 3');
    expect(blocking!.calculation?.limit).toBe(336);
  });

  it('is_security_role has no effect on a PART_TIME employee (Sch 3 §3 is FT-only)', () => {
    // Same 168h-in-one-cycle pattern that blocks general FULL_TIME staff — a
    // PART_TIME security-flagged employee should still be evaluated against the
    // general structure (Sch 3 §5), not get the FT exemption. 2026-05-18 opens
    // the four-week cycle, so all 28 days sit inside it.
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME', contracted_weekly_hours: 20, is_security_role: true },
      shifts: buildConsecutiveShifts(28, '2026-05-18', { start_time: '08:00', end_time: '14:00' }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    const blocking = hits.find(h => h.blocking);
    expect(blocking).toBeDefined();
    expect(blocking!.calculation?.limit).toBe(152);
  });
});
