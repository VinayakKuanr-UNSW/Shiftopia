import { describe, it, expect } from 'vitest';
import { runV8ComplexBridge } from '../v2-to-v8';
import type { V8OrchestratorInput, V8OrchestratorShift } from '../../orchestrator/types';

/**
 * The adapter must carry `contracts` through to the engine.
 *
 * WHY THIS TEST EXISTS. `V8_EMPLOYMENT_TARGET` was given scope-aware matching
 * and unit tests that passed — because those tests handed the rule a
 * `V8Employee` with `contracts` on it directly. In production nothing did:
 * `V8Employee` had no such field and this adapter never set one, so
 * `ctx.employee.contracts` was `undefined`, the rule fell through to its
 * person-wide fallback, and the scoping never ran once. Nothing errored and
 * every unit test stayed green.
 *
 * That is the silent-drop hydration gap in its purest form: a rule correct in
 * isolation, starved of its input by the layer above. Unit-testing the rule
 * cannot catch it. Driving the real bridge can, so this does.
 */

const SUB_DEPT = 'sd-events';
const MANAGER = 'role-setups-manager';
const USHER = 'role-usher';

function shift(over: Partial<V8OrchestratorShift> = {}): V8OrchestratorShift {
    return {
        id: 's1',
        date: '2026-06-01',
        start_time: '09:00',
        end_time: '12:00',
        required_qualifications: [],
        break_minutes: 0,
        sub_department_id: SUB_DEPT,
        ...over,
    };
}

/**
 * Full-time as a setups manager, casual as an usher — one sub-department.
 *
 * `candidate_changes.add_shifts` matters: the rule never re-validates committed
 * history (`is_candidate === false`), so a shift the operation is not actually
 * adding is skipped and every assertion here would pass vacuously.
 */
function input(shiftId = 's1'): V8OrchestratorInput {
    return {
        employee_id: 'e1',
        candidate_changes: { add_shifts: [{ id: shiftId }] },
        employee_context: {
            employee_id: 'e1',
            contract_type: 'CASUAL',
            contracted_weekly_hours: 38,
            employment_statuses: ['Full-Time', 'Casual'],
            contracts: [
                { organization_id: 'o1', department_id: 'd1', sub_department_id: SUB_DEPT, role_id: MANAGER, employment_status: 'Full-Time' },
                { organization_id: 'o1', department_id: 'd1', sub_department_id: SUB_DEPT, role_id: USHER, employment_status: 'Casual' },
            ],
        },
    } as V8OrchestratorInput;
}

const targetHits = (hits: ReturnType<typeof runV8ComplexBridge>) =>
    hits.filter(h => h.rule_id === 'V8_EMPLOYMENT_TARGET');

describe('runV8ComplexBridge — employment target reaches the engine scoped', () => {
    it('blocks a Full-Time shift on the role held casually', () => {
        const hits = runV8ComplexBridge(input(), [
            shift({ target_employment_type: 'FT', role_id: USHER }),
        ]);
        // Fails if `contracts` is dropped by the adapter: person-wide matching
        // finds 'Full-Time' among the statuses and lets it through.
        expect(targetHits(hits)).toHaveLength(1);
        expect(targetHits(hits)[0].blocking).toBe(true);
    });

    it('allows the same shift on the role held full-time', () => {
        const hits = runV8ComplexBridge(input(), [
            shift({ target_employment_type: 'FT', role_id: MANAGER }),
        ]);
        expect(targetHits(hits)).toHaveLength(0);
    });

    it('allows a Casual shift on the usher role', () => {
        const hits = runV8ComplexBridge(input(), [
            shift({ target_employment_type: 'Casual', role_id: USHER }),
        ]);
        expect(targetHits(hits)).toHaveLength(0);
    });

    // The fallback still has to survive the trip: a caller that never hydrated
    // contracts must behave exactly as it did before any of this existed.
    it('falls back to person-wide when the caller hydrates no contracts', () => {
        const bare = input();
        delete (bare.employee_context as { contracts?: unknown }).contracts;
        const hits = runV8ComplexBridge(bare, [
            shift({ target_employment_type: 'FT', role_id: USHER }),
        ]);
        expect(targetHits(hits)).toHaveLength(0);
    });
});
