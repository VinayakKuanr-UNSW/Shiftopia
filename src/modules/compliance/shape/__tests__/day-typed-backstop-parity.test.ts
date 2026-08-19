import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateShiftShape } from '../evaluate';
import { requiredMinEngagementMinutes } from '../evaluate';
import { DAY_TYPED_SHAPE_RULES, DEFAULT_SHAPE_CONFIG } from '../types';

/**
 * The DAY-TYPED backstop must agree with the shape layer — in both directions.
 *
 * `db-backstop-parity.test.ts` guards the eight rules carried as CHECK
 * constraints, where the requirement is only "never STRICTER than the
 * application": a CHECK sees one row, cannot resolve a role name and cannot
 * read a calendar, so where it cannot see it must accept.
 *
 * `trg_shift_shape_3_day_typed` is different, and the difference is why this is
 * a separate file. A trigger CAN do a subquery — it resolves Schedule 3 from
 * `roles` and the public holiday from `public_holidays` — so it is not guessing
 * at anything, and the relationship it must hold is EQUALITY, not an inequality.
 * Looseness here would be a defect rather than a safety margin, because these
 * are the only two rules with no other enforcement point once a shift's date
 * changes after creation.
 *
 * Reading the migration is how the two sides are pinned to each other. A shared
 * constants file cannot cross a TS/SQL boundary; reading the other side's
 * source can. Same technique as `solver-threshold-parity.test.ts`.
 */

const MIGRATION = 'supabase/migrations/20260819120000_shift_shape_day_typed_backstop.sql';
const raw = readFileSync(MIGRATION, 'utf8');

/**
 * The migration with `--` comments stripped.
 *
 * Assertions about what the SQL does must not be satisfiable by prose ABOUT
 * what it does. `baselineTemplateQuery.test.ts` was once written without this
 * and passed against a comment describing the very bug it was meant to catch.
 * This file is heavily commented and names every rule it handles in prose, so
 * a naive match would succeed on a migration that implemented none of them.
 */
const sql = raw.replace(/--.*$/gm, '');

/** Body of the shared predicate function, comments already stripped. */
const predicate = (() => {
    const m = /CREATE OR REPLACE FUNCTION public\.shift_day_typed_shortfall\(([\s\S]*?)\n\$\$;/.exec(sql);
    expect(m, `shift_day_typed_shortfall is not defined in ${MIGRATION}`).not.toBeNull();
    return m![1];
})();

describe('the day-typed backstop carries exactly the rules the CHECK backstop could not', () => {
    it('names both day-typed rules, and only those', () => {
        expect([...DAY_TYPED_SHAPE_RULES].sort())
            .toEqual(['SHAPE_MIN_ENGAGEMENT', 'SHAPE_MIN_ENGAGEMENT_PH']);
    });

    it('returns each rule id, so a breach says which clause it broke', () => {
        for (const ruleId of DAY_TYPED_SHAPE_RULES) {
            expect(predicate, `${ruleId} is not returned by the predicate`).toContain(ruleId);
        }
    });

    it('is a trigger, not a CHECK — the mechanism is the whole reason it can exist', () => {
        // A CHECK constraint may only call IMMUTABLE functions, which is
        // precisely why cl 56.2 was left out of the 2026-08-18 backstop. If
        // someone ever "simplifies" this into a constraint it silently stops
        // being able to read the calendar.
        expect(sql).toMatch(/CREATE TRIGGER trg_shift_shape_3_day_typed/);
        expect(sql).toMatch(/public\.shift_day_typed_shortfall[\s\S]*?\bSTABLE\b/);
    });

    it('fires after the trigger that resolves target_employment_type', () => {
        // Postgres fires row-level BEFORE triggers in NAME order. Reading the
        // target before `trg_shift_employment_target_1_resolve` has populated it
        // from the template row would judge every template-stamped shift
        // against a NULL target — which the predicate treats as "not FT" and so
        // would evaluate against a value that does not exist yet.
        expect('trg_shift_shape_3_day_typed' > 'trg_shift_employment_target_1_resolve').toBe(true);
    });

    it('only fires on columns that can change a shape verdict', () => {
        const m = /BEFORE INSERT OR UPDATE OF([\s\S]*?)ON public\.shifts/.exec(sql);
        expect(m).not.toBeNull();
        const columns = m![1].split(',').map(c => c.trim()).filter(Boolean);

        // shift_date is the one that matters: it is what `sm_move_shift`
        // changes, and the reason this trigger exists at all.
        expect(columns).toContain('shift_date');
        // An assignment, a publish or a clock-in must never re-litigate shape.
        expect(columns).not.toContain('assigned_employee_id');
        expect(columns).not.toContain('lifecycle_status');
    });
});

describe('the SQL thresholds equal the ones the application uses', () => {
    it('uses cl 56.2’s four hours for public holidays', () => {
        expect(DEFAULT_SHAPE_CONFIG.public_holiday_min_engagement_minutes).toBe(240);
        expect(predicate).toContain('v_is_ph AND v_net < 240');
    });

    it('uses the same four hours for the Sunday tier', () => {
        const { requiredMins } = requiredMinEngagementMinutes({ target: 'Casual', isSunday: true });
        expect(requiredMins).toBe(240);
        expect(predicate).toContain('v_net < 240');
    });

    it('exempts full-time from both limbs, as evaluate.ts does', () => {
        expect(predicate).toMatch(/p_target_employment_type = 'FT'\s*THEN\s*RETURN NULL/);
    });

    it('gives Security a paid meal break, so net equals gross', () => {
        // Sch 3 §3.2(a)/§5.3(a). Deducting an unpaid break for a security shift
        // would UNDERSTATE its length and refuse a lawful four-hour public
        // holiday engagement — the failure direction that matters most here.
        expect(predicate).toMatch(/WHEN v_is_security THEN 0/);
    });

    it('does not apply the Sunday tier to plain part-time or to training', () => {
        // Both reach a LOWER floor than four hours, and both are already
        // carried date-blind by the CHECK backstop. Asserting four here would
        // make the trigger stricter than the application.
        expect(predicate).toContain("p_target_employment_type = 'PT' AND NOT COALESCE(p_target_requires_flexible, false)");
        expect(predicate).toContain('NOT COALESCE(p_is_training, false)');
    });
});

describe('an uncovered year is UNKNOWN, never "not a public holiday"', () => {
    it('raises rather than returning a verdict past the calendar horizon', () => {
        // The hardcoded 2026-only list this replaced classified all of 2027 as
        // holiday-free and reported zero public-holiday shifts forever, with no
        // error. Failing open is the specific bug being designed out.
        expect(predicate).toMatch(/IF NOT v_is_ph THEN[\s\S]*?RAISE EXCEPTION/);
        expect(predicate).toContain('public_holiday_calendar_horizon');
    });

    it('checks the horizon only when the answer would be a negative', () => {
        // A date that IS in the table is classified regardless of where the
        // horizon sits, so extending the seed can never change an existing
        // verdict from "public holiday" to an error.
        const horizonGuard = /IF NOT v_is_ph THEN([\s\S]*?)END IF;/.exec(predicate);
        expect(horizonGuard).not.toBeNull();
        expect(horizonGuard![1]).toContain('RAISE EXCEPTION');
    });
});

describe('the TypeScript evaluator produces the verdicts the SQL is pinned to', () => {
    // The parity above is textual — it proves the SQL says the right numbers.
    // These prove the numbers mean what the tests assume, so a change to
    // `evaluate.ts` alone cannot silently break the agreement.
    const base = {
        start_time: '09:00', end_time: '12:00',
        unpaid_break_minutes: 0, paid_break_minutes: 15,
        target_employment_type: 'Casual' as const,
    };

    it('blocks a three-hour casual on a public holiday (cl 56.2)', () => {
        const r = evaluateShiftShape({ ...base, shift_date: '2026-12-25' });
        expect(r.hits.filter(h => h.blocking).map(h => h.rule_id))
            .toContain('SHAPE_MIN_ENGAGEMENT_PH');
    });

    it('blocks a three-hour casual on a Sunday', () => {
        const r = evaluateShiftShape({ ...base, shift_date: '2026-12-27' });
        expect(r.blocking).toBe(true);
    });

    it('allows the same shift on an ordinary weekday', () => {
        expect(evaluateShiftShape({ ...base, shift_date: '2026-12-29' }).blocking).toBe(false);
    });

    it('allows three hours of plain part-time on a Sunday (cl 12.3(e))', () => {
        const r = evaluateShiftShape({
            ...base, shift_date: '2026-12-27',
            target_employment_type: 'PT', target_requires_flexible: false,
        });
        expect(r.blocking).toBe(false);
    });

    it('still blocks a two-hour TRAINING shift on a public holiday', () => {
        // cl 56.2 overrides the training concession; the Sunday tier does not.
        const ph = evaluateShiftShape({
            ...base, shift_date: '2026-12-25', end_time: '11:00', is_training: true,
        });
        expect(ph.blocking).toBe(true);

        const sunday = evaluateShiftShape({
            ...base, shift_date: '2026-12-27', end_time: '11:00', is_training: true,
        });
        expect(sunday.blocking).toBe(false);
    });
});
