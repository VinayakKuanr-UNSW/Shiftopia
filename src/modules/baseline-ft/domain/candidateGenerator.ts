/**
 * Baseline FT — turning a pattern and a deficit into candidate shifts.
 *
 * THE RULE THAT DEFINES THIS FEATURE. When the remaining deficit is smaller
 * than the next pattern day, the generator STOPS and reports the remainder as
 * a variance. It never shrinks a shift to fit, never splits one across days,
 * and never adds a short "top-up" shift. cl 35.1(c) sets 7.6h as the floor for
 * a full-time ordinary day, so a 24-minute shift is not a smaller version of a
 * lawful shift — it is an unlawful one. An honest variance is a better answer
 * than a tidy total, and saying so is most of what this module does.
 *
 * DETERMINISM. Candidates are emitted in a total order — date ascending, then
 * the pattern's own `sortOrder`, then template shift id as a final tiebreak —
 * and nothing here reads a clock, a random source, or the iteration order of a
 * `Set`. Two runs over identical inputs therefore produce byte-identical
 * output, which is what makes "generate twice, get the same proposal" a test
 * rather than a hope.
 */

import type {
    BaselinePattern,
    Candidate,
    CycleRequirement,
    EmployeeContractFacts,
    ExistingShift,
    Finding,
    IsoWeekday,
    PatternSlot,
} from './types';
import { datesBetween, isoWeekdayOf } from './requirementCalculator';

export interface GenerateInput {
    facts: EmployeeContractFacts;
    pattern: BaselinePattern;
    cycles: readonly CycleRequirement[];
    /** EVERY shift the employee holds — used to detect days already worked. */
    existingShifts: readonly ExistingShift[];
    /** Roster period, inclusive. Candidates never fall outside it. */
    periodStart: string;
    periodEnd: string;
    /** Identifies the run's scope; part of every idempotency key. */
    scope: RunScope;
}

/**
 * The scope a proposal belongs to.
 *
 * Deliberately NOT the run id. Keying candidates on a run id would let
 * Generate → Apply → Generate → Apply create the same shift twice, because the
 * second run has a different id. Keying on the scope makes the key describe
 * THE SHIFT, which is the thing that must be unique.
 */
export interface RunScope {
    subDepartmentId: string;
    periodStart: string;
    periodEnd: string;
    templateId: string;
}

export interface GenerateResult {
    candidates: Candidate[];
    findings: Finding[];
}

/**
 * A readable composite key rather than a hash.
 *
 * A hash cannot be debugged from a database row, and the uniqueness needed here
 * is exact rather than probabilistic — a collision would silently drop a real
 * shift. The components are exactly the facts that make two candidates "the
 * same shift": who, when, what shape, what role, within which scope.
 */
export function buildIdempotencyKey(scope: RunScope, c: {
    employeeId: string; shiftDate: string; startTime: string; endTime: string; roleId: string;
}): string {
    return [
        'bft',
        scope.subDepartmentId,
        `${scope.periodStart}_${scope.periodEnd}`,
        scope.templateId,
        c.employeeId,
        c.shiftDate,
        `${c.startTime}-${c.endTime}`,
        c.roleId,
    ].join(':');
}

/** Total, stable ordering of pattern slots within a day. */
function bySlotOrder(a: PatternSlot, b: PatternSlot): number {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.templateShiftId < b.templateShiftId ? -1 : a.templateShiftId > b.templateShiftId ? 1 : 0;
}

function formatHm(hours: number): string {
    const total = Math.round(hours * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function generateCandidates(input: GenerateInput): GenerateResult {
    const { facts, pattern, cycles, existingShifts, periodStart, periodEnd, scope } = input;
    const candidates: Candidate[] = [];
    const findings: Finding[] = [];

    // Days the employee already works, anywhere. A day with an existing shift
    // is not available for a baseline shift: a second shift on the same day
    // would be a split shift, which cl 39.1 does not authorise for full-time.
    const workedDates = new Set(existingShifts.map(s => s.date));

    // Pattern slots bucketed by weekday, each bucket pre-sorted so the emission
    // order below is fixed by data rather than by traversal accident.
    const slotsByDay = new Map<IsoWeekday, PatternSlot[]>();
    for (const slot of pattern.slots) {
        const bucket = slotsByDay.get(slot.dayOfWeek);
        if (bucket) bucket.push(slot);
        else slotsByDay.set(slot.dayOfWeek, [slot]);
    }
    for (const bucket of slotsByDay.values()) bucket.sort(bySlotOrder);

    // Cycles in index order — they are already chronological, but sorting makes
    // that a property of this function rather than of its caller.
    const ordered = [...cycles].sort((a, b) => a.cycleIndex - b.cycleIndex);

    for (const cycle of ordered) {
        let remainingHours = cycle.deficitHours;

        if (remainingHours <= 0) {
            findings.push({
                severity: 'INFO',
                code: 'BFT_CYCLE_SATISFIED',
                plain:
                    `Nothing to schedule between ${cycle.start} and ${cycle.endInclusive} — ` +
                    `existing shifts and leave already meet this employee's contracted hours.`,
                overridable: false,
                employeeId: facts.employeeId,
                calculation: {
                    required_hours: cycle.requiredHours,
                    existing_hours: cycle.existingHours,
                    cycle_start: cycle.start,
                    cycle_end: cycle.endInclusive,
                },
            });
            continue;
        }

        const blocked = new Set(cycle.blockedDates);

        // Candidate dates: inside the cycle AND inside the roster period.
        const from = cycle.start > periodStart ? cycle.start : periodStart;
        const to = cycle.endInclusive < periodEnd ? cycle.endInclusive : periodEnd;

        let stoppedShort: PatternSlot | null = null;

        outer:
        for (const date of datesBetween(from, to)) {
            const slots = slotsByDay.get(isoWeekdayOf(date));
            if (!slots) continue;                       // pattern does not work this weekday

            for (const slot of slots) {
                const slotHours = slot.netMinutes / 60;

                // ── The rule this module exists for ─────────────────────────
                // Tolerance of one minute absorbs the ÷60, nothing more.
                if (slotHours > remainingHours + 1 / 60) {
                    stoppedShort = slot;
                    break outer;
                }

                if (workedDates.has(date)) {
                    findings.push({
                        severity: 'INFO',
                        code: 'BFT_DAY_ALREADY_ROSTERED',
                        plain: `No shift proposed for ${date} — this employee is already rostered that day.`,
                        overridable: false,
                        employeeId: facts.employeeId,
                        calculation: { date },
                    });
                    continue;
                }

                if (blocked.has(date)) {
                    findings.push({
                        severity: 'INFO',
                        code: 'BFT_DAY_ON_LEAVE_OR_HOLIDAY',
                        plain:
                            `No shift proposed for ${date} — this employee is absent that day ` +
                            `(approved leave, or a public holiday they would ordinarily work).`,
                        clause: 'ICC EBA cl 56.4',
                        overridable: false,
                        employeeId: facts.employeeId,
                        calculation: { date },
                    });
                    continue;
                }

                const candidate: Candidate = {
                    employeeId: facts.employeeId,
                    userContractId: facts.userContractId,
                    templateShiftId: slot.templateShiftId,
                    shiftDate: date,
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    unpaidBreakMinutes: slot.unpaidBreakMinutes,
                    paidBreakMinutes: slot.paidBreakMinutes,
                    netMinutes: slot.netMinutes,
                    roleId: slot.roleId,
                    cycleIndex: cycle.cycleIndex,
                    idempotencyKey: buildIdempotencyKey(scope, {
                        employeeId: facts.employeeId,
                        shiftDate: date,
                        startTime: slot.startTime,
                        endTime: slot.endTime,
                        roleId: slot.roleId,
                    }),
                };
                candidates.push(candidate);
                workedDates.add(date);      // a generated day is a worked day
                remainingHours -= slotHours;
            }
        }

        // ── The honest variance ──────────────────────────────────────────────
        if (remainingHours > 1 / 60) {
            const reason = stoppedShort
                ? `the remaining ${formatHm(remainingHours)} is less than the ` +
                  `${formatHm(stoppedShort.netMinutes / 60)} of the next day in the pattern, and a ` +
                  `full-time day cannot be shortened below 7.6 hours`
                : `the pattern has no more working days left in this cycle`;

            findings.push({
                severity: 'INFO',
                code: 'BFT_RESIDUAL_VARIANCE',
                plain:
                    `${formatHm(remainingHours)} remains unscheduled between ${cycle.start} and ` +
                    `${cycle.endInclusive}. No additional shift proposed because ${reason}.`,
                clause: 'ICC EBA cl 35.1(c)',
                overridable: false,
                employeeId: facts.employeeId,
                calculation: {
                    residual_hours: remainingHours,
                    cycle_start: cycle.start,
                    cycle_end: cycle.endInclusive,
                    next_pattern_day_hours: stoppedShort ? stoppedShort.netMinutes / 60 : null,
                },
            });
        }
    }

    return { candidates, findings };
}
