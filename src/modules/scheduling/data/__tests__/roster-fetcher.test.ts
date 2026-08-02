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
    userContracts?: MockResp;
    roles?: MockResp;
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
            // Chainable mock — `.select().in().gte().lte().eq()` and
            // `.select().in().limit()` both resolve to the same final
            // promise. Each builder method returns `self` until awaited.
            let resp: MockResp;
            if (table === 'availability_slots') {
                resp = opts.availabilitySlots ?? { data: [], error: null };
            } else if (table === 'availability_rules') {
                resp = opts.availabilityRules ?? { data: [], error: null };
            } else if (table === 'user_contracts') {
                resp = opts.userContracts ?? { data: [], error: null };
            } else if (table === 'roles') {
                resp = opts.roles ?? { data: [], error: null };
            } else {
                resp = { data: null, error: { message: `unknown table ${table}` } };
            }
            const builder: any = {
                select: () => builder,
                in: () => builder,
                eq: () => builder,
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

// ---------------------------------------------------------------------------
// fetchEmployeeContractDetails
// ---------------------------------------------------------------------------

describe('RosterFetcher.fetchEmployeeContractDetails', () => {
    it('returns empty map for empty employee list', async () => {
        const fetcher = new RosterFetcher(mockSupabase({}));
        const result = await fetcher.fetchEmployeeContractDetails([]);
        expect(result.size).toBe(0);
    });

    it('resolves a single employee with a single Active contract', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: {
                data: [{
                    user_id: 'e1', role_id: 'role-A', remuneration_level: 3,
                    is_apprentice: false, is_trainee: false, is_sws: false,
                }],
                error: null,
            },
            roles: {
                data: [{ id: 'role-A', name: 'Event Coordinator' }],
                error: null,
            },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1')]);

        expect(result.size).toBe(1);
        const details = result.get('e1')!;
        expect(details.level).toBe(3);
        expect(details.is_security_role).toBe(false);
        // No special category flags expected
        expect(details.is_apprentice).toBeUndefined();
        expect(details.is_trainee).toBeUndefined();
        expect(details.is_sws).toBeUndefined();
        infoSpy.mockRestore();
    });

    it('picks the HIGHEST remuneration_level across multiple contracts', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: {
                data: [
                    { user_id: 'e1', role_id: 'role-A', remuneration_level: 2, is_apprentice: false, is_trainee: false, is_sws: false },
                    { user_id: 'e1', role_id: 'role-B', remuneration_level: 5, is_apprentice: false, is_trainee: false, is_sws: false },
                    { user_id: 'e1', role_id: 'role-C', remuneration_level: 3, is_apprentice: false, is_trainee: false, is_sws: false },
                ],
                error: null,
            },
            roles: {
                data: [
                    { id: 'role-A', name: 'Cleaner' },
                    { id: 'role-B', name: 'Supervisor' },
                    { id: 'role-C', name: 'Usher' },
                ],
                error: null,
            },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1')]);
        expect(result.get('e1')!.level).toBe(5);
        infoSpy.mockRestore();
    });

    it('detects Security status from role name (case-insensitive)', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: {
                data: [
                    { user_id: 'e1', role_id: 'role-sec', remuneration_level: 4, is_apprentice: false, is_trainee: false, is_sws: false },
                ],
                error: null,
            },
            roles: {
                data: [{ id: 'role-sec', name: 'Security Officer Level 4' }],
                error: null,
            },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1')]);
        expect(result.get('e1')!.is_security_role).toBe(true);
        infoSpy.mockRestore();
    });

    it('sets is_security_role true if ANY of multiple contracts is Security', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: {
                data: [
                    { user_id: 'e1', role_id: 'role-gen', remuneration_level: 2, is_apprentice: false, is_trainee: false, is_sws: false },
                    { user_id: 'e1', role_id: 'role-sec', remuneration_level: 4, is_apprentice: false, is_trainee: false, is_sws: false },
                ],
                error: null,
            },
            roles: {
                data: [
                    { id: 'role-gen', name: 'Event Crew' },
                    { id: 'role-sec', name: 'Security Guard' },
                ],
                error: null,
            },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1')]);
        expect(result.get('e1')!.is_security_role).toBe(true);
        // Highest level across both contracts
        expect(result.get('e1')!.level).toBe(4);
        infoSpy.mockRestore();
    });

    it('surfaces apprentice fields from the special-category contract', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: {
                data: [{
                    user_id: 'e1', role_id: 'role-A', remuneration_level: 1,
                    is_apprentice: true, apprentice_type: 'adult', apprentice_year: 2,
                    has_completed_year_12: true,
                    is_trainee: false, is_sws: false,
                }],
                error: null,
            },
            roles: {
                data: [{ id: 'role-A', name: 'Apprentice Cook' }],
                error: null,
            },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1')]);
        const details = result.get('e1')!;
        expect(details.is_apprentice).toBe(true);
        expect(details.apprentice_type).toBe('adult');
        expect(details.apprentice_year).toBe(2);
        expect(details.has_completed_year_12).toBe(true);
        expect(details.is_trainee).toBe(false);
        expect(details.is_sws).toBe(false);
        infoSpy.mockRestore();
    });

    it('surfaces trainee fields from the special-category contract', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: {
                data: [{
                    user_id: 'e1', role_id: 'role-A', remuneration_level: 0,
                    is_apprentice: false, is_trainee: true,
                    trainee_category: 'junior', trainee_level: 'A',
                    trainee_exit_year: 12, trainee_years_out: 1,
                    trainee_aqf_level: 2, trainee_year: 1,
                    is_training_on_job: true, prefers_sba_loading: false,
                    is_sws: false,
                }],
                error: null,
            },
            roles: {
                data: [{ id: 'role-A', name: 'Trainee Assistant' }],
                error: null,
            },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1')]);
        const details = result.get('e1')!;
        expect(details.is_trainee).toBe(true);
        expect(details.trainee_category).toBe('junior');
        expect(details.trainee_level).toBe('A');
        expect(details.trainee_exit_year).toBe(12);
        expect(details.trainee_years_out).toBe(1);
        expect(details.trainee_aqf_level).toBe(2);
        expect(details.trainee_year).toBe(1);
        expect(details.is_training_on_job).toBe(true);
        expect(details.prefers_sba_loading).toBe(false);
        infoSpy.mockRestore();
    });

    it('surfaces SWS fields from the special-category contract', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: {
                data: [{
                    user_id: 'e1', role_id: 'role-A', remuneration_level: 1,
                    is_apprentice: false, is_trainee: false,
                    is_sws: true, sws_capacity_percentage: 70,
                }],
                error: null,
            },
            roles: {
                data: [{ id: 'role-A', name: 'General Assistant' }],
                error: null,
            },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1')]);
        const details = result.get('e1')!;
        expect(details.is_sws).toBe(true);
        expect(details.sws_capacity_percentage).toBe(70);
        expect(details.is_apprentice).toBe(false);
        expect(details.is_trainee).toBe(false);
        infoSpy.mockRestore();
    });

    it('returns empty map on user_contracts query failure (graceful degradation)', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: { data: null, error: { message: 'RLS denied' } },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1')]);
        expect(result.size).toBe(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('user_contracts fetch failed'),
            expect.objectContaining({ message: 'RLS denied' }),
        );
        warnSpy.mockRestore();
    });

    it('resolves Security status even if roles lookup fails (graceful degradation)', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: {
                data: [{
                    user_id: 'e1', role_id: 'role-sec', remuneration_level: 4,
                    is_apprentice: false, is_trainee: false, is_sws: false,
                }],
                error: null,
            },
            roles: { data: null, error: { message: 'roles table down' } },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1')]);
        // Level is still resolved from the contract row
        expect(result.get('e1')!.level).toBe(4);
        // Security status can't be determined without roles — defaults to false
        expect(result.get('e1')!.is_security_role).toBe(false);
        warnSpy.mockRestore();
        infoSpy.mockRestore();
    });

    it('handles multiple employees in one call', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: {
                data: [
                    { user_id: 'e1', role_id: 'role-A', remuneration_level: 2, is_apprentice: false, is_trainee: false, is_sws: false },
                    { user_id: 'e2', role_id: 'role-B', remuneration_level: 5, is_apprentice: false, is_trainee: false, is_sws: false },
                ],
                error: null,
            },
            roles: {
                data: [
                    { id: 'role-A', name: 'Usher' },
                    { id: 'role-B', name: 'Security Control Room' },
                ],
                error: null,
            },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1'), employee('e2')]);
        expect(result.size).toBe(2);
        expect(result.get('e1')!.level).toBe(2);
        expect(result.get('e1')!.is_security_role).toBe(false);
        expect(result.get('e2')!.level).toBe(5);
        expect(result.get('e2')!.is_security_role).toBe(true);
        infoSpy.mockRestore();
    });

    it('returns empty map when no Active contracts exist for these employees', async () => {
        const fetcher = new RosterFetcher(mockSupabase({
            userContracts: { data: [], error: null },
        }));

        const result = await fetcher.fetchEmployeeContractDetails([employee('e1')]);
        expect(result.size).toBe(0);
    });
});
