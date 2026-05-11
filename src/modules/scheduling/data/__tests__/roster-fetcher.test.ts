/**
 * RosterFetcher tests.
 *
 * Phase 2 extracted the Supabase data-loading concerns into this
 * module. Tests verify:
 *
 *   - Pure utility functions (normalizeTime, shiftDate, durationMinutes)
 *   - Bulk-RPC happy path returns mapped ExistingShiftRefs
 *   - Bulk-RPC failure falls back to per-employee chunked fetch
 *   - Availability fetcher correctly distinguishes "no data on file"
 *     (universally available) from "has data but none in window"
 *     (universally unavailable for this window)
 *   - Candidate shifts are excluded from the existing-roster context
 *     so the solver doesn't see them as "already-assigned"
 */
import { describe, expect, it, vi } from 'vitest';
import {
    RosterFetcher,
    normalizeTime,
    shiftDate,
    durationMinutes,
} from '../roster-fetcher';
import type { ShiftMeta, EmployeeMeta } from '../../optimizer/solution-parser';

// ---------------------------------------------------------------------------
// Pure utility tests
// ---------------------------------------------------------------------------

describe('RosterFetcher pure utilities', () => {
    describe('normalizeTime', () => {
        it('drops seconds from HH:MM:SS', () => {
            expect(normalizeTime('09:30:00')).toBe('09:30');
        });
        it('passes through HH:MM unchanged', () => {
            expect(normalizeTime('09:30')).toBe('09:30');
        });
        it('returns falsy input as-is', () => {
            expect(normalizeTime('')).toBe('');
        });
    });

    describe('shiftDate', () => {
        it('adds days within month', () => {
            expect(shiftDate('2026-05-15', 3)).toBe('2026-05-18');
        });
        it('subtracts days across month boundary', () => {
            expect(shiftDate('2026-05-01', -1)).toBe('2026-04-30');
        });
        it('handles month rollover forward', () => {
            expect(shiftDate('2026-04-30', 1)).toBe('2026-05-01');
        });
        it('handles year rollover', () => {
            expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
        });
        it('handles 28-day lookback for V8 rolling window', () => {
            // The fetcher uses this for the existing-roster window.
            expect(shiftDate('2026-05-15', -28)).toBe('2026-04-17');
        });
    });

    describe('durationMinutes', () => {
        it('computes a normal day shift', () => {
            expect(durationMinutes('09:00', '17:00')).toBe(480);
        });
        it('handles cross-midnight (overnight) shifts', () => {
            // 22:00 → 06:00 = 8h overnight
            expect(durationMinutes('22:00', '06:00')).toBe(480);
        });
        it('handles short shifts', () => {
            expect(durationMinutes('09:00', '10:30')).toBe(90);
        });
    });
});

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

interface MockResp { data: any; error: any; }

function mockSupabase(opts: {
    bulkRpc?: MockResp;
    singleRpc?: MockResp;
    availabilitySlots?: MockResp;
    availabilityRules?: MockResp;
}): any {
    return {
        rpc: vi.fn().mockImplementation((name: string) => {
            if (name === 'get_employees_shift_window_bulk') {
                return Promise.resolve(opts.bulkRpc ?? { data: null, error: { message: 'rpc missing' } });
            }
            if (name === 'get_employee_shift_window') {
                return Promise.resolve(opts.singleRpc ?? { data: [], error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
        }),
        from: vi.fn().mockImplementation((table: string) => {
            // Chainable mock — `.select().in().gte().lte()` and
            // `.select().in().limit()` both resolve to the same final
            // promise. Each builder method returns `self` until awaited.
            let resp: MockResp;
            if (table === 'availability_slots') {
                resp = opts.availabilitySlots ?? { data: [], error: null };
            } else if (table === 'availability_rules') {
                resp = opts.availabilityRules ?? { data: [], error: null };
            } else {
                resp = { data: null, error: { message: `unknown table ${table}` } };
            }
            const builder: any = {
                select: () => builder,
                in: () => builder,
                gte: () => builder,
                lte: () => builder,
                limit: () => builder,
                then: (cb: any) => Promise.resolve(resp).then(cb),
            };
            return builder;
        }),
    };
}

const shift = (id: string, date = '2026-05-15'): ShiftMeta => ({
    id, shift_date: date, start_time: '09:00', end_time: '17:00',
    role_id: 'role-A',
});

const employee = (id: string): EmployeeMeta => ({
    id, name: `E-${id}`, contract_type: 'FT',
    contracted_weekly_hours: 38, remuneration_rate: 25,
});

// ---------------------------------------------------------------------------
// fetchExistingRoster
// ---------------------------------------------------------------------------

describe('RosterFetcher.fetchExistingRoster', () => {
    it('returns empty map when there are no shifts or no employees', async () => {
        const fetcher = new RosterFetcher(mockSupabase({}));
        expect(await fetcher.fetchExistingRoster([], [employee('e1')])).toEqual(new Map());
        expect(await fetcher.fetchExistingRoster([shift('s1')], [])).toEqual(new Map());
    });

    it('uses the bulk RPC and groups results by employee', async () => {
        const fetcher = new RosterFetcher(mockSupabase({
            bulkRpc: {
                data: [
                    {
                        id: 'committed-1', assigned_employee_id: 'e1',
                        shift_date: '2026-05-10', start_time: '09:00:00',
                        end_time: '17:00:00', unpaid_break_minutes: 30,
                    },
                    {
                        id: 'committed-2', assigned_employee_id: 'e2',
                        shift_date: '2026-05-11', start_time: '14:00:00',
                        end_time: '22:00:00', unpaid_break_minutes: 0,
                    },
                ],
                error: null,
            },
        }));

        const result = await fetcher.fetchExistingRoster(
            [shift('s1', '2026-05-15')],
            [employee('e1'), employee('e2')],
        );

        expect(result.get('e1')).toHaveLength(1);
        expect(result.get('e1')![0].id).toBe('committed-1');
        // normalizeTime should have stripped seconds
        expect(result.get('e1')![0].start_time).toBe('09:00');
        expect(result.get('e1')![0].duration_minutes).toBe(480);
        expect(result.get('e2')).toHaveLength(1);
    });

    it('excludes the candidate shifts themselves from the existing-roster context', async () => {
        // The shift the solver is being asked about (s1) shouldn't be
        // returned as "already committed" — that would make it look
        // like a self-conflict.
        const fetcher = new RosterFetcher(mockSupabase({
            bulkRpc: {
                data: [{
                    id: 's1',  // ← same id as candidate shift
                    assigned_employee_id: 'e1',
                    shift_date: '2026-05-15', start_time: '09:00:00',
                    end_time: '17:00:00', unpaid_break_minutes: 0,
                }],
                error: null,
            },
        }));

        const result = await fetcher.fetchExistingRoster(
            [shift('s1', '2026-05-15')],
            [employee('e1')],
        );

        expect(result.get('e1')).toEqual([]);
    });

    it('falls back to per-employee chunked fetch when bulk RPC returns an error', async () => {
        const fetcher = new RosterFetcher(mockSupabase({
            bulkRpc: { data: null, error: { message: 'rpc missing' } },
            singleRpc: {
                data: [{
                    id: 'committed-x', assigned_employee_id: 'e1',
                    shift_date: '2026-05-10', start_time: '09:00:00',
                    end_time: '17:00:00', unpaid_break_minutes: 0,
                }],
                error: null,
            },
        }));

        const result = await fetcher.fetchExistingRoster(
            [shift('s1', '2026-05-15')],
            [employee('e1')],
        );

        // The fallback path produces the same shape — just slower.
        expect(result.get('e1')).toHaveLength(1);
        expect(result.get('e1')![0].id).toBe('committed-x');
    });

    it('returns empty arrays for employees if both fetch paths fail', async () => {
        const fetcher = new RosterFetcher(mockSupabase({
            bulkRpc: { data: null, error: { message: 'bulk down' } },
            singleRpc: { data: null, error: { message: 'single down' } },
        }));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await fetcher.fetchExistingRoster(
            [shift('s1')],
            [employee('e1')],
        );

        // Conservative default: empty list. The solver still runs;
        // proposals just don't get rest-gap context.
        expect(result.get('e1')).toEqual([]);
        warnSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// fetchAvailability
// ---------------------------------------------------------------------------

describe('RosterFetcher.fetchAvailability', () => {
    it('returns empty map when there are no shifts or no employees', async () => {
        const fetcher = new RosterFetcher(mockSupabase({}));
        expect(await fetcher.fetchAvailability([], [employee('e1')])).toEqual(new Map());
    });

    it('marks employee as "has data" when availability_rules has any record', async () => {
        const fetcher = new RosterFetcher(mockSupabase({
            availabilitySlots: {
                data: [
                    {
                        profile_id: 'e1', slot_date: '2026-05-15',
                        start_time: '08:00:00', end_time: '18:00:00',
                    },
                ],
                error: null,
            },
            availabilityRules: {
                data: [{ profile_id: 'e1' }],
                error: null,
            },
        }));

        const result = await fetcher.fetchAvailability(
            [shift('s1', '2026-05-15')],
            [employee('e1')],
        );

        expect(result.get('e1')!.hasAnyData).toBe(true);
        expect(result.get('e1')!.slots).toHaveLength(1);
        expect(result.get('e1')!.slots[0].start_time).toBe('08:00');
    });

    it('marks employee as "no data" when availability_rules has no record', async () => {
        // Policy: empty rules table → universally available (not yet
        // onboarded). Distinguishes from "has rules elsewhere but none
        // in this window."
        const fetcher = new RosterFetcher(mockSupabase({
            availabilitySlots: { data: [], error: null },
            availabilityRules: { data: [], error: null },
        }));

        const result = await fetcher.fetchAvailability(
            [shift('s1')],
            [employee('e1')],
        );

        expect(result.get('e1')!.hasAnyData).toBe(false);
        expect(result.get('e1')!.slots).toEqual([]);
    });

    it('marks "has data" via slot-presence inference if rules query fails', async () => {
        // Transient query failure shouldn't block the run. We
        // conservatively infer hasAnyData from in-window slot presence.
        const fetcher = new RosterFetcher(mockSupabase({
            availabilitySlots: {
                data: [{
                    profile_id: 'e1', slot_date: '2026-05-15',
                    start_time: '08:00:00', end_time: '18:00:00',
                }],
                error: null,
            },
            availabilityRules: { data: null, error: { message: 'transient' } },
        }));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await fetcher.fetchAvailability(
            [shift('s1')],
            [employee('e1')],
        );

        // Slot presence → assume "has data"
        expect(result.get('e1')!.hasAnyData).toBe(true);
        warnSpy.mockRestore();
    });

    it('treats all employees as universally available when slots query fails', async () => {
        // If we can't load availability at all, the safe fallback is to
        // not block anyone. Failing closed (treating everyone as
        // unavailable) would be worse — the whole run would return 0
        // assignments on any infrastructure blip.
        const fetcher = new RosterFetcher(mockSupabase({
            availabilitySlots: { data: null, error: { message: 'down' } },
        }));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await fetcher.fetchAvailability(
            [shift('s1')],
            [employee('e1'), employee('e2')],
        );

        for (const emp of [employee('e1'), employee('e2')]) {
            expect(result.get(emp.id)!.hasAnyData).toBe(false);
            expect(result.get(emp.id)!.slots).toEqual([]);
        }
        warnSpy.mockRestore();
    });
});
