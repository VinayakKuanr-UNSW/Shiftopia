/**
 * Compliance Engine v2 — Batch Constraint Hook
 *
 * Generates solver-agnostic ConstraintDescriptorV2 objects from a RuleContextV2.
 * These descriptors can be fed to OR-Tools, GLPK, or a custom bidding heuristic
 * without re-implementing any rule logic.
 *
 * Each rule maps to one or more constraint types:
 *   R01 → NO_OVERLAP    (all relevant shifts)
 *   R03 → MAX_SUM       (per calendar day)
 *   R04 → MAX_SUM       (28-day window)
 *   R05 → FORTNIGHTLY_CAP (14-day, STUDENT_VISA only)
 *   R07 → MIN_GAP       (per adjacent pair)
 *   R09 → MAX_STREAK    (28-day window)
 *   R10 → MEMBERSHIP    (role eligibility, per candidate shift)
 *   R11 → MEMBERSHIP    (qualification presence, per (shift × qual))
 *   R12 → MEMBERSHIP    (qualification expiry, per (shift × qual))
 */

import { RuleContextV2, ConstraintDescriptorV2 } from './types';
import {
    toAbsoluteMinutes,
    shiftGrossMinutes,
    workingDaysInWindow,
    uniqueShiftIdsFromSegments,
} from './windows';

export function generateConstraints(ctx: RuleContextV2): ConstraintDescriptorV2[] {
    const out: ConstraintDescriptorV2[] = [];

    // ── R01: No overlap ────────────────────────────────────────────────────────
    out.push({
        rule_id:         'R01_NO_OVERLAP',
        constraint_type: 'NO_OVERLAP',
        variables:       ctx.relevant_shifts.map(s => s.shift_id),
        parameters:      {},
        is_hard:         true,
    });

    // ── R03: Max daily hours — one constraint per candidate-touched day ────────
    const touchedDays = new Set(ctx.candidate_shifts.map(s => s.shift_date));
    for (const day of touchedDays) {
        const segs = ctx.shifts_by_day.get(day) ?? [];
        const shiftIds = uniqueShiftIdsFromSegments(segs);
        out.push({
            rule_id:         'R03_MAX_DAILY_HOURS',
            constraint_type: 'MAX_SUM',
            variables:       shiftIds,
            parameters:      { max_hours: ctx.config.max_daily_hours, day },
            is_hard:         true,
        });
    }

    // ── R04: Max working days per 28d ──────────────────────────────────────────
    out.push({
        rule_id:         'R04_MAX_WORKING_DAYS',
        constraint_type: 'MAX_SUM',
        variables:       ctx.window_28d.map(s => s.shift_id),
        parameters:      { max_days: ctx.config.max_working_days_per_28, window_days: 28 },
        is_hard:         false,
    });

    // ── R05: Student visa fortnightly cap (conditional) ────────────────────────
    if (ctx.employee.contract_type === 'STUDENT_VISA') {
        out.push({
            rule_id:         'R05_STUDENT_VISA',
            constraint_type: 'FORTNIGHTLY_CAP',
            variables:       ctx.window_14d.map(s => s.shift_id),
            parameters:      { max_hours: ctx.config.student_visa_fortnightly_h, window_days: 14 },
            is_hard:         true,
        });
    }

    // ── R07: Min rest gap — one constraint per adjacent pair in relevant window ─
    const sortedRelevant = [...ctx.relevant_shifts].sort((a, b) => {
        const dc = a.shift_date.localeCompare(b.shift_date);
        if (dc !== 0) return dc;
        return toAbsoluteMinutes(a.shift_date, a.start_time)
             - toAbsoluteMinutes(b.shift_date, b.start_time);
    });

    for (let i = 0; i < sortedRelevant.length - 1; i++) {
        const a = sortedRelevant[i];
        const b = sortedRelevant[i + 1];
        out.push({
            rule_id:         'R07_REST_GAP',
            constraint_type: 'MIN_GAP',
            variables:       [a.shift_id, b.shift_id],
            parameters:      { min_gap_hours: ctx.config.rest_gap_hours },
            is_hard:         true,
        });
    }

    // ── R09: Max consecutive days ──────────────────────────────────────────────
    const wDays = workingDaysInWindow(ctx.shifts_by_day, ctx.reference_date, 28);
    out.push({
        rule_id:         'R09_MAX_CONSECUTIVE_DAYS',
        constraint_type: 'MAX_STREAK',
        variables:       ctx.window_28d.map(s => s.shift_id),
        parameters:      { max_streak: ctx.config.max_consecutive_days, working_days: wDays },
        is_hard:         false,
    });

    // ── R10: Role contract match (per candidate shift) ─────────────────────────
    for (const shift of ctx.candidate_shifts) {
        out.push({
            rule_id:         'R10_ROLE_CONTRACT_MATCH',
            constraint_type: 'MEMBERSHIP',
            variables:       [shift.shift_id],
            parameters:      {
                required_role:  shift.role_id,
                allowed_roles:  ctx.employee.assigned_role_ids,
            },
            is_hard: true,
        });
    }

    // ── R11 + R12: Qualification presence + expiry (per shift × qualification) ─
    const qualMap = new Map(ctx.employee.qualifications.map(q => [q.qualification_id, q]));

    for (const shift of ctx.candidate_shifts) {
        for (const reqQual of shift.required_qualifications) {
            // R11 — must hold the qualification
            out.push({
                rule_id:         'R11_QUALIFICATIONS',
                constraint_type: 'MEMBERSHIP',
                variables:       [shift.shift_id],
                parameters:      {
                    required_qual: reqQual,
                    held_quals:    [...qualMap.keys()],
                },
                is_hard: true,
            });

            // R12 — held qualification must not be expired at shift start
            const held = qualMap.get(reqQual);
            if (held?.expires_at) {
                out.push({
                    rule_id:         'R12_QUAL_EXPIRY',
                    constraint_type: 'MEMBERSHIP',
                    variables:       [shift.shift_id],
                    parameters:      {
                        qualification_id: reqQual,
                        expires_at:       held.expires_at,
                        shift_date:       shift.shift_date,
                    },
                    is_hard: true,
                });
            }
        }
    }

    return out;
}
