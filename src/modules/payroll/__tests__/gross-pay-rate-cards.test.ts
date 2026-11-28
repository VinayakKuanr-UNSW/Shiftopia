/**
 * Gross Pay prices from the organization's PUBLISHED rate cards (Phase 3):
 * each shift, leave day and TOIL payout from its own organization's card in
 * force on its date — and NO_RATE_CARD (unpriced) when there is none, never
 * at another organization's or the embedded ICC rates (multi-organization.md
 * P4/R4). Seeded-ICC ⇄ embedded parity is pinned in rate-card-resolver.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildShiftPayLedger } from '../data/shiftPayLedger';
import { mapShiftRowToGrossPayInput } from '../data/grossPay.read.api';
import { createRateCardScheduleCache } from '../data/ebaRates.read.api';
import { payoutInputFromEntry } from '../data/toilGrossPay';
import { computeShiftGrossPay } from '../domain/computeShiftGrossPay';
import type { GrossPayShiftRow } from '../data/types';
import { ICC_SYDNEY_EA_LOADINGS } from '@/modules/rosters/domain/projections/utils/cost/loadings';
import { toPricedCard, type PricedCard } from '@/modules/rosters/domain/projections/utils/cost/rate-card-resolver';
import { RATE_SCHEDULE } from '@/modules/rosters/domain/projections/utils/cost/rate-schedule';

/** ICC Sydney's FY2026/27 card (= the embedded set, rate-card-resolver.test.ts). */
const ICC_CARD_2026: PricedCard = {
  code: 'ICC-EA-2026-27', validFrom: '2026-07-06', validTo: null, rateSet: RATE_SCHEDULE[1], loadings: ICC_SYDNEY_EA_LOADINGS, trainee: null,
};

const WEEK = { periodStart: '2026-07-06', periodEnd: '2026-07-12' };

/** Another agreement: Level 3 at $32 / $40 casual, a 5h minimum engagement. */
const CUSTOM: PricedCard = toPricedCard({
  code: 'BCEC-EA', validFrom: '2026-01-01', validTo: null,
  rates: [
    { classification: 'LEVEL_1', employmentBasis: 'permanent', ordinaryHourlyRate: 30, paidHourlyRate: 30 },
    { classification: 'LEVEL_1', employmentBasis: 'casual', ordinaryHourlyRate: 30, paidHourlyRate: 37.5 },
    { classification: 'LEVEL_3', employmentBasis: 'permanent', ordinaryHourlyRate: 32, paidHourlyRate: 32 },
    { classification: 'LEVEL_3', employmentBasis: 'casual', ordinaryHourlyRate: 32, paidHourlyRate: 40 },
  ],
  allowances: [],
  loadings: { ...ICC_SYDNEY_EA_LOADINGS, minEngagementMinutes: 300 },
  trainee: null,
})!;

const row = (o: Partial<GrossPayShiftRow> = {}): GrossPayShiftRow => ({
  id: 's1', organization_id: 'org-b', shift_date: '2026-07-06', start_time: '09:00:00', end_time: '17:00:00',
  is_overnight: false, lifecycle_status: 'Completed', assignment_status: 'assigned', attendance_status: 'checked_in',
  actual_start: null, actual_end: null, unpaid_break_minutes: 30, _actualUnpaidBreakMinutes: 30,
  scheduled_length_minutes: 480, remuneration_level: 3, target_employment_type: 'Casual', assigned_employee_id: 'e1',
  roles: { id: 'r1', name: 'Attendant' }, remuneration_levels: { level_number: 3, level_name: 'Level 3' },
  _employmentType: 'casual', _hasActiveContract: true, _timesheet: null,
  ...o,
});

const window = (start: string, end: string, minutes: number) => ({
  startTime: start, endTime: end, rawNetMinutes: minutes, unpaidBreakMinutes: 0, hoursSource: 'scheduled' as const, ignoreNoShow: true,
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-01T00:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('a shift is priced from its organization\'s card', () => {
  it('the card\'s rates: 7.5h Monday casual Level 3 at $40 = $300', () => {
    const input = mapShiftRowToGrossPayInput(row(), window('09:00', '17:00', 450), [CUSTOM])!;
    expect(input.organizationId).toBe('org-b');
    const pay = computeShiftGrossPay(input);
    expect(pay.unpriced).toBeUndefined();
    expect(pay.grossPay).toBe(300);
  });

  it('the card\'s minimum engagement: a 2h casual shift is paid 5h, not ICC\'s 3h', () => {
    const input = mapShiftRowToGrossPayInput(row(), window('09:00', '11:00', 120), [CUSTOM])!;
    expect(input.netMinutes).toBe(300);
    expect(computeShiftGrossPay(input).grossPay).toBe(200);
  });

  it('no card covering the date: unpriced (NO_RATE_CARD), not priced at ICC\'s rates', () => {
    const pay = computeShiftGrossPay(mapShiftRowToGrossPayInput(row(), window('09:00', '17:00', 450), [])!);
    expect(pay.unpriced).toBe(true);
    expect(pay.grossPay).toBe(0);
    expect(pay.lines).toEqual([]);
  });

  it('a card that starts after the shift does not price it', () => {
    const later = { ...CUSTOM, validFrom: '2026-08-01' };
    expect(computeShiftGrossPay(mapShiftRowToGrossPayInput(row(), window('09:00', '17:00', 450), [later])!).unpriced).toBe(true);
  });

  it('salaried work is outside the EA and needs no card', () => {
    const input = { ...mapShiftRowToGrossPayInput(row(), window('09:00', '17:00', 450), [])!, payBasis: 'salary' as const, annualSalary: 90000 };
    expect(computeShiftGrossPay(input).unpriced).toBeUndefined();
  });
});

describe('the ledger says why a shift has no figure', () => {
  it('a priceable column of a shift without a card reads No rate card', () => {
    const [r] = buildShiftPayLedger([row()], WEEK, new Map([['org-b', []]]));
    expect(r.scheduled).toEqual({ kind: 'no_rate_card' });
    expect(r.billable).toEqual({ kind: 'no_clock' }); // still a missing clock first: nothing to price yet
  });

  it('with its organization\'s card the same shift is priced', () => {
    const [r] = buildShiftPayLedger([row()], WEEK, new Map([['org-b', [CUSTOM]]]));
    expect(r.scheduled?.kind).toBe('priced');
  });
});

describe('TOIL payouts follow the same rule', () => {
  const entry = { id: 't1', employee_id: 'e1', entry_type: 'payout', minutes: 240, effective_date: '2026-07-10' };
  const contract = { pay_basis: 'eba_level', employment_status: 'Full-Time', remuneration_level: 3, organization_id: 'org-b' };

  it('priced at the card\'s permanent Level 3 rate', () => {
    const pay = computeShiftGrossPay(payoutInputFromEntry(entry, contract, [CUSTOM]));
    expect(pay.grossPay).toBe(128); // 4h × $32
  });

  it('unpriced without a card', () => {
    expect(computeShiftGrossPay(payoutInputFromEntry(entry, contract, [])).unpriced).toBe(true);
  });
});

describe('each organization\'s cards are read once per pay run', () => {
  it('the cache fetches only organizations it has not seen; an unknown one has no cards', async () => {
    const fetcher = vi.fn(async (ids: readonly string[]) => new Map(ids.map((id) => [id, id === 'org-b' ? [CUSTOM] : []])));
    const cache = createRateCardScheduleCache(fetcher);
    const first = await cache.get(['org-b', 'org-b', 'org-c']);
    const second = await cache.get(['org-b', '']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(['org-b', 'org-c']);
    expect(first.get('org-b')).toEqual([CUSTOM]);
    expect(first.get('org-c')).toEqual([]);
    expect([...second.keys()]).toEqual(['org-b']);
  });
});

describe('two organizations side by side (multi-organization proof)', () => {
  // Ekka (Royal Queensland Show day) — Wed 12 Aug 2026: a public holiday in
  // Brisbane (AU-QLD-BNE), an ordinary Wednesday in Sydney (AU-NSW).
  const EKKA = '2026-08-12';
  const BCEC: PricedCard = { ...CUSTOM, jurisdiction: 'AU-QLD-BNE' };
  const ICC: PricedCard = { ...ICC_CARD_2026, jurisdiction: 'AU-NSW' };
  const schedules = new Map([['org-bcec', [BCEC]], ['org-icc', [ICC]]]);
  const shiftAt = (org: string, id: string) => row({ id, organization_id: org, shift_date: EKKA });

  it('each shift is priced on its own organization\'s card and public holidays', () => {
    const [bcec, icc] = buildShiftPayLedger([shiftAt('org-bcec', 'b1'), shiftAt('org-icc', 'i1')], { periodStart: '2026-08-10', periodEnd: '2026-08-16' }, schedules);
    const b = bcec.scheduled as Extract<typeof bcec.scheduled, { kind: 'priced' }>;
    const i = icc.scheduled as Extract<typeof icc.scheduled, { kind: 'priced' }>;
    // BCEC: casual Level 3 at $40 ($32 ordinary) × (1.25 + 1.5) public holiday, 7.5h = $660.
    expect(b.amount).toBe(660);
    expect(b.lines.some((l) => l.code === 'public_holiday' || /holiday/i.test(l.description))).toBe(true);
    // ICC: an ordinary Wednesday at ICC's own Level 3 casual rate — exactly the embedded engine's price.
    const embedded = computeShiftGrossPay(mapShiftRowToGrossPayInput(shiftAt('org-icc', 'i1'), window('09:00', '17:00', 450))!).grossPay;
    expect(i.amount).toBe(embedded);
    expect(i.amount).toBeLessThan(b.amount);
  });

  it('neither organization is ever priced on the other\'s card', () => {
    const [orphan] = buildShiftPayLedger([shiftAt('org-other', 'o1')], { periodStart: '2026-08-10', periodEnd: '2026-08-16' }, schedules);
    expect(orphan.scheduled).toEqual({ kind: 'no_rate_card' });
  });
});

describe('review fixes: nothing unpriced is hidden or priced at ICC\'s rates', () => {
  it('a salaried TOIL payout is outside the EA and needs no card', () => {
    const entry = { id: 't2', employee_id: 'e2', entry_type: 'payout', minutes: 120, effective_date: '2026-07-10' };
    const salaried = { pay_basis: 'salary', annual_salary: 104000, contracted_weekly_hours: 40, employment_status: 'Full-Time', organization_id: 'org-b' };
    const pay = computeShiftGrossPay(payoutInputFromEntry(entry, salaried, []));
    expect(pay.unpriced).toBeUndefined();
    expect(pay.grossPay).toBe(105.26); // 2h × $104,000 / 52 / 38 (a full-time week)
  });

  it('a trainee on a card without a Schedule 5 schedule is unpriced, not priced at ICC\'s', () => {
    const input = { ...mapShiftRowToGrossPayInput(row(), window('09:00', '17:00', 450), [CUSTOM])!, is_trainee: true, trainee_category: 'junior' as const };
    expect(computeShiftGrossPay(input).unpriced).toBe(true);
  });

  it('a level the card does not carry is unpriced, not a priced $0', () => {
    const input = mapShiftRowToGrossPayInput(row({ remuneration_level: 6, remuneration_levels: { level_number: 6, level_name: 'Level 6' } }), window('09:00', '17:00', 450), [{ ...CUSTOM, rateSet: { ...CUSTOM.rateSet, defaultRate: Number.NaN } }])!;
    expect(computeShiftGrossPay(input).unpriced).toBe(true);
  });

  it('the period says how many shifts are unpriced', async () => {
    const { computeEmployeePeriodGrossPay } = await import('../domain/aggregatePeriodGrossPay');
    const priced = mapShiftRowToGrossPayInput(row({ id: 'p' }), window('09:00', '17:00', 450), [CUSTOM])!;
    const unpriced = mapShiftRowToGrossPayInput(row({ id: 'u', shift_date: '2026-07-07' }), window('09:00', '17:00', 450), [])!;
    const period = computeEmployeePeriodGrossPay('e1', [priced, unpriced], { periodStart: '2026-07-06', periodEnd: '2026-07-12' });
    expect(period.unpricedShiftCount).toBe(1);
    expect(computeEmployeePeriodGrossPay('e1', [priced], { periodStart: '2026-07-06', periodEnd: '2026-07-12' }).unpricedShiftCount).toBeUndefined();
  });
});
