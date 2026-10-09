/**
 * Roll a shift pay ledger up into column totals. Each figure states what it
 * is OVER (priced / salaried / pending counts) — a bare total cannot tell
 * "nothing worked yet" from "nothing could be priced" (pay-cost-engine.md §5).
 */

import type {
  LedgerCell,
  LedgerColumn,
  LedgerColumnSummary,
  LedgerSummary,
  ShiftPayLedgerRow,
} from '../model/pay-ledger.types';

function round2(x: number): number {
  const v = Math.round(x * 100) / 100;
  return v === 0 ? 0 : v;
}

function emptyColumn(): LedgerColumnSummary {
  return { total: 0, priced: 0, salaried: 0, pending: 0 };
}

function addCell(acc: LedgerColumnSummary, cell: LedgerCell | undefined): void {
  if (!cell) return;
  if (cell.kind === 'priced') {
    acc.total += cell.amount;
    acc.priced += 1;
  } else if (cell.kind === 'salaried') {
    acc.salaried += 1;
  } else if (cell.kind !== 'no_show') {
    // A no-show is settled ($0, nothing more to come); the rest are not yet.
    acc.pending += 1;
  }
}

export function summarizeShiftPayLedger(rows: readonly ShiftPayLedgerRow[]): LedgerSummary {
  const columns: Record<LedgerColumn, LedgerColumnSummary> = {
    scheduled: emptyColumn(), actual: emptyColumn(), billable: emptyColumn(),
  };
  let unassigned = 0;
  let noContract = 0;
  let cancelled = 0;
  let payable = 0;
  let unverified = 0;

  for (const row of rows) {
    if (row.state === 'unassigned') unassigned += 1;
    else if (row.state === 'no_contract') noContract += 1;
    else if (row.state === 'cancelled') cancelled += 1;
    if (row.state !== 'priced') continue;

    addCell(columns.scheduled, row.scheduled);
    addCell(columns.actual, row.actual);
    addCell(columns.billable, row.billable);
    if (row.billable?.kind === 'priced') {
      if (row.billableFinal) payable += row.billable.amount;
      else unverified += row.billable.amount;
    }
  }

  for (const c of Object.values(columns)) c.total = round2(c.total);
  return {
    shiftCount: rows.length,
    unassigned,
    noContract,
    cancelled,
    ...columns,
    payable: round2(payable),
    unverified: round2(unverified),
  };
}
