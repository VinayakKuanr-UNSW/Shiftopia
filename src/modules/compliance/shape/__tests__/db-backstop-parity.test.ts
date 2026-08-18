import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SHAPE_CONFIG } from '../types';
import { requiredMinEngagementMinutes } from '../evaluate';

/**
 * The database backstop must never be STRICTER than the shape layer.
 *
 * `shifts` carries CHECK constraints mirroring the shape rules, so a write that
 * bypasses the client gates — psql, a SECURITY DEFINER RPC, a future code path
 * that forgets to call them — still cannot mint a flagrantly unlawful shift.
 * Phase 4b found the shape rules had ONE caller and every other creation path
 * wrote unchecked; moving the gate reduced the number of doors without removing
 * the class of defect.
 *
 * The direction of the inequality is the entire design. A CHECK sees one row:
 * it cannot resolve a role name (so it cannot tell whether Schedule 3 makes the
 * meal break PAID) and it cannot know whether a date is a public holiday. Where
 * it cannot see, it must ACCEPT — because a backstop that rejects a shift the
 * application considers lawful is not a safety net, it is an outage whose only
 * workaround is to stop using the application.
 *
 * This reads the migration and pins its numbers to the config the application
 * uses, in the same way `solver-threshold-parity.test.ts` pins the CP-SAT model.
 * A shared constants file cannot cross either boundary; reading the other side's
 * source can.
 */

const MIGRATION = 'supabase/migrations/20260818000000_shift_shape_check_backstop.sql';
const sql = readFileSync(MIGRATION, 'utf8');

/** The integer a named constraint compares against. */
function constraintBody(name: string): string {
    const m = new RegExp(`ADD CONSTRAINT ${name}\\s+CHECK \\(([\\s\\S]*?)\\)\\s*\\n\\s*NOT VALID`).exec(sql);
    expect(m, `${name} is not defined in ${MIGRATION}`).not.toBeNull();
    return m![1];
}

describe('the database backstop agrees with the shape layer', () => {
    it('uses the same 12-hour net maximum', () => {
        expect(constraintBody('shifts_shape_max_duration'))
            .toContain(`<= ${DEFAULT_SHAPE_CONFIG.max_shift_minutes}`);
    });

    it('uses the same full-time 7.6h floor', () => {
        expect(constraintBody('shifts_shape_ft_min_day'))
            .toContain(`>= ${DEFAULT_SHAPE_CONFIG.ft_min_ordinary_day_minutes}`);
    });

    it('uses cl 12.3(e)’s flat three hours for plain part-time', () => {
        // The one engagement tier that needs neither the calendar nor the
        // training flag, so it can be carried exactly rather than loosely.
        const { requiredMins } = requiredMinEngagementMinutes({ target: 'PT', isFlexible: false });
        expect(requiredMins).toBe(180);
        expect(constraintBody('shifts_shape_pt_min_engagement')).toContain(`>= ${requiredMins}`);
    });

    it('floors every non-full-time shift at the shortest tier in cl 12', () => {
        // The absolute floor must equal the SMALLEST value the tier function
        // can return, or the constraint is stricter than the agreement on the
        // one case the concession exists for.
        const tiers = [
            requiredMinEngagementMinutes({ target: 'Casual' }).requiredMins,
            requiredMinEngagementMinutes({ target: 'Casual', isTraining: true }).requiredMins,
            requiredMinEngagementMinutes({ target: 'Casual', isSunday: true }).requiredMins,
            requiredMinEngagementMinutes({ target: 'Casual', isPublicHoliday: true }).requiredMins,
            requiredMinEngagementMinutes({ target: 'PT', isFlexible: true, isTraining: true }).requiredMins,
        ];
        expect(constraintBody('shifts_shape_min_engagement_floor'))
            .toContain(`>= ${Math.min(...tiers)}`);
    });

    it('uses the same cl 36.1 threshold and minimum', () => {
        const body = constraintBody('shifts_shape_meal_break');
        expect(body).toContain(`<= ${DEFAULT_SHAPE_CONFIG.meal_break_threshold_minutes}`);
        expect(body).toContain(`>= ${DEFAULT_SHAPE_CONFIG.meal_break_min_minutes}`);
    });

    it('uses the same cl 37 rest-pause thresholds', () => {
        const body = constraintBody('shifts_shape_rest_pause');
        expect(body).toContain(`< ${DEFAULT_SHAPE_CONFIG.rest_pause_1_threshold_minutes}`);
        expect(body).toContain(`>= ${DEFAULT_SHAPE_CONFIG.rest_pause_2_threshold_minutes}`);
        expect(body).toContain(`THEN ${DEFAULT_SHAPE_CONFIG.rest_pause_minutes * 2}`);
        expect(body).toContain(`ELSE ${DEFAULT_SHAPE_CONFIG.rest_pause_minutes}`);
    });
});

describe('the backstop stays loose exactly where it cannot see', () => {
    it('accepts EITHER break field for the meal break', () => {
        // The app reads the unpaid field, or the paid one for Security. A row
        // cannot resolve a role name, so requiring the unpaid field would
        // reject every lawful Security shift.
        expect(constraintBody('shifts_shape_meal_break'))
            .toMatch(/unpaid_break_minutes, 0\) \+ COALESCE\(paid_break_minutes, 0\) >= 30/);
    });

    it('does not attempt the public-holiday minimum', () => {
        // cl 56.2 needs a calendar that lives in a JS library, not a table.
        // Carrying it here would mean guessing, and a guess in this direction
        // rejects lawful shifts.
        expect(sql).not.toMatch(/ADD CONSTRAINT \S*public_holiday/);
        expect(sql).not.toContain('>= 240');
    });

    it('never claims to replace the application layer', () => {
        // If this ever reads as the authority, the next person will trust it
        // for the rules it deliberately omits.
        expect(sql).toContain('DELIBERATELY WEAKER THAN THE APPLICATION LAYER');
        expect(sql).toContain('WHAT IT DOES NOT CARRY, AND WHY');
    });
});
