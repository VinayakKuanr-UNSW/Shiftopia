/**
 * AUDIT FIX regression test: a FINISHED shift (scheduled end passed) with no
 * manager edit and no actual clock-OUT (employee forgot to tap out) must not
 * be approvable. Before this fix, `bulkUpdateTimesheetStatus` — wired to the
 * Timesheets page's Bulk Approve button — set status='approved' with zero
 * validation, and the payroll read adapter then silently priced the missing
 * side from the SCHEDULED end time, paying the full rostered shift with no
 * record the clock-out never happened.
 *
 * Mock strategy mirrors planning/unified/__tests__ — a FIFO Supabase mock via
 * vi.hoisted() so `updateTimesheetEntry`'s `supabase.from(...)` calls resolve
 * in the exact order the function issues them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSupabaseMock } from './helpers/supabase-mock';

const { ctx, supabaseProxy } = vi.hoisted(() => {
  const ctx = { mock: null as any };
  return {
    ctx,
    supabaseProxy: new Proxy({} as any, {
      get(_: any, p: string) { return ctx.mock.client[p]; },
    }),
  };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: supabaseProxy }));

import { updateTimesheetEntry, bulkUpdateTimesheetStatus, TimesheetConflictError } from '../timesheets.supabase.api';

beforeEach(() => {
  ctx.mock = createSupabaseMock();
});

const FINISHED_SHIFT_ROW = {
  attendance_status: null,
  start_time: '09:00',
  end_time: '17:00',
  actual_start: '2024-01-01T09:07:00Z',
  actual_end: null, // never clocked out
  shift_date: '2024-01-01', // safely in the past
};

describe('updateTimesheetEntry — approval completeness guard', () => {
  it('refuses to approve a finished shift with a missing clock-out and no manager edit', async () => {
    ctx.mock.enqueue(
      { data: null, error: null },        // 1. existing timesheet lookup (none yet)
      { data: FINISHED_SHIFT_ROW, error: null }, // 2. shift lookup
    );

    const result = await updateTimesheetEntry('shift-1', { status: 'approved', notes: 'bulk approve' });

    expect(result).toBe(false);
    // No DB write should have been attempted beyond the two reads.
    expect(ctx.mock.client.from).toHaveBeenCalledTimes(2);
  });

  it('allows approval once the manager supplies the missing side in the same call', async () => {
    ctx.mock.enqueue(
      { data: null, error: null },                // 1. existing timesheet lookup
      { data: FINISHED_SHIFT_ROW, error: null },  // 2. shift lookup
      { data: { ...FINISHED_SHIFT_ROW, assigned_employee_id: 'emp-1' }, error: null }, // 3. shift refetch for insert
      { error: null },                             // 4. timesheets insert
      { data: { lifecycle_status: 'Published' }, error: null }, // 5. lifecycle check
      { error: null },                             // 6. shift → Completed update
    );

    const result = await updateTimesheetEntry('shift-1', { status: 'approved', adjustedEnd: '17:00' });

    expect(result).toBe(true);
  });

  it('refuses to approve when the clock-IN is the missing side', async () => {
    ctx.mock.enqueue(
      { data: null, error: null },
      { data: { ...FINISHED_SHIFT_ROW, actual_start: null, actual_end: '2024-01-01T17:05:00Z' }, error: null },
    );

    const result = await updateTimesheetEntry('shift-1', { status: 'approved' });

    expect(result).toBe(false);
  });

  it('does not block approval for a shift with both sides resolved from real clock data', async () => {
    ctx.mock.enqueue(
      { data: null, error: null },
      { data: { ...FINISHED_SHIFT_ROW, actual_end: '2024-01-01T17:05:00Z' }, error: null },
      { data: { ...FINISHED_SHIFT_ROW, assigned_employee_id: 'emp-1' }, error: null },
      { error: null },
      { data: { lifecycle_status: 'Published' }, error: null },
      { error: null },
    );

    const result = await updateTimesheetEntry('shift-1', { status: 'approved' });

    expect(result).toBe(true);
  });
});

describe('updateTimesheetEntry — metadata edits on a finalized timesheet (audit H-12)', () => {
  const APPROVED_EXISTING = { id: 'ts-1', status: 'approved', start_time: null, end_time: null };
  const RESOLVED_SHIFT = { ...FINISHED_SHIFT_ROW, actual_end: '2024-01-01T17:05:00Z' };

  it('persists a notes-only edit on an already-approved timesheet instead of silently no-opping', async () => {
    ctx.mock.enqueue(
      { data: APPROVED_EXISTING, error: null },     // 1. existing timesheet lookup
      { data: RESOLVED_SHIFT, error: null },        // 2. shift lookup
      { data: [{ id: 'ts-1' }], error: null },       // 3. the notes UPDATE actually fires
    );

    const result = await updateTimesheetEntry('shift-1', { notes: 'Corrected a typo in my earlier note' });

    expect(result).toBe(true);
    // Must have reached the write (3 `from` calls), not stopped at the two reads.
    expect(ctx.mock.client.from).toHaveBeenCalledTimes(3);
  });

  it('persists a rejectedReason-only edit on an already-rejected timesheet', async () => {
    ctx.mock.enqueue(
      { data: { ...APPROVED_EXISTING, status: 'rejected' }, error: null },
      { data: RESOLVED_SHIFT, error: null },
      { data: [{ id: 'ts-1' }], error: null },
    );

    const result = await updateTimesheetEntry('shift-1', { rejectedReason: 'Updated: wrong break duration logged' });

    expect(result).toBe(true);
    expect(ctx.mock.client.from).toHaveBeenCalledTimes(3);
  });

  it('still blocks a pay-affecting field riding along with notes, and reports it honestly (false, not true)', async () => {
    ctx.mock.enqueue(
      { data: APPROVED_EXISTING, error: null },
      { data: RESOLVED_SHIFT, error: null },
    );

    const result = await updateTimesheetEntry('shift-1', { notes: 'sneaking in a clock edit', clockIn: '2024-01-01T09:00:00Z' } as any);

    expect(result).toBe(false);
    // Blocked before any write was attempted.
    expect(ctx.mock.client.from).toHaveBeenCalledTimes(2);
  });

  it('still blocks a bare status-flip attempt with no metrics/metadata, and reports it honestly', async () => {
    ctx.mock.enqueue(
      { data: APPROVED_EXISTING, error: null },
      { data: RESOLVED_SHIFT, error: null },
    );

    const result = await updateTimesheetEntry('shift-1', { status: 'submitted' });

    expect(result).toBe(false);
    expect(ctx.mock.client.from).toHaveBeenCalledTimes(2);
  });
});

describe('updateTimesheetEntry — payroll-exported terminal lock (audit H-13)', () => {
  const EXPORTED_SHIFT_ROW = { ...FINISHED_SHIFT_ROW, actual_end: '2024-01-01T17:05:00Z', payroll_exported: true };

  it('refuses even a notes-only edit once the shift has been exported to payroll', async () => {
    ctx.mock.enqueue(
      { data: { id: 'ts-1', status: 'approved', start_time: null, end_time: null }, error: null }, // 1. existing timesheet
      { data: EXPORTED_SHIFT_ROW, error: null }, // 2. shift lookup — payroll_exported: true
    );

    const result = await updateTimesheetEntry('shift-1', { notes: 'trying to annotate a paid record' });

    expect(result).toBe(false);
    // Blocked immediately after the two reads — no write attempted.
    expect(ctx.mock.client.from).toHaveBeenCalledTimes(2);
  });

  it('refuses a metrics edit (adjustedStart) once exported — stricter than the ordinary approved-record guard', async () => {
    ctx.mock.enqueue(
      { data: { id: 'ts-1', status: 'approved', start_time: null, end_time: null }, error: null },
      { data: EXPORTED_SHIFT_ROW, error: null },
    );

    const result = await updateTimesheetEntry('shift-1', { adjustedStart: '09:15' });

    expect(result).toBe(false);
    expect(ctx.mock.client.from).toHaveBeenCalledTimes(2);
  });

  it('does not block a not-yet-exported shift (payroll_exported: false/undefined) — regression guard', async () => {
    ctx.mock.enqueue(
      { data: { id: 'ts-1', status: 'approved', start_time: null, end_time: null }, error: null },
      { data: { ...EXPORTED_SHIFT_ROW, payroll_exported: false }, error: null },
      { data: [{ id: 'ts-1' }], error: null },
    );

    const result = await updateTimesheetEntry('shift-1', { notes: 'still editable' });

    expect(result).toBe(true);
  });
});

describe('bulkUpdateTimesheetStatus — optimistic-lock CAS per row (audit M-14)', () => {
  const SUBMITTED = (version: number) => ({ id: 'ts-x', status: 'submitted', start_time: null, end_time: null, version });
  const RESOLVED_SHIFT = { ...FINISHED_SHIFT_ROW, actual_end: '2024-01-01T17:05:00Z' };

  it('rejects the whole batch call gracefully when one row has a stale version, counting it as conflicted (not failed)', async () => {
    ctx.mock.enqueue(
      // shift-1: existing version 3, caller supplies matching expectedVersion 3.
      { data: SUBMITTED(3), error: null },
      { data: RESOLVED_SHIFT, error: null },
      { data: [{ id: 'ts-x' }], error: null }, // UPDATE ... WHERE version = 3 → 1 row
      // shift-2: existing version 3, caller supplies a STALE expectedVersion 1.
      { data: SUBMITTED(3), error: null },
      { data: RESOLVED_SHIFT, error: null },
      { data: [], error: null }, // UPDATE ... WHERE version = 1 → 0 rows (stale)
    );

    const result = await bulkUpdateTimesheetStatus(
      ['shift-1', 'shift-2'],
      'manager-1',
      'rejected',
      { 'shift-1': 3, 'shift-2': 1 },
    );

    expect(result.success).toBe(1);
    expect(result.conflicted).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('preserves legacy last-write-wins behaviour when no version map is supplied', async () => {
    ctx.mock.enqueue(
      { data: SUBMITTED(3), error: null },
      { data: RESOLVED_SHIFT, error: null },
      { data: [{ id: 'ts-x' }], error: null },
    );

    const result = await bulkUpdateTimesheetStatus(['shift-1'], 'manager-1', 'rejected');
    expect(result.success).toBe(1);
    expect(result.conflicted).toBe(0);
  });
});

describe('updateTimesheetEntry — optimistic concurrency (F18)', () => {
  const EXISTING = { id: 'ts-1', status: 'submitted', start_time: null, end_time: null, version: 3 };
  const RESOLVED_SHIFT = { ...FINISHED_SHIFT_ROW, actual_end: '2024-01-01T17:05:00Z' };

  it('throws TimesheetConflictError when the CAS matches zero rows (stale version)', async () => {
    ctx.mock.enqueue(
      { data: EXISTING, error: null },        // 1. existing timesheet (version 3)
      { data: RESOLVED_SHIFT, error: null },  // 2. shift lookup
      { data: [], error: null },              // 3. UPDATE ... .eq('version', stale).select('id') → no row
    );

    await expect(
      updateTimesheetEntry('shift-1', { adjustedStart: '09:15' }, { expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(TimesheetConflictError);
  });

  it('succeeds when the CAS matches the loaded version', async () => {
    ctx.mock.enqueue(
      { data: EXISTING, error: null },              // 1. existing timesheet
      { data: RESOLVED_SHIFT, error: null },        // 2. shift lookup
      { data: [{ id: 'ts-1' }], error: null },      // 3. UPDATE ... .select('id') → one row
    );

    const result = await updateTimesheetEntry('shift-1', { adjustedStart: '09:15' }, { expectedVersion: 3 });
    expect(result).toBe(true);
  });

  it('skips the CAS entirely when no expectedVersion is supplied (legacy/bulk path)', async () => {
    ctx.mock.enqueue(
      { data: EXISTING, error: null },
      { data: RESOLVED_SHIFT, error: null },
      { data: [], error: null },  // empty, but ignored because no expectedVersion
    );

    // No conflict thrown even though the update returned no rows.
    const result = await updateTimesheetEntry('shift-1', { adjustedStart: '09:15' });
    expect(result).toBe(true);
  });
});
