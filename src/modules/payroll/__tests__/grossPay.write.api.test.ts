/**
 * Audit H-13: shifts.payroll_exported and pay_periods 'locked' status had no
 * writer anywhere in the app — the payroll-safety terminal state the vestigial
 * in-memory timesheet API's 'LOCKED' status was standing in for never actually
 * existed on the live (Supabase) write path. These are the writers that close
 * that gap. FIFO Supabase mock mirrors the pattern in
 * timesheets/api/__tests__/helpers/supabase-mock.ts — queue responses in the
 * exact order the function under test issues its `supabase.from(...)` calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type MockResult = { data?: unknown; error?: { message: string } | null };

const { ctx } = vi.hoisted(() => {
  const ctx = { queue: [] as MockResult[], from: null as any, updateCalls: [] as unknown[] };
  return { ctx };
});

vi.mock('@/platform/supabase/client', () => {
  const dequeue = (): MockResult => {
    const next = ctx.queue.shift();
    return next ?? { data: null, error: null };
  };
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      update: (payload: unknown) => { ctx.updateCalls.push(payload); return chain; },
      eq: () => chain,
      in: () => chain,
      select: () => chain,
      then: (resolve: (v: MockResult) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(dequeue()).then(resolve as (v: MockResult) => MockResult, reject),
    };
    return chain;
  };
  ctx.from = vi.fn().mockImplementation(() => makeChain());
  return { supabase: { from: ctx.from } };
});

import { markShiftsPayrollExported, finalizePayPeriod } from '../data/grossPay.write.api';

beforeEach(() => {
  ctx.queue = [];
  ctx.updateCalls = [];
  ctx.from.mockClear();
});

describe('markShiftsPayrollExported', () => {
  it('marks shifts.payroll_exported (the SoT the DB trigger syncs FROM) then stamps provenance separately', async () => {
    ctx.queue.push(
      { data: [{ id: 's1' }, { id: 's2' }], error: null }, // 1. shifts UPDATE ... SET payroll_exported = true
      { data: null, error: null },                          // 2. shift_payroll_records provenance stamp
    );

    const count = await markShiftsPayrollExported(['s1', 's2'], 'manager-1');

    expect(count).toBe(2);
    expect(ctx.from).toHaveBeenNthCalledWith(1, 'shifts');
    expect(ctx.from).toHaveBeenNthCalledWith(2, 'shift_payroll_records');
    // The SoT write only ever sets the flag itself — never fabricates actuals.
    expect(ctx.updateCalls[0]).toEqual({ payroll_exported: true });
    // Provenance (who/when) is stamped separately, on shift_payroll_records only.
    expect(ctx.updateCalls[1]).toMatchObject({ payroll_exported_by: 'manager-1' });
  });

  it('is a no-op for an empty shift list (no Supabase calls)', async () => {
    const count = await markShiftsPayrollExported([]);
    expect(count).toBe(0);
    expect(ctx.from).not.toHaveBeenCalled();
  });

  it('still returns the exported count even when the provenance stamp fails (non-fatal)', async () => {
    ctx.queue.push(
      { data: [{ id: 's1' }], error: null },
      { data: null, error: { message: 'schema cache miss' } },
    );

    const count = await markShiftsPayrollExported(['s1']);
    expect(count).toBe(1);
  });

  it('throws when the shifts.payroll_exported write itself fails — this IS the safety-critical write', async () => {
    ctx.queue.push({ data: null, error: { message: 'RLS denied' } });
    await expect(markShiftsPayrollExported(['s1'])).rejects.toThrow(/RLS denied/);
  });
});

describe('finalizePayPeriod', () => {
  it('transitions pay_periods.status to locked and stamps who/when', async () => {
    ctx.queue.push({ data: [{ id: 'pp1' }], error: null });
    const result = await finalizePayPeriod('pp1', 'manager-1');
    expect(result).toBe(true);
    expect(ctx.from).toHaveBeenCalledWith('pay_periods');
  });

  it('never transitions to paid — that confirmation is out of this GROSS-pay-only scope', async () => {
    ctx.queue.push({ data: [{ id: 'pp1' }], error: null });
    await finalizePayPeriod('pp1', 'manager-1');
    expect(ctx.updateCalls).toHaveLength(1);
    expect(ctx.updateCalls[0]).toMatchObject({ status: 'locked', locked_by: 'manager-1' });
    expect((ctx.updateCalls[0] as any).status).not.toBe('paid');
  });

  it('returns false when no row matched', async () => {
    ctx.queue.push({ data: [], error: null });
    const result = await finalizePayPeriod('nonexistent');
    expect(result).toBe(false);
  });

  it('throws on a Supabase error', async () => {
    ctx.queue.push({ data: null, error: { message: 'not found' } });
    await expect(finalizePayPeriod('pp1')).rejects.toThrow(/not found/);
  });
});
