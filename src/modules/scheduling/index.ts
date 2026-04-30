/**
 * Scheduling Module — Public API
 *
 * Two-layer workforce schedule optimization:
 *   Layer 1: OR-Tools CP-SAT optimizer (proposes assignments)
 *   Layer 2: Compliance engine (validates before commit)
 */

export type {
    OptimizerShift,
    OptimizerEmployee,
    OptimizerConstraints,
    OptimizeRequest,
    OptimizerStatus,
    AssignmentProposal,
    OptimizeResponse,
    ProposalValidationStatus,
    ValidatedProposal,
    AutoSchedulerResult,
    OptimizerHealth,
} from './types';

export {
    AutoSchedulerController,
    autoSchedulerController,
    AutoSchedulerInputTooLargeError,
    MAX_OPTIMIZER_SHIFTS,
    MAX_OPTIMIZER_EMPLOYEES,
} from './auto-scheduler.controller';
export type { AutoSchedulerInput, CommitResult } from './auto-scheduler.controller';

export { OptimizerClient, OptimizerError, optimizerClient } from './optimizer/optimizer.client';
export { SolutionParser, solutionParser } from './optimizer/solution-parser';
export type { ShiftMeta, EmployeeMeta, EnrichedProposal, EmployeeProposalGroup } from './optimizer/solution-parser';
