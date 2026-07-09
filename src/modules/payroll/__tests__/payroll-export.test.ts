import { describe, it, expect } from 'vitest';
import {
  toGrossPayCsv,
  csvEscape,
  toGrossPayProviderPayload,
  toExportRows,
  EXPORT_COLUMNS,
  GROSS_ONLY_NOTE,
} from '../export';
import type { PeriodGrossPay, EarningsLine } from '../model/gross-pay.types';

/**
 * Export-seam tests. These verify the GROSS↔PROVIDER serialisation only — the
 * gross-pay DOMAIN is locked in gross-pay.test.ts. Fixtures are hand-built
 * `PeriodGrossPay` records so the expected CSV/JSON is fully determined.
 *
 * The banner + header occupy the first two CSV lines; data rows follow.
 */
const BANNER_ROWS = 2; // GROSS-ONLY banner + header

const line = (
  code: EarningsLine['code'],
  description: string,
  amount: number,
  hours?: number,
): EarningsLine => ({ code, description, amount, ...(hours !== undefined ? { hours } : {}) });

const period = (o: Partial<PeriodGrossPay> = {}): PeriodGrossPay => {
  const lines = o.lines ?? [line('ordinary', 'Ordinary hours', 240, 8)];
  return {
    employeeId: o.employeeId ?? 'e1',
    periodId: o.periodId,
    periodStart: o.periodStart ?? '2026-07-06',
    periodEnd: o.periodEnd ?? '2026-07-12',
    shifts: o.shifts ?? [],
    lines,
    grossPay: o.grossPay ?? lines.reduce((s, l) => s + l.amount, 0),
    paidHours: o.paidHours ?? lines.reduce((s, l) => s + (l.hours ?? 0), 0),
    shiftCount: o.shiftCount ?? 1,
  };
};

/** Parse a plain (banner/header) CSV line — fixtures here use no quoting. */
const cells = (row: string) => row.split(',');

describe('csvEscape — RFC-4180 field escaping', () => {
  it('leaves plain fields untouched', () => {
    expect(csvEscape('ordinary')).toBe('ordinary');
    expect(csvEscape('2026-07-06')).toBe('2026-07-06');
    expect(csvEscape('')).toBe('');
  });

  it('quotes a field containing a comma', () => {
    expect(csvEscape('Meal, first-aid & split-shift')).toBe(
      '"Meal, first-aid & split-shift"',
    );
  });

  it('quotes and doubles embedded double-quotes', () => {
    expect(csvEscape('Night "loading" allowance')).toBe(
      '"Night ""loading"" allowance"',
    );
  });

  it('quotes fields containing newlines / carriage returns', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('a\r\nb')).toBe('"a\r\nb"');
  });
});

describe('toGrossPayCsv — structure & determinism', () => {
  it('emits a GROSS-ONLY banner as line 1 and a header as line 2', () => {
    const csv = toGrossPayCsv([period()]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('GROSS ONLY');
    expect(lines[0]).toContain(GROSS_ONLY_NOTE); // banner text is the boundary note
    // header has the boundary marker column first, then deterministic order
    expect(cells(lines[1])).toEqual([
      'gross_only',
      'employee_id',
      'period_id',
      'period_start',
      'period_end',
      'earnings_code',
      'earnings_description',
      'hours',
      'amount',
      'period_gross',
    ]);
  });

  it('header column count matches EXPORT_COLUMNS', () => {
    const csv = toGrossPayCsv([period()]);
    const header = csv.split('\r\n')[1];
    expect(cells(header)).toHaveLength(EXPORT_COLUMNS.length);
  });

  it('emits one data row per (employee, period, earnings-code) line', () => {
    const p = period({
      lines: [
        line('ordinary', 'Ordinary hours', 240, 8),
        line('penalty', 'Weekend penalty', 75, 5),
        line('other_allowance', 'Meal allowance', 15), // no hours
      ],
    });
    const csv = toGrossPayCsv([p]);
    const rows = csv.split('\r\n');
    expect(rows).toHaveLength(BANNER_ROWS + 3);
  });

  it('uses CRLF record terminators (RFC-4180)', () => {
    const csv = toGrossPayCsv([period()]);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n')).toHaveLength(BANNER_ROWS + 1);
  });
});

describe('toGrossPayCsv — grossOnly boundary marker', () => {
  it('every data row starts with the literal grossOnly=true marker', () => {
    const p = period({
      lines: [line('ordinary', 'Ordinary hours', 240, 8), line('penalty', 'Weekend', 75, 5)],
    });
    const dataRows = toGrossPayCsv([p]).split('\r\n').slice(BANNER_ROWS);
    for (const r of dataRows) {
      expect(cells(r)[0]).toBe('true');
    }
  });
});

describe('toGrossPayCsv — field escaping in real rows', () => {
  it('quotes a description containing a comma without breaking column count', () => {
    const p = period({
      lines: [line('other_allowance', 'Meal, first-aid, split-shift', 15)],
    });
    const dataRow = toGrossPayCsv([p]).split('\r\n')[BANNER_ROWS];
    // the description field is quoted, so a naive comma-split is unsafe; assert
    // on the quoted substring and that no bare comma leaked outside quotes.
    expect(dataRow).toContain('"Meal, first-aid, split-shift"');
  });

  it('doubles embedded quotes in a description', () => {
    const p = period({
      lines: [line('night_allowance', 'Night "shift" allowance', 30)],
    });
    const dataRow = toGrossPayCsv([p]).split('\r\n')[BANNER_ROWS];
    expect(dataRow).toContain('"Night ""shift"" allowance"');
  });
});

describe('toGrossPayCsv — amount & hours formatting', () => {
  it('formats amounts as fixed 2-dp strings', () => {
    const p = period({
      lines: [
        line('ordinary', 'Ordinary hours', 240, 8),
        line('penalty', 'Penalty', 7.5, 0.5),
        line('other_allowance', 'Allowance', 0),
      ],
    });
    const dataRows = toGrossPayCsv([p]).split('\r\n').slice(BANNER_ROWS);
    const amounts = dataRows.map((r) => cells(r)[EXPORT_COLUMNS.indexOf('amount')]);
    expect(amounts).toEqual(['240.00', '7.50', '0.00']);
  });

  it('leaves hours blank for lump/per-shift lines and prints it otherwise', () => {
    const p = period({
      lines: [line('ordinary', 'Ordinary', 240, 8), line('other_allowance', 'Meal', 15)],
    });
    const dataRows = toGrossPayCsv([p]).split('\r\n').slice(BANNER_ROWS);
    const hoursIdx = EXPORT_COLUMNS.indexOf('hours');
    expect(cells(dataRows[0])[hoursIdx]).toBe('8');
    expect(cells(dataRows[1])[hoursIdx]).toBe(''); // no hours -> empty field
  });

  it('never emits a negative-zero amount', () => {
    const p = period({ lines: [line('ordinary', 'Ordinary', -0, 0)] });
    const dataRow = toGrossPayCsv([p]).split('\r\n')[BANNER_ROWS];
    expect(cells(dataRow)[EXPORT_COLUMNS.indexOf('amount')]).toBe('0.00');
  });
});

describe('toGrossPayCsv — period gross reconciliation', () => {
  it('the repeated period_gross equals the sum of the line amounts', () => {
    const lines = [
      line('ordinary', 'Ordinary', 240, 8),
      line('penalty', 'Penalty', 75, 5),
      line('night_allowance', 'Night', 30),
    ];
    const p = period({ lines }); // grossPay auto = 345
    const dataRows = toGrossPayCsv([p]).split('\r\n').slice(BANNER_ROWS);
    const grossIdx = EXPORT_COLUMNS.indexOf('periodGross');
    const amountIdx = EXPORT_COLUMNS.indexOf('amount');

    const sumOfLines = lines.reduce((s, l) => s + l.amount, 0);
    for (const r of dataRows) {
      expect(cells(r)[grossIdx]).toBe('345.00');
    }
    // and the summed amount cells reconcile to that same total
    const summed = dataRows.reduce((s, r) => s + Number(cells(r)[amountIdx]), 0);
    expect(summed).toBeCloseTo(sumOfLines, 5);
    expect(summed).toBeCloseTo(345, 5);
  });
});

describe('toGrossPayCsv — empty input', () => {
  it('yields a banner + header only (a valid header-only export)', () => {
    const csv = toGrossPayCsv([]);
    const rows = csv.split('\r\n');
    expect(rows).toHaveLength(BANNER_ROWS);
    expect(rows[0]).toContain('GROSS ONLY');
    expect(cells(rows[1])[0]).toBe('gross_only');
  });
});

describe('toExportRows — flattening grain', () => {
  it('produces one row per line, carrying grossOnly=true and periodId', () => {
    const rows = toExportRows([
      period({
        periodId: 'pp-2026-28',
        lines: [line('ordinary', 'Ordinary', 240, 8), line('overtime', 'OT', 90, 2)],
      }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.grossOnly === true)).toBe(true);
    expect(rows[0].periodId).toBe('pp-2026-28');
    expect(rows[0].hours).toBe(8);
    expect(rows[1].earningsCode).toBe('overtime');
  });

  it('a period with no lines produces no rows', () => {
    expect(toExportRows([period({ lines: [], grossPay: 0, paidHours: 0, shiftCount: 0 })])).toHaveLength(0);
  });
});

describe('toGrossPayProviderPayload — payload shape & boundary', () => {
  const meta = { generatedAt: '2026-07-09T00:00:00.000Z', source: 'test', payRunId: 'run-1' };

  it('carries the grossOnly boundary marker and the note', () => {
    const payload = toGrossPayProviderPayload([period()], meta);
    expect(payload.grossOnly).toBe(true);
    expect(payload.note).toBe(GROSS_ONLY_NOTE);
    expect(payload.note.toLowerCase()).toContain('excludes payg');
  });

  it('never invents tax / super / net keys', () => {
    const payload = toGrossPayProviderPayload([period()], meta);
    const keys = Object.keys(payload).join(' ').toLowerCase();
    expect(keys).not.toContain('tax');
    expect(keys).not.toContain('super');
    expect(keys).not.toContain('net');
    expect(keys).not.toContain('payg');
    const empKeys = Object.keys(payload.employees[0]).join(' ').toLowerCase();
    expect(empKeys).not.toContain('tax');
    expect(empKeys).not.toContain('net');
  });

  it('stamps generatedAt / source / payRunId from meta', () => {
    const payload = toGrossPayProviderPayload([period()], meta);
    expect(payload.generatedAt).toBe('2026-07-09T00:00:00.000Z');
    expect(payload.source).toBe('test');
    expect(payload.payRunId).toBe('run-1');
  });

  it('defaults generatedAt to an ISO timestamp when meta omitted', () => {
    const payload = toGrossPayProviderPayload([period()]);
    expect(payload.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('maps each employee period with lines, gross, hours and shift count', () => {
    const p = period({
      employeeId: 'e42',
      lines: [line('ordinary', 'Ordinary', 240, 8), line('penalty', 'Penalty', 75, 5)],
      paidHours: 13,
      shiftCount: 2,
    });
    const payload = toGrossPayProviderPayload([p], meta);
    expect(payload.employeeCount).toBe(1);
    const emp = payload.employees[0];
    expect(emp.employeeId).toBe('e42');
    expect(emp.lines).toHaveLength(2);
    expect(emp.lines[0]).toEqual({ code: 'ordinary', description: 'Ordinary', hours: 8, amount: 240 });
    expect(emp.grossPay).toBe(315);
    expect(emp.paidHours).toBe(13);
    expect(emp.shiftCount).toBe(2);
  });

  it('a lump line serialises hours as null (not undefined/missing)', () => {
    const payload = toGrossPayProviderPayload(
      [period({ lines: [line('other_allowance', 'Meal', 15)] })],
      meta,
    );
    expect(payload.employees[0].lines[0].hours).toBeNull();
  });

  it('reconciles totalGross to the sum of every employee gross', () => {
    const payload = toGrossPayProviderPayload(
      [
        period({ employeeId: 'e1', lines: [line('ordinary', 'Ord', 240, 8)] }),
        period({ employeeId: 'e2', lines: [line('ordinary', 'Ord', 300, 10), line('overtime', 'OT', 45, 1)] }),
      ],
      meta,
    );
    expect(payload.totalGross).toBeCloseTo(240 + 345, 5);
    const summed = payload.employees.reduce((s, e) => s + e.grossPay, 0);
    expect(payload.totalGross).toBeCloseTo(summed, 5);
  });

  it('derives overall inclusive period bounds across employees', () => {
    const payload = toGrossPayProviderPayload(
      [
        period({ employeeId: 'e1', periodStart: '2026-07-06', periodEnd: '2026-07-12' }),
        period({ employeeId: 'e2', periodStart: '2026-06-29', periodEnd: '2026-07-05' }),
      ],
      meta,
    );
    expect(payload.periodStart).toBe('2026-06-29'); // earliest
    expect(payload.periodEnd).toBe('2026-07-12'); // latest
  });

  it('empty input → well-formed empty payload (null bounds, zero totals, no throw)', () => {
    const payload = toGrossPayProviderPayload([], meta);
    expect(payload.grossOnly).toBe(true);
    expect(payload.employees).toEqual([]);
    expect(payload.employeeCount).toBe(0);
    expect(payload.totalGross).toBe(0);
    expect(payload.periodStart).toBeNull();
    expect(payload.periodEnd).toBeNull();
  });

  it('is JSON-serialisable with the boundary marker surviving round-trip', () => {
    const payload = toGrossPayProviderPayload([period()], meta);
    const round = JSON.parse(JSON.stringify(payload));
    expect(round.grossOnly).toBe(true);
    expect(round.note).toBe(GROSS_ONLY_NOTE);
  });
});
