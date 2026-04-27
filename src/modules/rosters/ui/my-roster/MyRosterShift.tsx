import React from 'react';
import { Shift } from '@/modules/rosters';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { format } from 'date-fns';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import ShiftPill from './ShiftPill';

interface MyRosterShiftProps {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
  compact?: boolean;
  onClick?: (e?: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

const MyRosterShift: React.FC<MyRosterShiftProps> = ({
  shift,
  groupName,
  groupColor,
  subGroupName,
  compact = false,
  onClick,
  style,
}) => {
  const isMobile = useIsMobile();

  // Calculate if shift is in the past
  const isPast = React.useMemo(() => {
    if (!shift.shift_date || !shift.end_time) return false;
    try {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      if (shift.shift_date > todayStr) return false;
      if (shift.shift_date < todayStr) return true;
      const [nowH, nowM] = format(new Date(), 'HH:mm').split(':').map(Number);
      const [endH, endM] = shift.end_time.split(':').map(Number);
      const resolvedEndH = endH === 0 ? 24 : endH;
      const currentMinutes = nowH * 60 + nowM;
      const endMinutes = resolvedEndH * 60 + endM;
      return endMinutes < currentMinutes;
    } catch {
      return false;
    }
  }, [shift.shift_date, shift.end_time]);

  const p = (t: string) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const gross = p(shift.end_time) - p(shift.start_time);
  const netLength = Math.max(0, gross - (shift.unpaid_break_minutes ?? 0));

  // Determine if we should show the compact "Pill" design.
  // 1. In any Grid View (D/3D/W) where 'style.height' is passed (both Desktop & Mobile)
  // 2. In the Desktop Month View (where 'compact' is true and it's not mobile)
  const isGridView = !!style?.height;
  const showPill = isGridView || (!isMobile && compact);

  if (showPill) {
    return (
      <ShiftPill
        shift={shift}
        groupName={groupName}
        groupColor={groupColor}
        subGroupName={subGroupName}
        onClick={onClick}
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
        shiftDate={format(new Date(shift.shift_date), 'EEE, MMM d')}
        startTime={shift.start_time.slice(0, 5)}
        endTime={shift.end_time.slice(0, 5)}
        netLength={netLength}
        paidBreak={shift.paid_break_minutes ?? shift.break_minutes ?? 0}
        unpaidBreak={shift.unpaid_break_minutes ?? 0}
        isPast={isPast}
        lifecycleStatus={shift.lifecycle_status}
        groupVariant={
          groupColor.toLowerCase().includes('convention') ? 'convention' :
          groupColor.toLowerCase().includes('exhibition') ? 'exhibition' :
          groupColor.toLowerCase().includes('theatre') ? 'theatre' : 'default'
        }
        onClick={onClick}
        shiftData={shift}
        className="h-full"
      />
    </div>
  );
};


export default MyRosterShift;

