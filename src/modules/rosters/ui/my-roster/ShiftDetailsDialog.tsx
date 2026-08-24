import React, { useState } from 'react';
import { isShiftLocked, isShiftCommenced } from '@/modules/rosters/domain/shift-locking.utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
  X,
  ArrowLeftRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Shift } from '@/modules/rosters';
import { useDropShift } from '@/modules/rosters/state/useRosterShifts';
import { AttendanceBadge } from '@/modules/rosters/ui/components/AttendanceBadge';

import { useSwaps } from '@/modules/planning';
import { useToast } from '@/modules/core/hooks/use-toast';
import CreateSwapRequestModal from './CreateSwapRequestModal';
import DropShiftDrawer from './DropShiftDrawer';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { resolveGroupVariant } from '@/modules/rosters/domain/shift-ui';
import { parseZonedDateTime, formatInTimezone, formatClockTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import { ZERO_COST_BREAKDOWN, COST_ESTIMATE_TITLE, COST_ESTIMATE_DISCLAIMER } from '@/modules/rosters/domain/projections/utils/cost/constants';
import { buildOrdinaryEarningsLines } from '@/modules/payroll/domain/computeShiftGrossPay';
import { useAuth } from '@/platform/auth/useAuth';
import { getShiftDayType } from '@/modules/core/lib/holidays';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import {
    resolveBillableSide,
    calculateNetMinutes,
    applyMinEngagementFloor,
    isShiftFinished as isShiftFinishedForBillable,
} from '@/modules/timesheets/domain/billable-time';

// Sydney-tz-safe "h:mm a" formatter for the raw actual-clock / resolved-billable
// wall-clock values ('HH:MM' or ISO) — mirrors the Timesheets card's own
// formatting so the two surfaces read identically, without the browser-local
// `Date.getHours()` shortcut that other ad-hoc formatters in this codebase use.
// The shared Sydney-pinned formatter. This file used to carry its own correct
// copy while two other surfaces carried their own incorrect ones — see
// `formatClockTime`.
const formatWallClock = (value: string | null | undefined) => formatClockTime(value);

interface ShiftWithDetails {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
}

interface ShiftDetailsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  shiftData: ShiftWithDetails | null;
  shiftDate: Date;
}

// ── Cost Tooltip ──────────────────────────────────────────────────────────
export const CostBreakdownTooltip: React.FC<{ breakdown: any }> = ({ breakdown }) => {
  if (!breakdown) return null;
  const { totalCost, ordinaryCost, overtimeCost, allowanceCost, ordinaryHours, overtimeHours, breakdown: details } = breakdown;
  return (
      <div className="space-y-2 p-1 min-w-[180px]">
          <div className="flex justify-between items-center pb-1 border-b border-white/10">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-90">{COST_ESTIMATE_TITLE}</span>
              <span className="text-xs font-bold text-emerald-400">${totalCost.toFixed(2)}</span>
          </div>
          <div className="space-y-1 text-[11px] tabular-nums">
              <div className="flex justify-between">
                  <span>Ordinary ({ordinaryHours.toFixed(1)}h @ ${details.penaltyRate.toFixed(2)})</span>
                  <span>${ordinaryCost.toFixed(2)}</span>
              </div>
              {overtimeCost > 0 && (
                  <div className="flex justify-between text-orange-300">
                      <span>Overtime ({overtimeHours.toFixed(1)}h)</span>
                      <span>${overtimeCost.toFixed(2)}</span>
                  </div>
              )}
              {allowanceCost > 0 && (
                  <div className="flex justify-between text-blue-300">
                      <span>Night Allowance ({details.nightHours.toFixed(1)}h)</span>
                      <span>${allowanceCost.toFixed(2)}</span>
                  </div>
              )}
          </div>
          <div className="pt-1 text-[11px] opacity-80 italic border-t border-white/10">
              {COST_ESTIMATE_DISCLAIMER}
          </div>
      </div>
  );
};

const ShiftDetailsDialog: React.FC<ShiftDetailsDialogProps> = ({
  isOpen,
  onClose,
  shiftData,
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { mySwapRequests, myActiveOfferDetails, isLoadingOfferDetails } = useSwaps();

  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);

  const dropShiftMutation = useDropShift();
  const isDropping = dropShiftMutation.isPending;

  const isPast = React.useMemo(() => {
    if (!shiftData?.shift?.shift_date || !shiftData?.shift?.end_time) return false;
    try {
      return parseZonedDateTime(shiftData.shift.shift_date, shiftData.shift.end_time, SYDNEY_TZ).getTime() < Date.now();
    } catch {
      return false;
    }
  }, [shiftData?.shift?.shift_date, shiftData?.shift?.end_time]);

  const isWithinLockoutPeriod = React.useMemo(() => 
    shiftData ? isShiftLocked(shiftData.shift.shift_date, shiftData.shift.start_time, 'my_roster') : false
  , [shiftData]);

  const isCommenced = React.useMemo(() => 
    shiftData ? isShiftCommenced(shiftData.shift.shift_date, shiftData.shift.start_time) : false
  , [shiftData]);

  const existingSwapRequest = React.useMemo(() => 
    mySwapRequests.find(
      s => (s.requester_shift_id === shiftData?.shift.id || s.target_shift_id === shiftData?.shift.id) &&
        (s.status === 'OPEN' || s.status === 'MANAGER_PENDING')
    )
  , [mySwapRequests, shiftData?.shift.id]);

  const isPendingInOffer = React.useMemo(() => 
    isLoadingOfferDetails
      ? true
      : myActiveOfferDetails?.some(offer => offer.offered_shift_id === shiftData?.shift.id)
  , [isLoadingOfferDetails, myActiveOfferDetails, shiftData?.shift.id]);

  const isActiveOrCommenced = shiftData?.shift.lifecycle_status === 'InProgress' || shiftData?.shift.lifecycle_status === 'Completed' || isCommenced;
  const hasCheckedIn = shiftData?.shift.attendance_status === 'checked_in' || shiftData?.shift.attendance_status === 'late';

  const isS3PendingOffer = shiftData?.shift.lifecycle_status === 'Published' && shiftData?.shift.assignment_status === 'assigned' && !shiftData?.shift.assignment_outcome;

  const isLockedFromActions = shiftData?.shift.is_cancelled || !!existingSwapRequest || isPendingInOffer || isWithinLockoutPeriod || isS3PendingOffer || isActiveOrCommenced || hasCheckedIn || isPast;

  const paidBreak = (shiftData?.shift as any)?.paid_break_minutes ?? 0;
  const unpaidBreak = (shiftData?.shift as any)?.unpaid_break_minutes ?? shiftData?.shift.break_minutes ?? 0;

  const netLengthMinutes = React.useMemo(() => {
    if (!shiftData?.shift.start_time || !shiftData?.shift.end_time) return 0;
    const [sh, sm] = shiftData.shift.start_time.split(':').map(Number);
    const [eh, em] = shiftData.shift.end_time.split(':').map(Number);
    let gross = (eh * 60 + em) - (sh * 60 + sm);
    if (gross < 0) gross += 1440;
    return Math.max(0, gross - unpaidBreak);
  }, [shiftData?.shift.start_time, shiftData?.shift.end_time, unpaidBreak]);

  const urgency = computeShiftUrgency(shiftData?.shift.shift_date || '', shiftData?.shift.start_time || '', (shiftData?.shift as any)?.start_at);

  const groupVariant = React.useMemo(() => {
    if (!shiftData) return 'default' as const;
    return resolveGroupVariant(
      shiftData.shift,
      shiftData.groupName || shiftData.shift?.departments?.name,
      shiftData.subGroupName || shiftData.shift?.sub_departments?.name
    );
  }, [shiftData]);

  const swapLabel = 'Swap';
  const dropLabel = 'Drop';

  // ── Billable window resolution ──────────────────────────────────────────
  // Same three-tier rule (manager edit → snapped actual → missing) the
  // Timesheets card uses — reusing the canonical resolver directly so the two
  // surfaces can never diverge on what "billable" means for this shift.
  const isFinishedForBillable = React.useMemo(() => {
    if (!shiftData?.shift) return false;
    return isShiftFinishedForBillable(
      shiftData.shift.shift_date,
      shiftData.shift.start_time,
      shiftData.shift.end_time,
      (shiftData.shift as any).actual_end ?? null,
    );
  }, [shiftData?.shift]);

  const resolvedBillableStart = React.useMemo(
    () => resolveBillableSide(
      (shiftData?.shift as any)?.adjusted_start ?? null,
      (shiftData?.shift as any)?.actual_start ?? null,
      isFinishedForBillable,
    ),
    [shiftData?.shift, isFinishedForBillable],
  );
  const resolvedBillableEnd = React.useMemo(
    () => resolveBillableSide(
      (shiftData?.shift as any)?.adjusted_end ?? null,
      (shiftData?.shift as any)?.actual_end ?? null,
      isFinishedForBillable,
    ),
    [shiftData?.shift, isFinishedForBillable],
  );

  // EBA minimum-engagement PAYMENT floor — same resolver the Timesheets card
  // and the cost engines use, so a shift never shows a different billable
  // floor decision depending which screen you view it from.
  const billableFloor = React.useMemo(() => {
    if (!shiftData?.shift) return null;
    const rawNetMins = calculateNetMinutes(resolvedBillableStart, resolvedBillableEnd, unpaidBreak);
    if (rawNetMins === null) return null;
    const { isSunday, isPublicHoliday } = getShiftDayType(shiftData.shift.shift_date);
    const isSecurityRoleForFloor = isSecurityRoleName(shiftData.shift.roles?.name);
    return applyMinEngagementFloor(rawNetMins, {
      isTraining: (shiftData.shift as any).is_training === true,
      isSunday,
      isPublicHoliday,
      employmentType:
        (shiftData.shift as any).target_employment_type ?? user?.employmentType ?? null,
      isSecurityRole: isSecurityRoleForFloor,
    });
  }, [resolvedBillableStart, resolvedBillableEnd, unpaidBreak, shiftData?.shift, user?.employmentType]);

  // Augmented shiftData passed to SharedShiftCard: the raw shift row's
  // adjusted_start/end only carry a MANAGER EDIT (tier 1) — merge in the
  // fully-resolved (tier 2 snapped) window so the Live/Payroll Rule badges
  // read the same "billable" truth as the Timesheets card, not just tier 1.
  const shiftDataForCard = React.useMemo(() => {
    if (!shiftData?.shift) return shiftData?.shift;
    return {
      ...shiftData.shift,
      adjusted_start: resolvedBillableStart.hhmm,
      adjusted_end: resolvedBillableEnd.hhmm,
      adjusted_start_source: resolvedBillableStart.source === 'missing' ? null : resolvedBillableStart.source,
      adjusted_end_source: resolvedBillableEnd.source === 'missing' ? null : resolvedBillableEnd.source,
    };
  }, [shiftData?.shift, resolvedBillableStart, resolvedBillableEnd]);

  // ── Cost Calculation ──────────────────────────────────────────────────────
  // Priced on the SHIFT's employment basis, not the viewer's profile.
  //
  // This used to read `user.employmentType`, on the reasoning that the raw
  // shift row carried nothing better. It does: `target_employment_type` has
  // been NOT NULL since 20260806120100 and is the basis the shift is paid on.
  // The profile scalar is a person-level summary that cannot describe someone
  // holding several contracts at once — a prod employee holds one Full-Time
  // Security L7 contract alongside four Casual ones, so their profile reads
  // "Full-Time" while their Casual Team Leader shift must be paid at the loaded
  // casual rate. Pricing it off the profile charged permanent Level 4
  // ($30.26/h) instead of casual ($37.82/h): the 25% casual loading dropped
  // silently, a ~20% understatement. The profile stays as a last-resort
  // fallback for rows with no persisted shift behind them.
  const payEmploymentType =
    (shiftData?.shift as any)?.target_employment_type ?? user?.employmentType ?? null;

  const costBreakdown = React.useMemo(() => {
    if (!shiftData?.shift) return ZERO_COST_BREAKDOWN;
    return estimateDetailedCostFromShift({
      ...shiftData.shift,
      employmentType: payEmploymentType,
    } as any);
  }, [shiftData?.shift, payEmploymentType]);

  // Billable (actual/payroll) estimate — priced off the resolved billable
  // window above, at the EBA-floored net minutes, mirroring the Timesheets
  // card's `billableCost`. Only resolves once both sides have a real value.
  const billableCostBreakdown = React.useMemo(() => {
    if (!shiftData?.shift || !resolvedBillableStart.hhmm || !resolvedBillableEnd.hhmm || billableFloor == null) return null;
    try {
      return estimateDetailedCostFromShift({
        shift_date: shiftData.shift.shift_date,
        start_time: resolvedBillableStart.hhmm,
        end_time: resolvedBillableEnd.hhmm,
        roles: shiftData.shift.roles,
        employmentType: payEmploymentType,
        is_training: (shiftData.shift as any).is_training,
        unpaid_break_minutes: unpaidBreak,
        scheduled_length_minutes: (shiftData.shift as any).scheduled_length_minutes ?? netLengthMinutes,
      }, billableFloor.netMinutes);
    } catch {
      return null;
    }
  }, [shiftData?.shift, resolvedBillableStart, resolvedBillableEnd, billableFloor, unpaidBreak, user?.employmentType, netLengthMinutes]);

  // Itemised rate-breakdown lines for both figures, via the SAME builder the
  // Timesheets card uses, so `estimatedPay`/`billablePay` below are plain
  // "$123.45" strings (not the bespoke Tooltip JSX this dialog used to build)
  // — that's what SharedShiftCard's own Variance section needs to compute a
  // Pay delta; a ReactNode there can't be parsed and silently shows "--".
  const isSecurityRoleForCost = isSecurityRoleName(shiftData?.shift?.roles?.name);
  const estimatedPayLines = React.useMemo(
    () => shiftData?.shift
      ? buildOrdinaryEarningsLines(costBreakdown, { isSecurityRole: isSecurityRoleForCost, shiftDate: shiftData.shift.shift_date, startTime: shiftData.shift.start_time })
      : [],
    [costBreakdown, isSecurityRoleForCost, shiftData?.shift],
  );
  const billablePayLines = React.useMemo(
    () => billableCostBreakdown
      ? buildOrdinaryEarningsLines(billableCostBreakdown, { isSecurityRole: isSecurityRoleForCost, shiftDate: shiftData!.shift.shift_date, startTime: resolvedBillableStart.hhmm ?? undefined })
      : [],
    [billableCostBreakdown, isSecurityRoleForCost, shiftData, resolvedBillableStart],
  );

  if (!shiftData) return null;
  const { shift, groupName, groupColor, subGroupName } = shiftData;

  const shiftDate = new Date(shift.shift_date);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleDropShift = () => setIsCancelConfirmOpen(true);
  const handleSwapShift = () => setIsSwapModalOpen(true);

  const confirmDrop = async (note: string, reasonCode: string) => {
    if (!reasonCode) {
      toast({ title: 'Reason Required', description: 'Please choose a reason for dropping this shift.', variant: 'destructive' });
      return;
    }
    if (isWithinLockoutPeriod) {
      toast({ title: 'Drop Not Allowed', description: 'Cannot drop shift within 4 hours of start time.', variant: 'destructive' });
      return;
    }
    dropShiftMutation.mutate(
      { shiftId: shift.id, reason: note.trim(), reasonCode },
      {
        onSuccess: () => {
          toast({ title: 'Shift Dropped', description: 'You have successfully dropped this shift. It is now available for bidding.' });
          setIsCancelConfirmOpen(false);
          onClose();
        },
        onError: (error: any) => {
          toast({ title: 'Drop Failed', description: error?.message || error?.error?.message || 'Failed to drop shift.', variant: 'destructive' });
        }
      }
    );
  };

  const assignedEmployeeName =
    (shift as any).employeeName ||
    // `assigned_profiles` is the relation the query actually selects
    // (`profiles!assigned_employee_id`). This read `shift.employees`, which no
    // query has ever returned — a dead branch that always fell through to the
    // `user` fallback, so a manager viewing someone else's shift saw their OWN
    // name. Surfaced once the type-check gate was made real.
    (shift.assigned_profiles
      ? `${shift.assigned_profiles.first_name || ''} ${shift.assigned_profiles.last_name || ''}`.trim()
      : null) ||
    // Only fall back to the viewer when the shift is actually theirs. An
    // unconditional fallback printed your own name on an unfilled shift, which
    // matters now that the card states "Unassigned" as a fact rather than
    // leaving the slot blank.
    ((shift as any).assigned_employee_id && (shift as any).assigned_employee_id === user?.id
      ? user?.fullName || user?.name
      : null) ||
    undefined;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md w-[calc(100vw-2rem)] sm:w-full p-0 overflow-hidden bg-card/95 backdrop-blur-2xl border border-border shadow-2xl rounded-[28px] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>{shift.roles?.name || 'Shift'} Details</DialogTitle>
            <DialogDescription>
              Shift details for {format(shiftDate, 'EEEE, MMMM d, yyyy')}
            </DialogDescription>
          </DialogHeader>

          {/* Shift Card Content */}
          <div className="p-0">
            <SharedShiftCard
              variant="timecard"
              isFlat={true}
              hideGlow={true}
              customColor={groupColor}
              organization={shift.organizations?.name || ''}
              department={shift.departments?.name || ''}
              identityGrid
              employeeName={assignedEmployeeName}
              subDepartment={shift.sub_departments?.name}
              group={shiftData?.groupName}
              subGroup={subGroupName || (shift as any).sub_group_name}
              role={shift.roles?.name || 'Shift'}
              shiftDate={format(shiftDate, 'EEE, MMM d, yyyy')}
              startTime={formatWallClock(shift.start_time) ?? shift.start_time.slice(0, 5)}
              endTime={formatWallClock(shift.end_time) ?? shift.end_time.slice(0, 5)}
              // The BILLABLE (post-floor) net, which is what this prop means —
              // it feeds the Payroll section. This passed the SCHEDULED net, so
              // a shift topped up to the EBA minimum read one net here and a
              // different one on Timesheets.
              netLength={billableFloor?.netMinutes ?? netLengthMinutes}
              paidBreak={paidBreak}
              unpaidBreak={unpaidBreak}
              urgency={urgency}
              groupVariant={groupVariant}
              isPast={isPast}
              shiftData={shiftDataForCard}
              lifecycleStatus={shift.lifecycle_status}
              className="pb-4"
              clockIn={formatWallClock((shift as any).actual_start)}
              clockOut={formatWallClock((shift as any).actual_end)}
              adjustedStart={formatWallClock(resolvedBillableStart.hhmm)}
              adjustedEnd={formatWallClock(resolvedBillableEnd.hhmm)}
              adjustedStartSource={resolvedBillableStart.source === 'missing' ? null : resolvedBillableStart.source}
              adjustedEndSource={resolvedBillableEnd.source === 'missing' ? null : resolvedBillableEnd.source}
              wasToppedUpToMinEngagement={billableFloor?.wasToppedUp}
              requiredEngagementMinutes={billableFloor?.requiredMins || null}
              estimatedPay={`$${(costBreakdown.totalCost || 0).toFixed(2)}`}
              estimatedPayBreakdown={estimatedPayLines}
              billablePay={billableCostBreakdown ? `$${(billableCostBreakdown.totalCost || 0).toFixed(2)}` : null}
              billablePayBreakdown={billablePayLines}
              statusIcons={null}
              footerActions={
                <div className="flex flex-col gap-2 w-full">
                  {!isLockedFromActions && (
                    <div className="flex gap-2">
                      {/* Solid. These were 10%-opacity tints over a coloured
                          card, which left the label near the card's own
                          background and read as disabled. Indigo-600 and
                          rose-600 against white clear 4.5:1 in both themes. */}
                      <Button
                        onClick={handleSwapShift}
                        aria-label={`Request a swap for ${shift.roles?.name || 'this shift'} on ${format(shiftDate, 'EEEE d MMMM')}`}
                        className={cn(
                          text.label,
                          touch.target,
                          'flex-1 h-12 rounded-2xl uppercase transition-colors active:scale-95 shadow-sm',
                          'bg-indigo-600 hover:bg-indigo-500 text-white border-0',
                        )}
                      >
                        <ArrowLeftRight size={18} className="mr-2" aria-hidden="true" />
                        {swapLabel}
                      </Button>
                      <Button
                        onClick={handleDropShift}
                        aria-label={`Drop ${shift.roles?.name || 'this shift'} on ${format(shiftDate, 'EEEE d MMMM')}`}
                        className={cn(
                          text.label,
                          touch.target,
                          'flex-1 h-12 rounded-2xl uppercase transition-colors active:scale-95 shadow-sm',
                          'bg-rose-600 hover:bg-rose-500 text-white border-0',
                        )}
                      >
                        <X size={18} className="mr-2" aria-hidden="true" />
                        {dropLabel}
                      </Button>
                    </div>
                  )}
                  {isWithinLockoutPeriod && !isPast && !isActiveOrCommenced && (
                    <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3">
                      <div className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400">
                        {"Emergent State: Lockout Active (<4h)"}
                      </span>
                    </div>
                  )}
                </div>
              }
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Swap Request Modal */}
      <CreateSwapRequestModal
        isOpen={isSwapModalOpen}
        onClose={() => setIsSwapModalOpen(false)}
        shift={shift}
        shiftDate={shiftDate}
        groupName={groupName}
        subGroupName={subGroupName}
        groupColor={groupColor}
      />

      {/* Drop Shift Drawer */}
      <DropShiftDrawer
        isOpen={isCancelConfirmOpen}
        onClose={() => setIsCancelConfirmOpen(false)}
        shift={shift}
        shiftDate={shiftDate}
        groupName={groupName}
        subGroupName={subGroupName}
        groupColor={groupColor}
        isWithinLockoutPeriod={isWithinLockoutPeriod}
        onConfirmDrop={confirmDrop}
        isDropping={isDropping}
      />
    </>
  );
};

export default ShiftDetailsDialog;
