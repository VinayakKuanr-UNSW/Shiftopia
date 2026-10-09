import { describe, it, expect } from 'vitest';
import { runV8ComplexBridge } from '../v2-to-v8';
import type { V8OrchestratorInput, V8OrchestratorShift } from '../../orchestrator/types';

/**
 * A committed shift's contract link must reach the engine.
 *
 * History comes from get_employee_shift_window, which (since 20261009023631)
 * returns each shift's user_contract_id. The salaried relaxations (cl 39/40
 * advisory only when every shift involved is worked under a salary) read it via
 * governing-contract.ts. This adapter rebuilds each shift from a fixed field
 * list — exactly where such an input silently disappears — so drive it for real.
 *
 * The person: a salaried Full-Time manager who is also multi-hired as a casual
 * usher. Yesterday's shift ended 20:00; today's starts 05:00 — a 9h break.
 */
const SUB = 'sd-events';
const MANAGER = 'role-manager';
const USHER = 'role-usher';

const input = (): V8OrchestratorInput => ({
    employee_id: 'e1',
    candidate_changes: { add_shifts: [{ id: 'today' }] },
    employee_context: {
        employee_id: 'e1',
        contract_type: 'FULL_TIME',
        contracted_weekly_hours: 38,
        employment_statuses: ['Full-Time', 'Casual'],
        is_salaried: false,
        pay_basis: null,
        contracts: [
            { id: 'c-mgr', organization_id: 'o1', department_id: 'd1', sub_department_id: SUB, role_id: MANAGER, employment_status: 'Full-Time', pay_basis: 'salary' },
            { id: 'c-ush', organization_id: 'o1', department_id: 'd1', sub_department_id: SUB, role_id: USHER, employment_status: 'Casual', pay_basis: 'eba_level', engagement_kind: 'multi_hire' },
        ],
    },
} as V8OrchestratorInput);

/** A history row exactly as fetchEmployeeShiftsV2 builds it: no role, no target. */
const history = (contractId: string | null): V8OrchestratorShift => ({
    id: 'yesterday', date: '2026-10-08', start_time: '08:00', end_time: '20:00',
    role_id: '', required_qualifications: [], break_minutes: 0, unpaid_break_minutes: 0,
    user_contract_id: contractId,
});

const salariedToday: V8OrchestratorShift = {
    id: 'today', date: '2026-10-09', start_time: '05:00', end_time: '10:00',
    role_id: MANAGER, sub_department_id: SUB, target_employment_type: 'FT',
    required_qualifications: [], break_minutes: 0,
};

const restGap = (shifts: V8OrchestratorShift[]) =>
    runV8ComplexBridge(input(), shifts).filter(h => h.rule_id === 'V8_MIN_REST_GAP');

describe('runV8ComplexBridge — history shifts placed by their contract link', () => {
    it('advisory when yesterday was worked under the salary too', () => {
        const hits = restGap([history('c-mgr'), salariedToday]);
        expect(hits).toHaveLength(1);
        expect(hits[0].status).toBe('WARNING');
        expect(hits[0].blocking).toBe(false);
    });

    it('blocking when yesterday was the casual engagement', () => {
        const hits = restGap([history('c-ush'), salariedToday]);
        expect(hits[0].status).toBe('BLOCKING');
    });

    it('blocking when the history row has no link (cannot be placed)', () => {
        const hits = restGap([history(null), salariedToday]);
        expect(hits[0].status).toBe('BLOCKING');
    });
});
