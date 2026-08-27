/**
 * Baseline FT — pattern gate.
 *
 * Runs BEFORE any employee is resolved and before any candidate is generated.
 * If the pattern itself is unlawful, no amount of correct downstream logic can
 * produce a lawful roster from it, and a generator that faithfully reproduces
 * an unlawful pattern is worse than no generator at all — it launders the
 * breach through an automated system that appears to have checked it.
 *
 * WHY THIS IS NOT HYPOTHETICAL. The obvious full-time week — Monday to Friday,
 * 08:00–16:30 with a 30-minute unpaid break — is 8.0h net per day, 40h per
 * week, 160h per four-week cycle, against a ceiling of 152h. That is exactly
 * the breach standing against all four full-time employees in production
 * (160/160/155/155 against 152). A compliant five-day full-time week is 7.6h
 * net per day EXACTLY: cl 35.1(c) makes 7.6h the daily floor and 38 ÷ 5 lands
 * on it, so a five-day pattern has no slack in either direction.
 *
 * TWO CHECKS, TWO DIFFERENT FAILURES.
 *   1. SHAPE — is each slot a lawful full-time shift on its own? Delegated to
 *      `evaluateShiftShape`, the same evaluator the write gate calls, so the
 *      pattern check and the write gate cannot disagree about what a lawful
 *      shift is.
 *   2. VOLUME — does the pattern, repeated, fit inside the cycle ceiling? This
 *      has no existing owner: the shape layer is employee-free by design and
 *      cannot see the contract, while the V8 averaging rule only ever sees
 *      shifts that already exist.
 */

import {
    evaluateShiftShape,
    type ShapeInput,
} from '@/modules/compliance/shape';
import { cycleCeilingHours } from '@/modules/compliance/ordinary-hours-cycle';
import type { BaselinePattern, EmployeeContractFacts, Finding, IsoWeekday } from './types';

/** cl 35.x(a) — the weekly basis the ladder is built from. */
const DEFAULT_WEEKLY_HOURS = 38;

/**
 * A date known to be a Monday, used only to give `evaluateShiftShape` a date.
 *
 * The shape rules that actually depend on a date — cl 56.2's public-holiday
 * minimum and the Sunday tier of the engagement floor — cannot be decided from
 * a pattern, which carries a weekday and not a calendar day. Feeding a Monday
 * that is not a public holiday evaluates every date-independent rule correctly
 * and leaves the two date-typed ones to be checked per candidate later, which
 * is where they belong. `is_sunday`/`is_public_holiday` are passed explicitly
 * so nothing is inferred from this placeholder.
 */
const SHAPE_PROBE_DATE = '2024-01-01';

const DAY_NAMES: Record<IsoWeekday, string> = {
    1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
    5: 'Friday', 6: 'Saturday', 7: 'Sunday',
};

/** Round to one decimal for display without letting float noise into the text. */
function h(hours: number): string {
    return (Math.round(hours * 10) / 10).toFixed(1);
}

/**
 * Validate a pattern against the contract it will be generated for.
 *
 * Returns findings. Any BLOCKING finding means the run must not proceed — the
 * pattern is common to every employee in the sub-department, so a pattern-level
 * failure is the one case that aborts wholesale rather than dropping a single
 * candidate.
 */
export function validatePattern(
    pattern: BaselinePattern,
    facts: Pick<EmployeeContractFacts, 'contractedWeeklyHours' | 'cycleWeeks' | 'roleId'>,
    options: { isSecurityRole?: boolean } = {},
): Finding[] {
    const findings: Finding[] = [];

    // ── 0. A pattern with no slots generates nothing, silently. Say so. ──────
    if (pattern.slots.length === 0) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_PATTERN_EMPTY',
            plain: 'This template has no shifts, so there is no working pattern to generate from.',
            overridable: false,
            calculation: { template_id: pattern.templateId },
        });
        return findings;
    }

    // ── 1. Every slot must name a weekday (see PatternSlot.dayOfWeek) ────────
    //
    // Checked before shape, because a slot with no weekday cannot be placed on
    // a calendar at all — reporting that its meal break is short would be
    // answering the wrong question.
    const undated = pattern.slots.filter(
        s => s.dayOfWeek === null || s.dayOfWeek === undefined,
    );
    if (undated.length > 0) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_PATTERN_NO_WEEKDAY',
            plain:
                `${undated.length} of ${pattern.slots.length} shifts in this template have no day ` +
                `of the week set, so the template describes shift shapes but not a weekly pattern. ` +
                `Set a day on each shift before using it as a baseline.`,
            overridable: false,
            calculation: {
                template_id: pattern.templateId,
                shifts_without_weekday: undated.map(s => s.templateShiftId),
                total_shifts: pattern.slots.length,
            },
        });
        return findings;   // nothing below is meaningful without weekdays
    }

    // ── 2. Shape — delegated, never re-implemented ───────────────────────────
    for (const slot of pattern.slots) {
        const input: ShapeInput = {
            shift_date: SHAPE_PROBE_DATE,
            start_time: slot.startTime,
            end_time: slot.endTime,
            unpaid_break_minutes: slot.unpaidBreakMinutes,
            paid_break_minutes: slot.paidBreakMinutes,
            target_employment_type: 'FT',
            is_security: options.isSecurityRole ?? false,
            // Stated rather than derived from SHAPE_PROBE_DATE: the two
            // date-typed rules belong to the candidate, not the pattern.
            is_sunday: slot.dayOfWeek === 7,
            is_public_holiday: false,
        };

        const result = evaluateShiftShape(input);
        for (const hit of result.hits) {
            findings.push({
                severity: hit.blocking ? 'BLOCKING' : 'WARNING',
                code: hit.rule_id,
                plain:
                    `${DAY_NAMES[slot.dayOfWeek]} ${slot.startTime}–${slot.endTime}: ${hit.summary}.`,
                clause: extractClause(hit.details),
                overridable: !hit.blocking,
                calculation: { ...hit.calculation, template_shift_id: slot.templateShiftId },
            });
        }
    }

    // ── 3. Volume — does the repeated pattern fit the cycle ceiling? ─────────
    //
    // The pattern is a WEEK. The ceiling is a CYCLE. Comparing them means
    // scaling the pattern up by the cycle length, which is exact because a
    // cycle is a whole number of weeks (cl 12.2(b) — "up to four (4) weeks").
    const weeklyHours = facts.contractedWeeklyHours ?? DEFAULT_WEEKLY_HOURS;
    const patternWeeklyHours = pattern.slots.reduce((sum, s) => sum + s.netMinutes, 0) / 60;
    const ceiling = cycleCeilingHours(facts.cycleWeeks, weeklyHours);
    const patternCycleHours = patternWeeklyHours * facts.cycleWeeks;

    // Tolerance of one minute. Net minutes are integers, so anything larger
    // than rounding is a real overrun; anything smaller is float noise from
    // the ÷60. Being strict here is the point of the check.
    const OVERRUN_TOLERANCE_HOURS = 1 / 60;

    if (patternCycleHours > ceiling + OVERRUN_TOLERANCE_HOURS) {
        const overrunPerWeek = patternWeeklyHours - weeklyHours;
        const perDayMinutes = Math.ceil((overrunPerWeek * 60) / pattern.slots.length);
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_PATTERN_EXCEEDS_CONTRACT',
            plain:
                `This pattern is ${h(patternWeeklyHours)}h per week. A contract of ` +
                `${h(weeklyHours)}h per week over a ${facts.cycleWeeks}-week cycle allows ` +
                `${h(ceiling)}h; this pattern produces ${h(patternCycleHours)}h. ` +
                `Shorten each of the ${pattern.slots.length} days by about ${perDayMinutes} minutes, ` +
                `or drop a day from the cycle.`,
            clause: 'ICC EBA cl 35.1(a)',
            overridable: false,
            calculation: {
                pattern_weekly_hours: patternWeeklyHours,
                contracted_weekly_hours: weeklyHours,
                cycle_weeks: facts.cycleWeeks,
                cycle_ceiling_hours: ceiling,
                pattern_cycle_hours: patternCycleHours,
                overrun_hours: patternCycleHours - ceiling,
            },
        });
    }

    // ── 4. Under-fill is legitimate, but silent under-fill is not ───────────
    //
    // A pattern below the contract can never satisfy it, so every run against
    // it will report a permanent variance. That is a valid answer, but a
    // manager should learn it once here rather than inferring it from a column
    // of non-zero variances.
    if (patternCycleHours < ceiling - OVERRUN_TOLERANCE_HOURS) {
        findings.push({
            severity: 'WARNING',
            code: 'BFT_PATTERN_BELOW_CONTRACT',
            plain:
                `This pattern is ${h(patternWeeklyHours)}h per week against a contracted ` +
                `${h(weeklyHours)}h. Even fully rostered it leaves ` +
                `${h(ceiling - patternCycleHours)}h unfilled each ${facts.cycleWeeks}-week cycle, ` +
                `which will show as a variance for every employee on it.`,
            clause: 'ICC EBA cl 35.1(a)',
            overridable: true,
            calculation: {
                pattern_weekly_hours: patternWeeklyHours,
                contracted_weekly_hours: weeklyHours,
                shortfall_per_cycle_hours: ceiling - patternCycleHours,
            },
        });
    }

    // ── 5. Two slots on one weekday is a split shift, which FT may not work ──
    //
    // cl 39.1 authorises split shifts for part-time and flexible part-time only.
    // Note the tension with cl 7.14, which DEFINES a split shift for any
    // non-casual: the definition is broader than the authorisation, and the
    // authorisation is what governs whether we may roster one.
    const byDay = new Map<IsoWeekday, number>();
    for (const s of pattern.slots) byDay.set(s.dayOfWeek, (byDay.get(s.dayOfWeek) ?? 0) + 1);
    for (const [day, count] of byDay) {
        if (count > 1) {
            findings.push({
                severity: 'BLOCKING',
                code: 'BFT_PATTERN_SPLIT_SHIFT',
                plain:
                    `This pattern puts ${count} shifts on ${DAY_NAMES[day]}. A full-time day ` +
                    `may not be split — split shifts are available to part-time and flexible ` +
                    `part-time Team Members only.`,
                clause: 'ICC EBA cl 39.1',
                overridable: false,
                calculation: { day_of_week: day, shift_count: count },
            });
        }
    }

    // ── 6. Pattern role must be the role the contract authorises ────────────
    //
    // The pattern DECLARES; the contract AUTHORISES. A mismatch is never
    // resolved by substituting the contract's role — that would silently
    // reassign the work and change what the shift is paid at.
    const patternRoles = new Set(pattern.slots.map(s => s.roleId));
    for (const roleId of patternRoles) {
        if (roleId !== facts.roleId) {
            findings.push({
                severity: 'BLOCKING',
                code: 'BFT_PATTERN_ROLE_MISMATCH',
                plain:
                    `This pattern rosters a role the employee's contract does not cover. ` +
                    `Use a pattern matching their contracted role, or update the contract.`,
                overridable: false,
                calculation: { pattern_role_id: roleId, contract_role_id: facts.roleId },
            });
        }
    }

    return findings;
}

/**
 * Pull an `ICC EBA cl …` reference out of a shape hit's prose.
 *
 * The shape layer writes the clause into `details` rather than exposing it as a
 * field, so this reads it back rather than maintaining a second mapping from
 * rule id to clause — a mapping that could drift from the rule it describes.
 * Returns undefined when a rule genuinely has no clause (the house-policy
 * spread guardrail), which is correct: not every rule is an EBA rule.
 */
function extractClause(details: string): string | undefined {
    const m = details.match(/ICC EBA (cl|Schedule)[^).]*/i);
    return m ? m[0].trim().replace(/[,.]$/, '') : undefined;
}
