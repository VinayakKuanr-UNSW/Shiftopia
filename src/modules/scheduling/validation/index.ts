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
    ValidationRunResult,
} from './types';

export { assignmentValidator } from './assignment-validator';
