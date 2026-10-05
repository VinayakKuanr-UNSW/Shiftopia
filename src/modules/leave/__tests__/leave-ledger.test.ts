/**
 * The EBA ledger. Each case is a number someone reads off a card or a Grid
 * cell, so each pins a rule from the Agreement or from the 2026-09-30 decisions.
 */
import { describe, expect, it } from 'vitest';
import { buildLedger, CASUAL_REQUESTABLE, dailyHoursFor, employmentYearStart, entitlementWarnings, lslPosition, LEDGER_TYPES, requestableLeaveTypes, type BuildLedgerInput } from '../domain/leave-ledger';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEAVE_TYPE_LABELS, type LeaveTypeCode } from '../model/leave.types';
import type { LeaveRequest } from '../model/leave.types';

type R = BuildLedgerInput['requests'][number];
const r = (over: Partial<LeaveRequest>): R => ({
    leaveType: 'annual', status: 'approved', requestedHours: 7.6, electionMode: null,
    startDate: '2026-05-04', ...over,
});

function ledger(over: Partial<BuildLedgerInput> = {}) {
    return buildLedger({
        balances: [
            { leaveType: 'annual', balanceHours: 100 },
            { leaveType: 'personal', balanceHours: 40 },
            { leaveType: 'fdv', balanceHours: 76 },
        ],
        requests: [],
        isCasual: false,
        dailyHours: 7.6,
        year: 2026,
        ...over,
    });
}
const entry = (l: ReturnType<typeof ledger>, type: string) => l.find(e => e.def.type === type)!;

describe('LEDGER_TYPES', () => {
    it('covers every leave type the request form offers, once', () => {
        const types = LEDGER_TYPES.map(d => d.type);
        expect(new Set(types).size).toBe(types.length);
        for (const t of ['annual', 'personal', 'carer', 'fdv', 'compassionate', 'long_service', 'parental',
            'supporting_carer', 'jury_duty', 'community_service', 'religious_cultural', 'unpaid', 'gender_affirmation']) {
            expect(types, t).toContain(t);
        }
    });
});

describe('who is entitled', () => {
    it('gives a permanent no casual-only card, and a casual no paid annual or personal', () => {
        const perm = ledger();
        expect(entry(perm, 'annual').applicable).toBe(true);
        expect(entry(perm, 'carer').applicable).toBe(false);

        const cas = ledger({ isCasual: true });
        expect(entry(cas, 'annual').applicable).toBe(false);          // cl 12.5(b)
        expect(entry(cas, 'personal').applicable).toBe(false);
        expect(entry(cas, 'carer').applicable).toBe(true);            // cl 45.6(c)
        expect(entry(cas, 'fdv').applicable).toBe(true);              // cl 46 / NES
        expect(entry(cas, 'compassionate').applicable).toBe(true);    // unpaid, cl 48.8
        expect(entry(cas, 'religious_cultural').applicable).toBe(false); // cl 55.1
    });
});

describe('balance kind', () => {
    it('holds pending against the balance and can go negative', () => {
        const l = ledger({
            balances: [{ leaveType: 'annual', balanceHours: -5 }],
            requests: [r({ status: 'pending', requestedHours: 7.6, startDate: '2027-02-01' })],
        });
        expect(entry(l, 'annual').line).toEqual({ balance: -5, held: 7.6, available: -12.6 });
    });

    it('shows cl 55 leave elected as annual against the ANNUAL card', () => {
        const l = ledger({ requests: [r({ leaveType: 'religious_cultural', status: 'pending', electionMode: 'annual' })] });
        expect(entry(l, 'annual').line?.held).toBe(7.6);
    });

    it('has no line, not a zero, when no balance row exists', () => {
        expect(entry(ledger(), 'long_service').line).toBeNull();
    });
});

describe('capped kind', () => {
    it('measures cl 55 against 5 days a CALENDAR year, in this person\'s hours', () => {
        const l = ledger({
            dailyHours: 4, // a 20h part-timer
            requests: [
                r({ leaveType: 'religious_cultural', requestedHours: 4 }),
                r({ leaveType: 'religious_cultural', status: 'pending', requestedHours: 4 }),
                r({ leaveType: 'religious_cultural', requestedHours: 4, startDate: '2025-12-30' }), // last year
            ],
        });
        const e = entry(l, 'religious_cultural');
        expect(e.capHours).toBe(20);
        expect(e).toMatchObject({ usedHours: 4, pendingHours: 4, remainingHours: 12 });
    });
});

describe('occasion kind', () => {
    it('counts approved occasions this year, not a balance', () => {
        const l = ledger({
            requests: [
                r({ leaveType: 'compassionate', requestedHours: 15.2 }),
                r({ leaveType: 'compassionate', requestedHours: 7.6 }),
                r({ leaveType: 'compassionate', status: 'rejected' }),
            ],
        });
        expect(entry(l, 'compassionate')).toMatchObject({ occasions: 2, usedHours: 22.8, line: null });
    });
});

describe('dailyHoursFor', () => {
    it('is weekly ÷ 5, and 7.6h when the contract is silent', () => {
        expect(dailyHoursFor(38)).toBe(7.6);
        expect(dailyHoursFor(20)).toBe(4);
        expect(dailyHoursFor(null)).toBe(7.6);
    });
});

describe('gender affirmation — one allowance for the whole of employment', () => {
    it('counts every year, not just this one, and never resets', () => {
        const l = ledger({
            requests: [
                r({ leaveType: 'gender_affirmation', requestedHours: 15.2, startDate: '2023-03-01' }),
                r({ leaveType: 'gender_affirmation', requestedHours: 7.6, startDate: '2026-02-01' }),
                r({ leaveType: 'gender_affirmation', status: 'pending', requestedHours: 7.6, startDate: '2027-01-10' }),
            ],
        });
        const e = entry(l, 'gender_affirmation');
        expect(e.def.capPeriod).toBe('tenure');
        expect(e).toMatchObject({ capHours: 76, usedHours: 22.8, pendingHours: 7.6, remainingHours: 45.6 });
    });

    it('merges an all-time read with the recent one without counting a request twice', () => {
        const recent = { ...r({ leaveType: 'gender_affirmation', requestedHours: 7.6 }), id: 'g2' };
        const old = { ...r({ leaveType: 'gender_affirmation', requestedHours: 15.2, startDate: '2022-06-01' }), id: 'g1' };
        const l = ledger({ requests: [recent], tenureRequests: [old, recent] });
        expect(entry(l, 'gender_affirmation').usedHours).toBe(22.8);
    });

    it('leaves cl 55 counted per calendar year', () => {
        const l = ledger({ tenureRequests: [r({ leaveType: 'religious_cultural', startDate: '2024-01-01' })] });
        expect(entry(l, 'religious_cultural').usedHours).toBe(0);
    });
});

describe('requestableLeaveTypes — what a casual may ask for (cl 12.5(b))', () => {
    const all = Object.keys(LEAVE_TYPE_LABELS) as LeaveTypeCode[];

    it('offers a casual only FDV, unpaid carer\'s, unpaid compassionate, community service and LSL', () => {
        expect(requestableLeaveTypes(all, true).sort())
            .toEqual(['carer', 'community_service', 'compassionate', 'fdv', 'long_service']);
    });

    it('offers a permanent every type', () => {
        expect(requestableLeaveTypes(all, false)).toEqual(all);
    });

    it('agrees with the database trigger: every type the trigger refuses is withheld from casuals', () => {
        const sql = readFileSync(resolve(process.cwd(),
            'supabase/migrations/20261001120000_leave_type_eligibility_casuals.sql'), 'utf8');
        const list = sql.match(/NEW\.leave_type NOT IN \(([^)]*)\)/)![1];
        const refused = [...list.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
        expect(refused.length).toBeGreaterThan(0);
        // Refused ∪ casual-requestable = every type, and they never overlap.
        expect(new Set([...refused, ...CASUAL_REQUESTABLE])).toEqual(new Set(all));
        for (const t of refused) expect(CASUAL_REQUESTABLE).not.toContain(t);
    });
});


describe('entitlementWarnings — warned, never blocked', () => {
    const base = { requests: [] as R[], isCasual: false, dailyHours: 7.6, startDate: '2026-11-02' };

    it('cl 55: warns when a request takes more than is left this calendar year', () => {
        const w = entitlementWarnings({
            ...base, leaveType: 'religious_cultural', requestedHours: 15.2,
            requests: [r({ leaveType: 'religious_cultural', requestedHours: 30.4, startDate: '2026-03-02' })],
        });
        expect(w[0]).toMatch(/cl 55 allows 5 days \(38h\) in 2026; 7\.6h is left and 15\.2h is requested/);
    });

    it('cl 55: last year does not count against this year', () => {
        expect(entitlementWarnings({
            ...base, leaveType: 'religious_cultural', requestedHours: 15.2,
            requests: [r({ leaveType: 'religious_cultural', requestedHours: 38, startDate: '2025-03-02' })],
        })).toEqual([]);
    });

    it('cl 58: counts the whole of employment', () => {
        const w = entitlementWarnings({
            ...base, leaveType: 'gender_affirmation', requestedHours: 15.2,
            requests: [r({ leaveType: 'gender_affirmation', requestedHours: 68.4, startDate: '2021-06-01' })],
        });
        expect(w[0]).toMatch(/for the whole of employment; 7\.6h is left/);
    });

    it('does not count the request being reviewed against itself', () => {
        const self = { ...r({ leaveType: 'religious_cultural', status: 'pending', requestedHours: 38 }), id: 'me' };
        expect(entitlementWarnings({
            ...base, leaveType: 'religious_cultural', requestedHours: 38, requests: [self], excludeId: 'me',
        })).toEqual([]);
    });

    it('cl 48: one compassionate request longer than 2 days, with the cl 48.7 route for permanents only', () => {
        const perm = entitlementWarnings({ ...base, leaveType: 'compassionate', requestedHours: 30.4 });
        expect(perm[0]).toMatch(/cl 48 gives 2 days \(15\.2h\) per occasion; 30\.4h is requested\. Up to 2 further days can come from personal leave \(cl 48\.7\)/);
        const cas = entitlementWarnings({ ...base, isCasual: true, leaveType: 'compassionate', requestedHours: 30.4 });
        expect(cas[0]).not.toMatch(/cl 48\.7/);
    });

    it('cl 51.1 / 52.1: warns under 12 months of service at the start date, not at 12', () => {
        expect(entitlementWarnings({ ...base, leaveType: 'parental', requestedHours: 38, serviceStart: '2025-11-03' })[0])
            .toMatch(/12 months' continuous service/);
        expect(entitlementWarnings({ ...base, leaveType: 'parental', requestedHours: 38, serviceStart: '2025-11-02' }))
            .toEqual([]);
        expect(entitlementWarnings({ ...base, leaveType: 'supporting_carer', requestedHours: 38, serviceStart: null }))
            .toEqual([]); // unknown service: nothing to say
    });

    it('says nothing about balance types — their warning is the balance going negative', () => {
        expect(entitlementWarnings({ ...base, leaveType: 'annual', requestedHours: 999 })).toEqual([]);
    });
});

describe('FDV in days per employment year (cl 46.2)', () => {
    it('finds the last service anniversary', () => {
        expect(employmentYearStart('2019-03-15', '2026-10-01')).toBe('2026-03-15');
        expect(employmentYearStart('2019-11-20', '2026-10-01')).toBe('2025-11-20');
        expect(employmentYearStart('2019-10-01', '2026-10-01')).toBe('2026-10-01');
    });

    it('counts weekdays of FDV taken and pending since that anniversary, out of 10', () => {
        const l = ledger({
            serviceStart: '2019-03-15', today: '2026-10-01',
            requests: [
                { ...r({ leaveType: 'fdv', startDate: '2026-04-06' }), endDate: '2026-04-08' },              // Mon–Wed: 3
                { ...r({ leaveType: 'fdv', status: 'pending', startDate: '2026-10-09' }), endDate: '2026-10-12' }, // Fri–Mon: 2
                { ...r({ leaveType: 'fdv', startDate: '2026-02-02' }), endDate: '2026-02-02' },              // last year
            ],
        });
        expect(entry(l, 'fdv').fdvDays).toEqual({ left: 5, taken: 3, pending: 2, yearStart: '2026-03-15' });
    });

    it('a part-timer still gets 10 days, not 76 hours\' worth', () => {
        const l = ledger({ dailyHours: 4, serviceStart: '2020-01-01', today: '2026-10-01' });
        expect(entry(l, 'fdv').fdvDays?.left).toBe(10);
    });

    it('falls back to hours when the employment year is unknown', () => {
        expect(entry(ledger(), 'fdv').fdvDays).toBeUndefined();
    });
});

describe('long service leave (cl 49, NSW LSL Act) — derived from continuous service', () => {
    it('accrues 0.8667 weeks per year of service at weekly hours', () => {
        // 38h full-time, exactly 10 years → 8.667 weeks × 38h = 329.3h.
        const p = lslPosition([], '2016-10-01', '2026-10-01', 38, false);
        expect(p.years).toBe(10);
        expect(p.accruedHours).toBe(329.3);
        expect(p).toMatchObject({ serviceRecorded: true, eligible: true, availableFrom: '2026-10-01', availableHours: 329.3 });
    });

    it('is not available before 10 years, but still shows what has accrued', () => {
        const p = lslPosition([], '2019-10-01', '2026-10-01', 38, false);
        expect(p.eligible).toBe(false);
        expect(p.availableHours).toBe(0);
        expect(p.availableFrom).toBe('2029-10-01');
        expect(p.accruedHours).toBeGreaterThan(230);
    });

    it('takes approved LSL off what is available, and holds pending', () => {
        const p = lslPosition([
            r({ leaveType: 'long_service', requestedHours: 152 }),
            r({ leaveType: 'long_service', status: 'pending', requestedHours: 76 }),
            r({ leaveType: 'long_service', status: 'rejected', requestedHours: 500 }),
        ], '2014-01-01', '2026-10-01', 38, false);
        expect(p.takenHours).toBe(152);
        expect(p.pendingHours).toBe(76);
        expect(p.availableHours).toBe(Math.round((p.accruedHours - 228) * 10) / 10);
    });

    it('calculates NOTHING when continuous service start is not recorded', () => {
        expect(lslPosition([], null, '2026-10-01', 38, false))
            .toMatchObject({ serviceRecorded: false, accruedHours: 0, availableFrom: null, eligible: false });
    });

    it('flags casual figures as estimates (NSW LSL uses average weekly hours)', () => {
        expect(lslPosition([], '2015-01-01', '2026-10-01', 20, true).estimated).toBe(true);
    });

    it('warns on a request before 10 years, beyond what is available, or with no service recorded', () => {
        const base = { requests: [] as R[], isCasual: false, dailyHours: 7.6, leaveType: 'long_service' as const };
        expect(entitlementWarnings({ ...base, requestedHours: 38, startDate: '2026-11-02', serviceStart: '2020-01-01' })[0])
            .toMatch(/available from 2030-01-01/);
        expect(entitlementWarnings({ ...base, requestedHours: 500, startDate: '2026-11-02', serviceStart: '2014-01-01' })[0])
            .toMatch(/of long service leave is available by the start date; 500h is requested/);
        expect(entitlementWarnings({ ...base, requestedHours: 38, startDate: '2026-11-02', serviceStart: '2014-01-01' }))
            .toEqual([]);
        expect(entitlementWarnings({ ...base, requestedHours: 38, startDate: '2026-11-02', serviceStart: null })[0])
            .toMatch(/continuous service start is not recorded/);
    });
});
