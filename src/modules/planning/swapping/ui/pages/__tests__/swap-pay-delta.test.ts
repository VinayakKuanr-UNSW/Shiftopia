import { describe, it, expect } from 'vitest';
import { mapToUIModel } from '../ManagerSwaps.page';

/**
 * The swap's pay delta sits beside the requester's change in hours, so it is
 * the REQUESTER's: the shift they would receive priced on THEIR contract
 * (requester_pay_terms, from get_prospective_pay_terms), minus the shift they
 * give up. Each party's card still shows its shift under its current holder.
 *
 * Thursday 2026-10-08, 3h shifts. Requester: L4 casual. Requested shift: an
 * L6 shift currently held by an L7 casual. Dollar figures match the budget
 * SQL (internal.shift_cost) for the same shifts.
 */
const terms = (sub: number, paid: number, rate: number) => ({
  pay_basis: 'eba_level', employment_type: 'Casual',
  substantive_level: sub, paid_level: paid, higher_duties: paid > sub, base_rate: rate,
});

const shift = (o: Record<string, unknown>) => ({
  shift_date: '2026-10-08', start_time: '09:00', end_time: '12:00',
  shiftDate: '2026-10-08', startTime: '09:00', endTime: '12:00',
  net_length_minutes: 180, netLength: 180, scheduled_length_minutes: 180, unpaid_break_minutes: 0,
  target_employment_type: 'Casual', roles: { name: 'F&B Team Member' },
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
  originalShift: shift({ id: 'own', remuneration_level: 4, shift_pay_terms: terms(4, 4, 37.82) }),
  requestedShift: shift({ id: 'theirs', ...requestedShift }),
  requestorEmployee: { fullName: 'Requester' },
  targetEmployee: { fullName: 'Holder' },
  swap_offers: [],
}) as any;

describe('manager swap view — pay delta', () => {
  it('prices the received shift on the requester’s contract', () => {
    const ui = mapToUIModel(swap({
      remuneration_level: 6,
      shift_pay_terms: terms(7, 7, 44.92),      // current holder: L7 casual
      requester_pay_terms: terms(4, 6, 43.12),  // requester: L4 doing L6 work
    }));
    expect(ui.requestor.estimatedPay).toBeCloseTo(113.46, 2);
    expect(ui.recipient!.estimatedPay).toBeCloseTo(134.76, 2);  // the holder's pay, unchanged
    expect(ui.payDiff).toBeCloseTo(172.48 - 113.46, 2);          // 4h at L6 (cl 29.1(a)) − own shift
  });

  it('falls back to the shift’s linked terms when the requester’s are not available', () => {
    const ui = mapToUIModel(swap({ remuneration_level: 6, shift_pay_terms: terms(7, 7, 44.92) }));
    expect(ui.payDiff).toBeCloseTo(134.76 - 113.46, 2);
  });
});
