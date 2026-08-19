import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The shape layer is only worth having if it cannot be walked around.
 *
 * Before this gate, `@/modules/compliance/shape` had two callers: the Add Shift
 * modal and the demand synthesiser. Every other way of creating a shift — the
 * DnD quick-add, the Group Mode inline create, the Labor Demand page, any direct
 * `shiftsCommands.createShift` — reached the database without a single shape rule
 * ever running. The rules were correct throughout; nothing consulted them.
 *
 * That is the same defect as the dropped-violation bug one layer down: a rule
 * that is computed and discarded and a rule that is never computed are
 * indistinguishable downstream, and both look exactly like a rule that passed.
 * So these tests assert on the ENFORCEMENT POINT rather than on the rules.
 */

const h = vi.hoisted(() => {
    const state = {
        roles: [
            { id: 'role-sec', name: 'Security Officer' },
            { id: 'role-gen', name: 'Team Member' },
        ] as Array<{ id: string; name: string }>,
        rolesFetches: 0,
        rolesError: null as unknown,
    };
    return {
        state,
        supabase: {
            from: (table: string) => ({
                select: async () => {
                    if (table === 'roles') state.rolesFetches++;
                    return state.rolesError
                        ? { data: null, error: state.rolesError }
                        : { data: state.roles, error: null };
                },
            }),
        },
    };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: h.supabase }));

import {
    assertShapeForRow,
    evaluateShapeForRow,
    resetSecurityRoleCache,
    type ShapeGateInput,
} from '../shift-shape-gate';

/** 09:00–17:30 less 30m unpaid = 8h net, with both rest pauses paid. Lawful. */
function lawful(over: Partial<ShapeGateInput> = {}): ShapeGateInput {
    return {
        shift_date: '2026-06-01',      // a Monday, not a public holiday
        start_time: '09:00',
        end_time:   '17:30',
        unpaid_break_minutes: 30,
        paid_break_minutes:   30,
        target_employment_type: 'Casual',
        ...over,
    };
}

beforeEach(() => {
    resetSecurityRoleCache();
    h.state.rolesFetches = 0;
    h.state.rolesError = null;
});

describe('the gate refuses an unlawful shape', () => {
    it('throws on an 8-hour shift with no meal break (cl 36.1)', async () => {
        await expect(
            assertShapeForRow(lawful({ unpaid_break_minutes: 0 })),
        ).rejects.toThrow(/meal break/i);
    });

    it('throws on a 90-minute casual engagement (cl 12.5(c))', async () => {
        await expect(
            assertShapeForRow(lawful({
                end_time: '10:30', unpaid_break_minutes: 0, paid_break_minutes: 0,
            })),
        ).rejects.toThrow(/minimum/i);
    });

    it('names every blocking rule, not just the first', async () => {
        // A manager sent back to fix one breach at a time learns to route around
        // the gate. The error carries the whole list.
        // No breaks at all on an 8.5h shift: no meal break (cl 36.1) and no rest
        // pauses (cl 37.2). Two hits, not three — the rest-pause tiers are
        // mutually exclusive by length, so past 8h the requirement simply IS
        // 30 minutes and cl 37.1's separate "15m" is not also reported.
        const err = await assertShapeForRow(
            lawful({ unpaid_break_minutes: 0, paid_break_minutes: 0 }),
        ).then(() => null, e => e);
        expect(err).toBeTruthy();
        expect(err.violations.map((v: string) => v)).toHaveLength(2);
        expect(err.message).toMatch(/cl 36\.1/);
        expect(err.message).toMatch(/cl 37\.2/);
    });

    it('lets a lawful shift through', async () => {
        const r = await assertShapeForRow(lawful());
        expect(r.passed).toBe(true);
    });

    it('does not block on a WARNING', async () => {
        // A 13h span carrying a 60m break is 12h worked — lawful under
        // cl 35.1(d). SHAPE_SPREAD_GUARDRAIL notes the tether and permits it.
        const r = await assertShapeForRow(lawful({
            start_time: '06:00', end_time: '19:00',
            unpaid_break_minutes: 60, paid_break_minutes: 30,
        }));
        expect(r.status).toBe('WARNING');
        expect(r.blocking).toBe(false);
    });
});

describe('Schedule 3 is resolved from the role', () => {
    it('accepts a security shift whose meal break is PAID', async () => {
        // 30m paid, 0m unpaid. Under the general rules that reads as no meal
        // break at all and the save is refused — which is what would happen if
        // the gate never looked up the role.
        const security = lawful({
            unpaid_break_minutes: 0, paid_break_minutes: 60, role_id: 'role-sec',
        });
        await expect(assertShapeForRow(security)).resolves.toBeTruthy();

        // The identical shift on a general role is a breach.
        await expect(
            assertShapeForRow({ ...security, role_id: 'role-gen' }),
        ).rejects.toThrow(/meal break/i);
    });

    it('measures net as gross for security, since the break is paid', async () => {
        const r = await evaluateShapeForRow(lawful({
            start_time: '09:00', end_time: '17:00',
            unpaid_break_minutes: 0, paid_break_minutes: 60, role_id: 'role-sec',
        }));
        expect(r.net_minutes).toBe(480);
    });

    it('takes a supplied role_name without a lookup', async () => {
        await evaluateShapeForRow(lawful({ role_name: 'Security Officer' }));
        expect(h.state.rolesFetches).toBe(0);
    });

    it('resolves the role set once, however many shifts are created', async () => {
        // The synthesiser inserts in chunks of 20. Caching the PROMISE rather
        // than the value is what stops twenty concurrent creates racing twenty
        // identical requests.
        await Promise.all(
            Array.from({ length: 20 }, () => evaluateShapeForRow(lawful({ role_id: 'role-gen' }))),
        );
        expect(h.state.rolesFetches).toBe(1);
    });

    it('fails open — and stricter — when the role lookup breaks', async () => {
        h.state.rolesError = { message: 'network' };
        const r = await evaluateShapeForRow(lawful({
            unpaid_break_minutes: 0, paid_break_minutes: 60, role_id: 'role-sec',
        }));
        // Judged by the general rules: a visible false refusal the manager can
        // retry, never a silent pass.
        expect(r.blocking).toBe(true);
    });

    it('retries the lookup after a rejection rather than caching the failure', async () => {
        h.state.rolesError = { message: 'network' };
        await evaluateShapeForRow(lawful({ role_id: 'role-sec' }));
        h.state.rolesError = null;
        const r = await evaluateShapeForRow(lawful({
            unpaid_break_minutes: 0, paid_break_minutes: 60, role_id: 'role-sec',
        }));
        expect(r.blocking).toBe(false);
    });
});

describe('an untargeted shift is judged as the form judges it', () => {
    it('treats a null target the way the Add Shift modal does', async () => {
        // Not a guess about who will work it — parity. A gate that defaulted
        // differently from the form it guards would let the form say "fine" and
        // the save throw.
        const untargeted = await evaluateShapeForRow(lawful({
            target_employment_type: null,
            start_time: '09:00', end_time: '12:00',
            unpaid_break_minutes: 0, paid_break_minutes: 15,
        }));
        const casual = await evaluateShapeForRow(lawful({
            target_employment_type: 'Casual',
            start_time: '09:00', end_time: '12:00',
            unpaid_break_minutes: 0, paid_break_minutes: 15,
        }));
        expect(untargeted.hits.map(x => x.rule_id)).toEqual(casual.hits.map(x => x.rule_id));
        expect(untargeted.passed).toBe(true);
    });

    it('does not silently relax the full-time floor', async () => {
        // 7h is under the cl 35.1(c) 7.6h ordinary day.
        await expect(assertShapeForRow(lawful({
            target_employment_type: 'FT', end_time: '16:30',
        }))).rejects.toThrow();
    });
});

describe('the bypass is named, reasoned, and RULE-SCOPED', () => {
    it('allows a blocking rule through when that rule is listed', async () => {
        const r = await assertShapeForRow(
            lawful({ unpaid_break_minutes: 0 }),
            { exempt: { rules: ['SHAPE_MEAL_BREAK'], reason: 'demand synthesis skeleton' } },
        );
        expect(r.blocking).toBe(true);   // still recorded, not laundered
    });

    it('still throws when the exemption is absent', async () => {
        await expect(
            assertShapeForRow(lawful({ unpaid_break_minutes: 0 })),
        ).rejects.toThrow();
    });

    it('still throws when the breached rule is NOT the one listed', async () => {
        // The synthesiser's real waiver. It must not also excuse a two-hour
        // engagement — the whole reason the blanket string was replaced.
        await expect(
            assertShapeForRow(
                lawful({ start_time: '09:00', end_time: '11:00', unpaid_break_minutes: 0 }),
                { exempt: { rules: ['SHAPE_MEAL_BREAK'], reason: 'demand synthesis skeleton' } },
            ),
        ).rejects.toThrow();
    });

    it('enforces the unlisted rule even when a listed one is ALSO breached', async () => {
        // Two breaches at once: no meal break (waived) and a public-holiday
        // engagement under four hours (not waived). Partitioning, not
        // short-circuiting, is what makes the second one survive.
        await expect(
            assertShapeForRow(
                lawful({
                    shift_date: '2026-12-25', start_time: '09:00', end_time: '11:00',
                    unpaid_break_minutes: 0, target_employment_type: 'Casual',
                }),
                { exempt: { rules: ['SHAPE_MEAL_BREAK'], reason: 'demand synthesis skeleton' } },
            ),
        ).rejects.toThrow();
    });
});
