import { describe, expect, it, vi } from 'vitest';
import { RosterFetcher } from '../roster-fetcher';
import type { ShiftMeta, EmployeeMeta } from '../../optimizer/solution-parser';

/**
 * The fetcher's half of per-job availability: carrying the scope, and NOT
 * filtering on it.
 *
 * A solve spans sub-departments — the auto-scheduler is handed a window of
 * shifts, not a single job — so narrowing this read to one sub-department would
 * un-declare every employee whose job is not the one we narrowed to, and the
 * solver would report them as having declared nothing. The scope therefore
 * travels WITH each slot and is matched against the shift's own job inside the
 * solver (`_slot_in_scope`).
 *
 * That makes this file a guard against a silent drop, not against a wrong
 * answer. If `sub_department_id` falls out of the select or the projection, no
 * error is raised anywhere: every slot arrives with an undefined scope, the
 * solver reads that as "applies to every job", and availability quietly goes
 * back to being person-wide — the exact behaviour this workstream removes.
 * That is the same failure mode the `target_employment_type` drop had, and it
 * went unnoticed until the database rejected the writes.
 */

type MockResp = { data: unknown; error: unknown };

function mockSupabase(opts: {
    availabilitySlots?: MockResp;
    availabilityRules?: MockResp;
    /** Records the column list each table was asked for. */
    selects?: Record<string, string>;
}): any {
    return {
        rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc missing' } }),
        from: vi.fn().mockImplementation((table: string) => {
            const resp: MockResp =
                table === 'availability_slots'
                    ? opts.availabilitySlots ?? { data: [], error: null }
                    : table === 'availability_rules'
                        ? opts.availabilityRules ?? { data: [], error: null }
                        : { data: null, error: { message: `unknown table ${table}` } };
            const builder: any = {
                select: (cols: string) => {
                    if (opts.selects) opts.selects[table] = cols;
                    return builder;
                },
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

const SETUP = '50000000-0000-0000-0000-000000000002';

const shift = (id: string): ShiftMeta => ({
    id, shift_date: '2026-05-15', start_time: '09:00', end_time: '17:00', role_id: 'role-A',
});

const casual = (id: string): EmployeeMeta => ({
    id, name: `E-${id}`, contract_type: 'CASUAL',
    contracted_weekly_hours: 0, remuneration_rate: 25,
});

const slotRow = (over: Record<string, unknown> = {}) => ({
    profile_id: 'e1',
    slot_date: '2026-05-15',
    start_time: '08:00:00',
    end_time: '18:00:00',
    sub_department_id: SETUP,
    ...over,
});

describe('RosterFetcher.fetchAvailability — job scope', () => {
    it('asks for sub_department_id', async () => {
        const selects: Record<string, string> = {};
        const fetcher = new RosterFetcher(mockSupabase({ selects }));
        await fetcher.fetchAvailability([shift('s1')], [casual('e1')]);
        expect(selects.availability_slots).toContain('sub_department_id');
    });

    it('carries the scope onto each returned slot', async () => {
        const fetcher = new RosterFetcher(mockSupabase({
            availabilitySlots: { data: [slotRow()], error: null },
            availabilityRules: { data: [{ profile_id: 'e1' }], error: null },
        }));
        const result = await fetcher.fetchAvailability([shift('s1')], [casual('e1')]);
        expect(result.get('e1')?.slots).toEqual([
            { slot_date: '2026-05-15', start_time: '08:00', end_time: '18:00', sub_department_id: SETUP },
        ]);
    });

    // An unscoped row means "every job". It has to arrive as an explicit null
    // rather than as an absent key, because the solver distinguishes the two
    // only by luck — both are falsy, and one of them is a bug.
    it('normalises a missing scope to null rather than dropping the key', async () => {
        const fetcher = new RosterFetcher(mockSupabase({
            availabilitySlots: { data: [slotRow({ sub_department_id: null })], error: null },
            availabilityRules: { data: [{ profile_id: 'e1' }], error: null },
        }));
        const result = await fetcher.fetchAvailability([shift('s1')], [casual('e1')]);
        const [slot] = result.get('e1')!.slots;
        expect(slot).toHaveProperty('sub_department_id');
        expect(slot.sub_department_id).toBeNull();
    });

    // The property that makes the per-slot match necessary in the first place.
    it('does not narrow the read to one job — every slot in the window comes back', async () => {
        const OTHER = '50000000-0000-0000-0000-000000000001';
        const fetcher = new RosterFetcher(mockSupabase({
            availabilitySlots: {
                data: [slotRow(), slotRow({ sub_department_id: OTHER })],
                error: null,
            },
            availabilityRules: { data: [{ profile_id: 'e1' }], error: null },
        }));
        const result = await fetcher.fetchAvailability([shift('s1')], [casual('e1')]);
        expect(result.get('e1')?.slots.map((s) => s.sub_department_id).sort())
            .toEqual([OTHER, SETUP].sort());
    });
});
