/**
 * EarningsLinesTable — render / prop test.
 *
 * Verifies that a fixture PeriodGrossPay renders:
 *   1. one row per aggregated earnings line (description + hours + amount)
 *   2. a gross total footer row
 *   3. the empty-state row when there are no lines
 *
 * Uses the repo's existing component-test stack (jsdom + @testing-library/react
 * + jest-dom, wired in vitest.config.ts → src/test/setup.ts).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { EarningsLinesTable } from '../ui/EarningsLinesTable';
import type { PeriodGrossPay } from '../model/gross-pay.types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const FIXTURE: PeriodGrossPay = {
  employeeId: 'emp-001',
  periodStart: '2026-07-06',
  periodEnd: '2026-07-12',
  shifts: [], // not read by the table — it renders the aggregated `lines`
  lines: [
    { code: 'ordinary', description: 'Ordinary hours', hours: 30, amount: 900 },
    { code: 'penalty', description: 'Weekend penalty', hours: 8, amount: 120.5 },
    { code: 'overtime', description: 'Overtime', hours: 2, amount: 90 },
    // A per-shift lump line with no hours — must still render.
    { code: 'other_allowance', description: 'Meal allowance', amount: 15.25 },
  ],
  grossPay: 1125.75,
  paidHours: 40,
  shiftCount: 5,
};

const EMPTY_FIXTURE: PeriodGrossPay = {
  employeeId: 'emp-002',
  periodStart: '2026-07-06',
  periodEnd: '2026-07-12',
  shifts: [],
  lines: [],
  grossPay: 0,
  paidHours: 0,
  shiftCount: 0,
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('EarningsLinesTable', () => {
  it('renders one row per earnings line with description, hours and amount', () => {
    render(<EarningsLinesTable period={FIXTURE} />);

    // Descriptions
    expect(screen.getByText('Ordinary hours')).toBeInTheDocument();
    expect(screen.getByText('Weekend penalty')).toBeInTheDocument();
    expect(screen.getByText('Overtime')).toBeInTheDocument();
    expect(screen.getByText('Meal allowance')).toBeInTheDocument();

    // Hours cells (time-based lines show "Nh"; lump line shows an em-dash)
    expect(screen.getByText('30h')).toBeInTheDocument();
    expect(screen.getByText('8h')).toBeInTheDocument();

    // Amounts are formatted en-AU currency.
    expect(screen.getByText('$900.00')).toBeInTheDocument();
    expect(screen.getByText('$120.50')).toBeInTheDocument();
    expect(screen.getByText('$90.00')).toBeInTheDocument();
    expect(screen.getByText('$15.25')).toBeInTheDocument();
  });

  it('renders exactly one body row per line', () => {
    render(<EarningsLinesTable period={FIXTURE} />);
    // 1 header row + 4 body rows + 1 footer row = 6 <tr>
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(6);
  });

  it('renders a gross total row equal to grossPay', () => {
    render(<EarningsLinesTable period={FIXTURE} />);

    const total = screen.getByTestId('gross-total');
    expect(total).toHaveTextContent('$1,125.75');

    // The label lives in the same footer row.
    expect(screen.getByText('Gross pay')).toBeInTheDocument();
  });

  it('renders an empty-state row when there are no lines', () => {
    render(<EarningsLinesTable period={EMPTY_FIXTURE} />);

    expect(screen.getByText('No earnings for this period.')).toBeInTheDocument();
    // Gross total still renders (at $0.00).
    expect(screen.getByTestId('gross-total')).toHaveTextContent('$0.00');
  });

  it('exposes the lump-line (no hours) with an em-dash placeholder', () => {
    render(<EarningsLinesTable period={FIXTURE} />);
    // Find the Meal allowance row and assert its hours cell is the em-dash.
    const mealCell = screen.getByText('Meal allowance');
    const row = mealCell.closest('tr')!;
    expect(within(row).getByText('—')).toBeInTheDocument();
  });
});
