import React from 'react';
import { Shift, ShiftWithDetails } from '@/modules/rosters';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { formatCalendarDate } from '@/modules/core/lib/date.utils';
import { useClockValue, isShiftPast, type ClockSnapshot } from '@/modules/core/hooks/useClock';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { resolveGroupVariant } from '@/modules/rosters/domain/shift-ui';
import { useAuth } from '@/platform/auth/useAuth';
import ShiftPill from './ShiftPill';

/**
 * Props are deliberately all primitives plus one referentially-stable object, so
 * the `React.memo` at the bottom of this file actually holds.
 *
 * The desktop month grid renders up to 126 of these (42 cells x 3 chips). Before
 * memo, opening a shift dialog re-rendered every one of them, because the parent
 * re-renders on `selectedShift` and the old contract passed an inline
 * `onClick={() => ...}` arrow and an inline `style={{ height }}` object — two
 * fresh identities per card per render, which defeat memo on their own.
 *
 * Hence `onSelect` + `dateKey` instead of a closure, and `height` as a number
 * instead of a style object.
 */
interface MyRosterShiftProps {
  data: ShiftWithDetails;
  /**
   * The calendar day this instance is rendered under, `YYYY-MM-DD`.
   *
   * NOT always `data.shift.shift_date`: the 3-day view asks for continuations,
   * so an overnight shift also appears under the following day and the dialog
   * must open on the day the user actually clicked.
   */
  dateKey: string;
  compact?: boolean;
  /** Pixel height when laid out in a time grid; its presence selects the pill. */
  height?: number;
  onSelect?: (data: ShiftWithDetails, dateKey: string) => void;
}

const MyRosterShiftImpl: React.FC<MyRosterShiftProps> = ({
  data,
  dateKey,
  compact = false,
  height,
  onSelect,
}) => {
  const { shift, groupName, groupColor, subGroupName } = data;
  const handleClick = React.useCallback(() => onSelect?.(data, dateKey), [onSelect, data, dateKey]);
  const style = React.useMemo<React.CSSProperties | undefined>(
    () => (height == null ? undefined : { height }),
    [height],
  );
  const isMobile = useIsMobile();
  const { user } = useAuth();

  // "Now" in Sydney (AEST/AEDT), so comparisons against the shift's Sydney
  // wall-clock fields are correct regardless of the viewer's browser tz.
  //
  // This was a `useMemo` keyed on the shift, which froze the answer at mount: a
  // shift that ended while the roster sat open never went grey. The shared clock
  // ticks once a minute for the whole app and re-renders only the cards whose
  // boolean actually flipped — see `useClock`.
  const isPastSelector = React.useCallback(
    (now: ClockSnapshot) => isShiftPast(shift.shift_date, shift.end_time, now, shift.start_time),
    [shift.shift_date, shift.end_time, shift.start_time],
  );
  const isPast = useClockValue(isPastSelector);

  const netLength = React.useMemo(() => {
    if (!shift.start_time || !shift.end_time) return 0;
    const [sh, sm] = shift.start_time.split(':').map(Number);
    const [eh, em] = shift.end_time.split(':').map(Number);
    let gross = (eh * 60 + em) - (sh * 60 + sm);
    if (gross < 0) gross += 1440;
    return Math.max(0, gross - (shift.unpaid_break_minutes ?? 0));
  }, [shift.start_time, shift.end_time, shift.unpaid_break_minutes]);

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
    user?.fullName ||
    user?.name ||
    undefined;

  // Determine if we should show the compact "Pill" design.
  // 1. In any Grid View (D/3D/W) where 'style.height' is passed (both Desktop & Mobile)
  // 2. In the Desktop Month View (where 'compact' is true and it's not mobile)
  const isGridView = height != null;
  const showPill = isGridView || (!isMobile && compact);

  if (showPill) {
    return (
      <ShiftPill
        shift={shift}
        groupName={groupName}
        groupColor={groupColor}
        subGroupName={subGroupName}
        onClick={handleClick}
        style={style}
      />
    );
  }

  // Otherwise, use the full "Gold Standard" card (e.g., in the Mobile Agenda view)
  return (
    <div style={style} className="h-full w-full">
      <SharedShiftCard
        variant="nested"
        isFlat={true}
        organization={shift.organizations?.name || ''}
        department={groupName}
        subGroup={subGroupName}
        role={shift.roles?.name || 'Shift'}
        employeeName={assignedEmployeeName}
        shiftDate={formatCalendarDate(shift.shift_date, 'EEE, MMM d')}
        startTime={shift.start_time?.slice(0, 5) ?? '--:--'}
        endTime={shift.end_time?.slice(0, 5) ?? '--:--'}
        netLength={netLength}
        paidBreak={shift.paid_break_minutes ?? shift.break_minutes ?? 0}
        unpaidBreak={shift.unpaid_break_minutes ?? 0}
        isPast={isPast}
        lifecycleStatus={shift.lifecycle_status}
        groupVariant={resolveGroupVariant(shift, groupColor || groupName, subGroupName)}
        onClick={handleClick}
        shiftData={shift}
        className="h-full"
      />
    </div>
  );
};


/**
 * Memoised on a shallow prop compare. `data` comes from `useMyRoster`'s date
 * index, which builds each `ShiftWithDetails` once per fetch, so identity is
 * stable across re-renders of the parent — the precondition this relies on.
 */
const MyRosterShift = React.memo(MyRosterShiftImpl);
MyRosterShift.displayName = 'MyRosterShift';

export default MyRosterShift;

