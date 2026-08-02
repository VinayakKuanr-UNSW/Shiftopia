import { describe, it, expect } from 'vitest';
import { restPauseRule } from '../rest-pause';
import { buildContext, buildShift } from './_helpers';

describe('restPauseRule (cl 37)', () => {
  it('does not fire for a shift under 4 hours', () => {
    const ctx = buildContext({
      shifts: [buildShift({ start_time: '09:00', end_time: '12:30' })],
    });
    expect(restPauseRule(ctx)).toEqual([]);
  });

  it('warns once (first rest pause) for a shift of exactly 4 hours', () => {
    const ctx = buildContext({
      shifts: [buildShift({ start_time: '09:00', end_time: '13:00' })],
    });
    const hits = restPauseRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_REST_PAUSE');
    expect(hits[0].status).toBe('WARNING');
    expect(hits[0].blocking).toBe(false);
    expect(hits[0].summary).toContain('cl 37.1');
  });

  it('warns twice (both rest pauses) for a shift of 8+ hours', () => {
    const ctx = buildContext({
      shifts: [buildShift({ start_time: '07:00', end_time: '15:00' })],
    });
    const hits = restPauseRule(ctx);
    expect(hits).toHaveLength(2);
    expect(hits[1].summary).toContain('cl 37.2');
  });

  it('does not fire for a shift just under 4 hours', () => {
    const ctx = buildContext({
      shifts: [buildShift({ start_time: '09:00', end_time: '12:59' })],
    });
    expect(restPauseRule(ctx)).toEqual([]);
  });

  it('does not re-validate committed history (is_candidate: false)', () => {
    const ctx = buildContext({
      shifts: [buildShift({ start_time: '07:00', end_time: '15:00', is_candidate: false })],
    });
    expect(restPauseRule(ctx)).toEqual([]);
  });
});
