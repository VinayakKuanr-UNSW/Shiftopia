/**
 * TOIL — time off in lieu for salaried class-1 contracts.
 *
 * Earned in the database from approved timesheets (migration 20261010082231),
 * taken as leave type 'toil', paid out on request / at 6 months / when the
 * salaried contract ends. See docs/modules/toil/README.md.
 */
export type { ToilEntryType, ToilLedgerEntry, ToilLot, ToilPosition } from './model/toil.types';
export {
    TOIL_DAILY_THRESHOLD_MINUTES,
    FULL_TIME_WEEK_MINUTES,
    TOIL_EXPIRY_MONTHS,
    isToilEligibleContract,
    dailyAccrualMinutes,
    weeklyTopupMinutes,
    toilHours,
    fmtToil,
    hoursToMinutes,
    toilRequestCheck,
    toilApprovalCheck,
    payoutCheck,
    describeEntry,
    toilPayoutHourlyRate,
    isPartialDayToil,
    rosteredSpanMinutes,
} from './domain/toil-rules';
export {
    getToilPositions,
    getToilLedger,
    getToilLots,
    getDailyToilByDay,
    getToilEntriesInRange,
    requestToilPayout,
    adjustToil,
} from './api/toil.api';
export { toilKeys, invalidateToil, useToilInvalidation, useToilPositions, useToilLedger, useToilLots } from './hooks/useToil';
export { ToilLedgerDialog } from './ui/ToilLedgerDialog';
