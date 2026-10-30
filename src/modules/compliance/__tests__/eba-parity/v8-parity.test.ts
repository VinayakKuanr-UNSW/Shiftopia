/**
 * EBA engine parity — the V8 half.
 *
 * Two engines answer the same EBA question: V8 here, for the screens, and
 * internal.eba_evaluate in the database, which every shift write answers to.
 * scenarios.json is the answer key for both. This test holds V8 to it; the
 * database is held to the same file by scripts/gen-eba-parity-sql.mjs, whose
 * query must return only its TOTAL row.
 *
 * Change a rule in one engine and this file in the same commit, then run the
 * database half — a key that moves for one engine only is the drift this
 * exists to catch.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { V8Engine } from '../../v8/engine';
import type { ContractRecordV2, V8ContractType, V8Employee, V8Shift } from '../../v8/types';

interface ScenarioShift {
    date: string;
    start: string;
    end: string;
    unpaid?: number;
    paid?: number;
    /** The meal-break window's length; defaults to `unpaid`. */
    meal?: number;
    training?: boolean;
    multi_hire?: boolean;
    salaried?: boolean;
    candidate?: boolean;
}

interface Scenario {
    name: string;
    employee: {
        contract_type: V8ContractType;
        security?: boolean;
        rest_gap_8h?: boolean;
        student_visa?: boolean;
        salaried?: boolean;
    };
    shifts: ScenarioShift[];
    blocking: string[];
    warning: string[];
}

// From a string, not `new URL(…)`: the jsdom environment replaces the global URL.
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'scenarios.json');
const { scenarios } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { scenarios: Scenario[] };

/**
 * Warnings both engines raise. V8 also warns on things the database engine
 * does not evaluate (ordinary-hours peaks, contracted hours, multi-hire
 * eligibility); they never block, so they stay out of the comparison.
 */
const SHARED_WARNINGS = new Set(['V8_MIN_REST_GAP', 'V8_SPLIT_SHIFT_SPREAD', 'V8_SPLIT_SHIFT']);

const EBA_CONTRACT = 'contract-eba';
const SALARY_CONTRACT = 'contract-salary';

function contract(id: string, status: V8ContractType, payBasis: 'eba_level' | 'salary'): ContractRecordV2 {
    return {
        id,
        organization_id:   'org',
        department_id:     'dept',
        sub_department_id: null,
        role_id:           'role',
        employment_status: status,
        pay_basis:         payBasis,
        engagement_kind:   'primary',
    };
}

function addMinutes(hhmm: string, minutes: number): string {
    const [h, m] = hhmm.split(':').map(Number);
    const total = (h * 60 + m + minutes) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function toV8Shift(s: ScenarioShift, i: number, sc: Scenario): V8Shift {
    const meal = s.meal ?? s.unpaid ?? 0;
    const breakStart = meal > 0 ? addMinutes(s.start, 120) : undefined;
    return {
        id:                   `shift-${i}`,
        date:                 s.date,
        start_time:           s.start,
        end_time:             s.end,
        unpaid_break_minutes: s.unpaid ?? 0,
        paid_break_minutes:   s.paid ?? 0,
        break_start:          breakStart,
        break_end:            breakStart ? addMinutes(breakStart, meal) : undefined,
        is_training:          s.training ?? false,
        shift_type:           s.multi_hire ? 'MULTI_HIRE' : 'NORMAL',
        user_contract_id:     (s.salaried ?? sc.employee.salaried) ? SALARY_CONTRACT : EBA_CONTRACT,
        is_candidate:         s.candidate ?? false,
    };
}

function evaluate(sc: Scenario): { blocking: string[]; warning: string[] } {
    const employee: V8Employee = {
        id:                      'employee',
        name:                    sc.name,
        contract_type:           sc.employee.contract_type,
        contracted_weekly_hours: 0,
        is_security_role:        sc.employee.security ?? false,
        is_student_visa:         sc.employee.student_visa ?? false,
        is_salaried:             sc.employee.salaried ?? false,
        contracts: [
            contract(EBA_CONTRACT, sc.employee.contract_type, 'eba_level'),
            contract(SALARY_CONTRACT, sc.employee.contract_type, 'salary'),
        ],
    };
    const engine = new V8Engine(sc.employee.rest_gap_8h ? { min_rest_gap_minutes: 480 } : {});
    const { hits } = engine.evaluate(employee, sc.shifts.map((s, i) => toV8Shift(s, i, sc)));

    const ids = (keep: (h: (typeof hits)[number]) => boolean) =>
        [...new Set(hits.filter(keep).map(h => h.rule_id))].sort();
    return {
        blocking: ids(h => h.blocking),
        warning:  ids(h => !h.blocking && h.status === 'WARNING' && SHARED_WARNINGS.has(h.rule_id)),
    };
}

describe('EBA engine parity: V8 agrees with the shared answer key', () => {
    it('has scenarios to check', () => {
        expect(scenarios.length).toBeGreaterThan(40);
    });

    it.each(scenarios.map(sc => [sc.name, sc] as const))('%s', (_name, sc) => {
        expect(evaluate(sc)).toEqual({ blocking: sc.blocking, warning: sc.warning });
    });
});
