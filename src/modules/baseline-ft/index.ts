/**
 * Baseline FT Schedule — public surface.
 *
 * The domain layer is pure and complete on its own: given a pattern, a
 * contract, the existing roster, leave and holidays, it decides exactly which
 * shifts SHOULD exist and why every rejected candidate was rejected. It writes
 * nothing. Persistence, the run/proposal tables and the review UI sit on top of
 * this and are deliberately thinner than it, because this is where the
 * compliance risk lives.
 *
 * Read the modules in pipeline order:
 *   validatePattern          — is this pattern lawful at all? (aborts the run)
 *   computeCycleRequirements — what does the contract owe, per anchored cycle?
 *   generateCandidates       — which shifts would discharge that, and what is left over?
 *   admitCandidates          — which of them survive the compliance engine as a SET?
 */

export type {
    BaselinePattern,
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
