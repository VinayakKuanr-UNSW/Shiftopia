/**
 * One pricing kernel. The CP-SAT solver (SC-11 / SC-11b) and the greedy
 * fallback must rank two candidates identically for the same debts, or a
 * fallback run silently produces a different roster. The coefficients below
 * are READ FROM model_builder.py, so editing one side alone fails here.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    SC11_COEFF_PER_HOUR2,
    SC11B_OVERTIME_HOURS_COEFF,
    SC11B_TOTAL_HOURS_COEFF,
    categoryMinutes,
    shiftFairnessPenaltyCents,
    strategyMult,
} from '../fairness-ledger';

const solverSource = readFileSync(resolve(__dirname, '../../../../../optimizer-service/model_builder.py'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');

const solverNumber = (pattern: RegExp): number => {
    const m = pattern.exec(solverSource);
    if (!m) throw new Error(`not found in model_builder.py: ${pattern}`);
    return Number(m[1]);
};

describe('coefficients match the solver', () => {
    const ref = solverNumber(/^REFERENCE_SHIFT_HOURS\s*=\s*(\d+)/m);

    it.each(Object.keys(SC11_COEFF_PER_HOUR2))('SC-11 %s', (metric) => {
        const perShift = solverNumber(new RegExp(`'${metric}':\\s*(\\d+)\\s*/\\s*REFERENCE_SHIFT_HOURS\\s*\\*\\*\\s*2`));
        expect(SC11_COEFF_PER_HOUR2[metric as keyof typeof SC11_COEFF_PER_HOUR2]).toBe(perShift / ref ** 2);
    });

    it('SC-11b total and overtime', () => {
        expect(SC11B_TOTAL_HOURS_COEFF).toBe(solverNumber(/^SC11B_TOTAL_HOURS_COEFF\s*=\s*([\d.]+)/m));
        expect(SC11B_OVERTIME_HOURS_COEFF).toBe(solverNumber(/^SC11B_OVERTIME_HOURS_COEFF\s*=\s*([\d.]+)/m));
    });

    it('keeps the EBA cl 41 ratio Sat:Sun:PH = 1:2:6', () => {
        const { saturday_hours: sat, sunday_hours: sun, public_holiday_hours: ph } = SC11_COEFF_PER_HOUR2;
        expect([sun / sat, ph / sat]).toEqual([2, 6]);
    });

    it('strategyMult mirrors _strategy_mult: 0→0.5×, 50→1×, 100→2×', () => {
        expect([strategyMult(0), strategyMult(50), strategyMult(100)]).toEqual([0.5, 1, 2]);
    });
});

describe('shiftFairnessPenaltyCents', () => {
    const sundayDay = categoryMinutes('2026-12-06', '09:00', '17:00', 480, () => false);
    const weekdayDay = categoryMinutes('2026-12-07', '09:00', '17:00', 480, () => false);

    it('no debts, no penalty', () => {
        expect(shiftFairnessPenaltyCents(undefined, sundayDay)).toBe(0);
        expect(shiftFairnessPenaltyCents({}, sundayDay)).toBe(0);
    });

    it('an 8h Sunday against an 8h Sunday debt costs what one shift against one shift did (400¢)', () => {
        expect(shiftFairnessPenaltyCents({ sunday_hours: 8 }, sundayDay)).toBe(400);
    });

    it('owed work is a bonus, symmetric with the penalty', () => {
        expect(shiftFairnessPenaltyCents({ sunday_hours: -8 }, sundayDay)).toBe(-400);
    });

    it('a weekday shift is untouched by Sunday debt but priced by total-hours debt (SC-11b)', () => {
        expect(shiftFairnessPenaltyCents({ sunday_hours: 8 }, weekdayDay)).toBe(0);
        expect(shiftFairnessPenaltyCents({ total_hours: 5 }, weekdayDay)).toBe(80);     // 5 × 2.0 × 8h
        expect(shiftFairnessPenaltyCents({ overtime_hours: -1 }, weekdayDay)).toBe(-24); // −1 × 3.0 × 8h
    });

    it('scales with the strategy weight and truncates like int() in Python', () => {
        expect(shiftFairnessPenaltyCents({ sunday_hours: 8 }, sundayDay, 100)).toBe(800);
        expect(shiftFairnessPenaltyCents({ total_hours: 0.1 }, weekdayDay)).toBe(1);   // 1.6 → 1
        expect(shiftFairnessPenaltyCents({ total_hours: -0.1 }, weekdayDay)).toBe(-1); // −1.6 → −1
    });
});
