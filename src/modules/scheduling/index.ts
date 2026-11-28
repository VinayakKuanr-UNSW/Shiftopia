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
    SchedulerMode,
    SolverSchedulerMode,
} from './types';

export {
    autoSchedulerController,
    AutoSchedulerInputTooLargeError,
    FT_SECURITY_WEEKLY_CONTRACT_MINUTES,
    PT_MIN_ENGAGEMENT_MINUTES,
    PT_PH_MIN_ENGAGEMENT_MINUTES,
    PT_MAX_DAILY_NET_MINUTES,
    FPT_MIN_ENGAGEMENT_MINUTES,
    FPT_TRAINING_MIN_ENGAGEMENT_MINUTES,
    FPT_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES,
    FPT_MAX_DAILY_NET_MINUTES,
    FPT_MAX_CONSECUTIVE_DAYS,
    FPT_WEEKLY_CONTRACT_MINUTES,
    CASUAL_MIN_ENGAGEMENT_MINUTES,
    CASUAL_TRAINING_MIN_ENGAGEMENT_MINUTES,
    CASUAL_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES,
    CASUAL_EVENT_SECURITY_MIN_ENGAGEMENT_MINUTES,
    CASUAL_MAX_DAILY_NET_MINUTES,
    CASUAL_MAX_DAILY_ENGAGEMENTS,
    baselineWeeklyContractMinutes,
    resolvePtWeeklyContractMinutes,
    resolveFptWeeklyContractMinutes,
    isStandardFtShift,
    isStandardFtEmployee,
    isFtSecurityShift,
    isFtSecurityEmployee,
    isPtShift,
    isPtEmployee,
    isFptShift,
    isFptEmployee,
    isCasualShift,
    isCasualEmployee,
    shiftNetMinutes,
    deriveSecurityRoleIds,
    type AutoSchedulerInput,
} from './auto-scheduler.controller';

export type { ShiftMeta, EmployeeMeta } from './optimizer/solution-parser';
