/**
 * Office — the full-time domain, without a page of its own.
 *
 * THE OFFICE PAGE WAS RETIRED 2026-10-04 (handover Phase 4). Full-time shifts
 * live on the Rosters page in the Office group; `/office` redirects there. What
 * remains here is what the Rosters page uses: the cycle ledger
 * (`computeProposal`), the Copy-to flow (`ui/components/CopyShiftFlow`), the
 * leave loader (`api/office.loaders`), and the pure domain below.
 *
 * The domain layer is pure and complete on its own: given a pattern, a
 * contract, the existing roster, leave and holidays, it decides exactly which
 * shifts SHOULD exist and why every rejected candidate was rejected. It writes
 * nothing. Persistence, the run/proposal tables and the review UI sit on top of
 * this and are deliberately thinner than it, because this is where the
 * compliance risk lives.
 *
 * Read the modules in pipeline order:
 *   patternRow               — the editable line, and the derivations under it
 *   validatePattern          — is this pattern lawful? (drops ONE employee)
 *   computeCycleRequirements — what does the contract owe, per anchored cycle?
 *   generateCandidates       — which shifts would discharge that, and what is left over?
 *   admitCandidates          — which of them survive the compliance engine as a SET?
 *
 * A pattern belongs to ONE EMPLOYEE. It was once a shared `roster_templates`
 * row per sub-department, and a blocking finding aborted the whole run — which
 * meant a team holding three different roles generated nothing at all, because
 * a single shared template can only ever name one of them.
 */

export type {
    OfficePattern,
    RawLeaveDay,
    Candidate,
    CycleRequirement,
    EmployeeContractFacts,
    ExistingShift,
    Finding,
    IsoWeekday,
    LeaveDay,
    PatternSlot,
    Severity,
} from './domain/types';
export { hasBlocking } from './domain/types';

export { validatePattern } from './domain/patternValidator';

export {
    computeCycleRequirements,
    datesBetween,
    isoWeekdayOf,
    DEFAULT_WEEKLY_HOURS,
    type RequirementInput,
    type RequirementResult,
} from './domain/requirementCalculator';

export {
    buildIdempotencyKey,
    generateCandidates,
    type GenerateInput,
    type GenerateResult,
    type RunScope,
} from './domain/candidateGenerator';

export {
    admitCandidates,
    type AdmissionInput,
    type AdmissionResult,
} from './domain/admissionEngine';

export {
    ISO_WEEK,
    DAY_LONG,
    DAY_SHORT,
    attachLeaveCredit,
    cycleVerdict,
    deriveRow,
    grossMinutesBetween,
    patternHoursByWeekday,
    rowToSlots,
    rowsToPattern,
    seedRow,
    type CycleVerdict,
    type PatternRow,
    type RowDerivation,
} from './domain/patternRow';

export {
    designPattern,
    lawfulDayCounts,
    requiredPaidBreakMinutes,
    FT_MIN_DAY_MINUTES,
    FT_MAX_DAY_MINUTES,
} from './domain/patternDesigner';
