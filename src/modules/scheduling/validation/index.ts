/**
 * Assignment validation — Public API
 *
 * The AutoScheduler's compliance gate. `AssignmentValidator.simulate()` runs
 * twice per solve: once to build the preview, and again as the pre-commit
 * concurrency recheck against fresh DB state.
 *
 * This lived at `rosters/bulk-assignment/` until the manual bulk-assignment UI
 * was removed, leaving the engine with one consumer in another module. The name
 * described a deleted feature, which is part of why a lookup table dropping
 * three BLOCKING rules read as a roster-UI concern rather than a solver one.
 */

export type {
    CandidateShift,
    SimulatedRoster,
    PreflightViolationCode,
    ViolationCode,
    ShiftViolation,
    ShiftAssignmentStatus,
    ShiftAssignmentResult,
    ValidationRunResult,
    ValidationRunOptions,
    EmployeeInfo,

} from './types';

export { AssignmentValidator, assignmentValidator } from './assignment-validator';
export { ScenarioLoader, scenarioLoader } from './engine/scenario-loader';
export { ShiftSorter, shiftSorter } from './engine/shift-sorter';
export { IncrementalValidator, incrementalValidator } from './engine/incremental-validator';
export { ComplianceEvaluator, complianceEvaluator } from './engine/compliance-evaluator';
export { ConflictReporter, conflictReporter } from './engine/conflict-reporter';
export { AssignmentCommitter, assignmentCommitter } from './engine/assignment-committer';
export type { AtomicCommitResult } from './engine/assignment-committer';
export type { LoadedScenario } from './engine/scenario-loader';
