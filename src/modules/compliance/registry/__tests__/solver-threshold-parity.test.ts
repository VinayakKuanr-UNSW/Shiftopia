import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_V8_CONFIG } from '../../v8/types';
import { SPLIT_SHIFT_SPREAD_MINUTES } from '../../v8/rules/spread-of-hours';
import { CASUAL_MAX_DAILY_ENGAGEMENTS } from '../../v8/rules/max-daily-engagements';
import {
    MAX_WORKDAYS_PER_28,
    MAX_CONSECUTIVE_DAYS_FLEXI_PT,
} from '../../v8/rules/consecutive-days';

/**
 * The CP-SAT model and the labour layer must agree on every number.
 *
 * These are two independent implementations of one agreement, in two languages,
 * and where they disagree the failure is silent in the worst way: the solver
 * proposes a roster, the labour layer rejects it, and nobody can see why without
 * reading a solved roster beside a compliance panel. The Phase-5 audit found
 * exactly that — the solver had no security discriminator at all, so it sized
 * every full-time Security roster against the general 38h/4-week envelope while
 * `ordinaryHoursAvgRule` measured them against Schedule 3's 42h/8-week cycle.
 * Four hours a week, every week, invisible.
 *
 * A shared constants file is not available across the language boundary, so the
 * next best thing is a test that reads the other side's source. This mirrors
 * `test_schema_contract.py`, which pins the same two codebases together on field
 * NAMES; this pins them on VALUES.
 *
 * When this fails: change both sides, or record the divergence as a `knownGap`
 * on the registry rule and pin it in `registry-parity.test.ts`. Do not change
 * the expectation alone.
 */

const MODEL_BUILDER = 'optimizer-service/model_builder.py';

/** Read a module-level `NAME = 123` integer constant out of the solver source. */
function solverConstant(name: string): number {
    const src = readFileSync(MODEL_BUILDER, 'utf8');
    const m = new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm').exec(src);
    expect(m, `${name} is not defined at module level in ${MODEL_BUILDER}`).not.toBeNull();
    return Number(m![1]);
}

describe('ordinary-hours cycles', () => {
    it('agrees on the general cycle — cl 35.1(a), 38h over 4 weeks', () => {
        expect(solverConstant('ORD_AVG_CYCLE_DAYS'))
            .toBe(DEFAULT_V8_CONFIG.ord_avg_cycle_weeks * 7);
        expect(solverConstant('ORD_AVG_CYCLE_MINUTES'))
            .toBe(DEFAULT_V8_CONFIG.ord_avg_cycle_weeks * DEFAULT_V8_CONFIG.ord_avg_weekly_limit * 60);
    });

    it('agrees on the Schedule 3 security cycle — 42h over 8 weeks', () => {
        // The gap this whole test file exists for. Until Phase 5 the solver had
        // no security branch and no `is_security_role` field to branch on.
        expect(solverConstant('ORD_AVG_SECURITY_CYCLE_DAYS'))
            .toBe(DEFAULT_V8_CONFIG.security_ord_avg_cycle_weeks * 7);
        expect(solverConstant('ORD_AVG_SECURITY_CYCLE_MINUTES'))
            .toBe(
                DEFAULT_V8_CONFIG.security_ord_avg_cycle_weeks *
                DEFAULT_V8_CONFIG.security_ord_avg_weekly_limit * 60,
            );
    });

    it('keeps the security cycle strictly more generous than the general one', () => {
        // Sch 3 §1.1 makes the schedule prevail; §3.1 is an uplift, not a
        // restriction. If this ever inverts, one of the four numbers is wrong.
        const general = solverConstant('ORD_AVG_CYCLE_MINUTES') / solverConstant('ORD_AVG_CYCLE_DAYS');
        const security =
            solverConstant('ORD_AVG_SECURITY_CYCLE_MINUTES') / solverConstant('ORD_AVG_SECURITY_CYCLE_DAYS');
        expect(security).toBeGreaterThan(general);
    });
});

describe('daily and weekly caps', () => {
    it('agrees on the 12h daily ordinary ceiling', () => {
        expect(solverConstant('MAX_DAILY_MINUTES')).toBe(DEFAULT_V8_CONFIG.max_daily_hours * 60);
    });

    it('agrees on the cl 39.2 split-shift spread ceiling', () => {
        expect(solverConstant('SPLIT_SHIFT_SPREAD_MINUTES')).toBe(SPLIT_SHIFT_SPREAD_MINUTES);
    });

    it('agrees on 20 worked days in any 28', () => {
        expect(solverConstant('MAX_WORKDAYS_PER_28')).toBe(MAX_WORKDAYS_PER_28);
    });

    it('agrees on the flexible part-time streak cap', () => {
        expect(solverConstant('MAX_CONSECUTIVE_DAYS_FLEXI_PT')).toBe(MAX_CONSECUTIVE_DAYS_FLEXI_PT);
    });

    it('agrees on the casual daily-engagement cap', () => {
        expect(solverConstant('MAX_CASUAL_DAILY_ENGAGEMENTS')).toBe(CASUAL_MAX_DAILY_ENGAGEMENTS);
    });
});

describe('the solver actually uses the constants it declares', () => {
    // A constant nothing reads is worse than no constant: this test would pass
    // while the model kept its own inline literal. Assert the magic numbers are
    // gone from the constraint bodies.
    const src = readFileSync(MODEL_BUILDER, 'utf8');

    it('no longer hardcodes the 9120-minute general cycle', () => {
        expect(src).not.toMatch(/limit_mins\s*=\s*9120/);
        expect(src).toMatch(/ORD_AVG_SECURITY_CYCLE_MINUTES if is_ft_security else ORD_AVG_CYCLE_MINUTES/);
    });

    it('branches the cycle on full-time security, matching isFtSecurity', () => {
        expect(src).toMatch(/is_ft_security\s*=\s*emp\.is_security_role and emp\.employment_type == 'FT'/);
    });

    it('scopes the spread constraint to part-time, per cl 39.1', () => {
        expect(src).toMatch(/if emp\.employment_type != 'PT':\s*\n\s*continue/);
    });
});
