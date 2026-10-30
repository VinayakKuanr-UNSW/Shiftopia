/**
 * Scheduling Module — Public API
 *
 * Two-layer workforce schedule optimization:
 *   Layer 1: OR-Tools CP-SAT optimizer (proposes assignments)
 *   Layer 2: Compliance engine (validates before commit)
 */

export type {
    ValidatedProposal,
    AutoSchedulerResult,
    OptimizerHealth,
} from './types';

export {
    autoSchedulerController,
    AutoSchedulerInputTooLargeError,
} from './auto-scheduler.controller';

export type { ShiftMeta, EmployeeMeta } from './optimizer/solution-parser';
