import React from 'react';
import { format } from 'date-fns';
import { Shift } from '@/modules/rosters';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';

interface MobileShiftCardProps {
  shiftData: {
    shift: Shift;
    groupName: string;
    groupColor: string;
    subGroupName: string;
  };
  selectedDay: Date;
  onClick?: () => void;
}

export const MobileShiftCard: React.FC<MobileShiftCardProps> = ({ shiftData, onClick }) => {
  const { shift, groupName, groupColor, subGroupName } = shiftData;

  const isPast = React.useMemo(() => {
    if (!shift.shift_date || !shift.end_time || !shift.start_time) return false;
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
  }, [shift.shift_date, shift.end_time, shift.start_time]);

  const p = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const gross = p(shift.end_time) - p(shift.start_time);
  const netLength = Math.max(0, gross - (shift.unpaid_break_minutes ?? 0));

  return (
    <div 
      className="relative cursor-pointer active:scale-[0.98] transition-transform duration-200"
      onClick={onClick}
    >
      <SharedShiftCard
        variant="timecard"
        isFlat={true} // Flatten to match the detail drawer look
        organization={shift.organizations?.name || ''}

        department={groupName}
        subGroup={subGroupName}
        role={shift.roles?.name || 'Shift'}
        shiftDate={format(new Date(shift.shift_date), 'EEE, MMM d, yyyy')}
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
        shiftData={shift}
      />
    </div>
  );
};
