/**
 * ShiftPayLedgerView — what each row state shows in the three pay columns.
 * The unassigned message is a stated requirement (2026-10-09): pay depends on
 * the assignee's contract, so an unassigned shift shows ASSIGN AN EMPLOYEE
 * FIRST instead of any figure.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ShiftPayLedgerView } from '../ui/ShiftPayLedgerView';
import type { ShiftPayLedgerRow } from '../model/pay-ledger.types';

const base = (o: Partial<ShiftPayLedgerRow>): ShiftPayLedgerRow => ({
  shiftId: 'aaaaaaaa-0000-0000-0000-000000000000',
  shiftDate: '2026-07-06',
  startTime: '09:00',
  endTime: '17:00',
  employeeId: 'e1',
  employeeName: 'Sam Lee',
  roleName: 'Usher',
  lifecycleStatus: 'Completed',
  timesheetStatus: null,
  fsm: { lifecycle_status: 'Completed', assignment_status: 'assigned', assignment_outcome: 'confirmed', trading_status: null, is_cancelled: false },
  state: 'priced',
  billableFinal: false,
  ...o,
});

const pricedCell = (amount: number) => ({
  kind: 'priced' as const, amount, hours: 7.5,
  lines: [{ code: 'ordinary' as const, description: 'Ordinary', hours: 7.5, amount }],
});

const rows: ShiftPayLedgerRow[] = [
  base({ shiftId: 'u0000000-x', employeeId: null, employeeName: undefined, state: 'unassigned' }),
  base({ shiftId: 'n0000000-x', state: 'no_contract' }),
  base({ shiftId: 'c0000000-x', state: 'cancelled' }),
  base({
    shiftId: 'p0000000-x',
    scheduled: pricedCell(255.3), actual: pricedCell(263.81), billable: pricedCell(255.3),
  }),
  base({
    shiftId: 's0000000-x', payBasis: 'salary',
    scheduled: { kind: 'salaried', hours: 7.5 }, actual: { kind: 'salaried', hours: 7.5 }, billable: { kind: 'salaried', hours: 7.5 },
  }),
];

const rowFor = (idPrefix: string) => screen.getByTitle(new RegExp(`^${idPrefix}`)).closest('tr')!;

describe('ShiftPayLedgerView', () => {
  it('an unassigned shift shows ASSIGN AN EMPLOYEE FIRST across the pay columns', () => {
    render(<ShiftPayLedgerView rows={rows} periodStart="2026-07-06" periodEnd="2026-07-12" />);
    const cell = within(rowFor('u0000000')).getByText('ASSIGN AN EMPLOYEE FIRST').closest('td')!;
    expect(cell.getAttribute('colspan')).toBe('3');
  });

  it('no contract and cancelled say why there is no figure', () => {
    render(<ShiftPayLedgerView rows={rows} periodStart="2026-07-06" periodEnd="2026-07-12" />);
    expect(within(rowFor('n0000000')).getByText(/NO CONTRACT/)).toBeTruthy();
    expect(within(rowFor('c0000000')).getByText(/Cancelled — not paid/)).toBeTruthy();
  });

  it('a priced shift shows all three figures, unapproved billable flagged', () => {
    render(<ShiftPayLedgerView rows={rows} periodStart="2026-07-06" periodEnd="2026-07-12" />);
    const tr = within(rowFor('p0000000'));
    expect(tr.getAllByText('$255.30')).toHaveLength(2);
    expect(tr.getByText('$263.81')).toBeTruthy();
    expect(tr.getByText('Unverified')).toBeTruthy();
  });

  it('a salaried shift shows no per-shift pay', () => {
    render(<ShiftPayLedgerView rows={rows} periodStart="2026-07-06" periodEnd="2026-07-12" />);
    expect(within(rowFor('s0000000')).getAllByText('Salaried · 7.5h')).toHaveLength(3);
  });

  it('expanding a priced shift itemises each column', () => {
    render(<ShiftPayLedgerView rows={rows} periodStart="2026-07-06" periodEnd="2026-07-12" />);
    fireEvent.click(within(rowFor('p0000000')).getByRole('button', { name: 'Show pay breakdown' }));
    expect(screen.getAllByRole('table', { name: 'Gross earnings breakdown' })).toHaveLength(3);
  });

  it('the Unassigned filter shows only unassigned shifts', () => {
    render(<ShiftPayLedgerView rows={rows} periodStart="2026-07-06" periodEnd="2026-07-12" />);
    fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }));
    expect(screen.getByText('ASSIGN AN EMPLOYEE FIRST')).toBeTruthy();
    // The rows filter; the period totals above them do not.
    expect(screen.queryByTitle(/^p0000000/)).toBeNull();
    expect(screen.queryByTitle(/^s0000000/)).toBeNull();
  });
});
