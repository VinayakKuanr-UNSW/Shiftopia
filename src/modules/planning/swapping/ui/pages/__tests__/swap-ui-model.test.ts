import { describe, it, expect } from 'vitest';
import { mapToUIModel } from '../ManagerSwaps.page';

/**
 * The manager swap view states each side's hours and the requester's change
 * in hours. It states no pay — a shift's pay is shown in Gross Pay alone
 * (decision 2026-10-09), even when the API row still carries pay terms.
 */
const shift = (o: Record<string, unknown>) => ({
  shift_date: '2026-10-08', start_time: '09:00', end_time: '12:00',
  shiftDate: '2026-10-08', startTime: '09:00', endTime: '12:00',
  net_length_minutes: 180, netLength: 180, unpaid_break_minutes: 0,
  roles: { name: 'F&B Team Member' },
  ...o,
});

const swap = (requestedShift: Record<string, unknown>) => ({
  id: 'swap-1',
  status: 'MANAGER_PENDING',
  reason: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  original_shift_id: 'own',
  requested_by_employee_id: 'requester',
  swap_with_employee_id: 'holder',
  offered_shift_id: 'theirs',
  originalShift: shift({ id: 'own' }),
  requestedShift: shift({ id: 'theirs', ...requestedShift }),
  requestorEmployee: { fullName: 'Requester' },
  targetEmployee: { fullName: 'Holder' },
  swap_offers: [],
}) as any;

describe('manager swap view model', () => {
  it('states the requester’s change in hours', () => {
    const ui = mapToUIModel(swap({ net_length_minutes: 300, netLength: 300 }));
    expect(ui.requestor.durationNum).toBe(3);
    expect(ui.recipient!.durationNum).toBe(5);
    expect(ui.hoursDiff).toBe(2);
  });

  it('carries no pay figure, whatever the row carries', () => {
    const ui = mapToUIModel(swap({ requester_pay_terms: { base_rate: 43.12 }, shift_pay_terms: { base_rate: 44.92 } }));
    const keys = [...Object.keys(ui), ...Object.keys(ui.requestor), ...Object.keys(ui.recipient!)];
    expect(keys.filter((k) => /pay|rate/i.test(k))).toEqual([]);
  });
});
