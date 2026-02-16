import React from 'react';
import { Shift } from '@/modules/rosters';
import { cn } from '@/modules/core/lib/utils';

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
  // Format time helper
  const formatTime = (timeString: string) => {
    try {
      const time = timeString.includes('T')
        ? timeString.split('T')[1].substring(0, 5)
        : timeString;
      const [hours, minutes] = time.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
    } catch {
      return timeString;
    }
  };

  // Get gradient class based on group color
  const getGradientClass = () => {
    switch (groupColor?.toLowerCase()) {
      case 'blue':
        return 'bg-gradient-to-br from-blue-500 to-blue-700 border-blue-400/30 shadow-blue-500/20';
      case 'green':
        return 'bg-gradient-to-br from-green-500 to-green-700 border-green-400/30 shadow-green-500/20';
      case 'red':
        return 'bg-gradient-to-br from-red-500 to-red-700 border-red-400/30 shadow-red-500/20';
      case 'purple':
        return 'bg-gradient-to-br from-purple-500 to-purple-700 border-purple-400/30 shadow-purple-500/20';
      case 'orange':
        return 'bg-gradient-to-br from-orange-500 to-orange-700 border-orange-400/30 shadow-orange-500/20';
      case 'yellow':
        return 'bg-gradient-to-br from-yellow-500 to-yellow-700 border-yellow-400/30 shadow-yellow-500/20';
      case 'sky':
        return 'bg-gradient-to-br from-sky-500 to-sky-700 border-sky-400/30 shadow-sky-500/20';
      case 'teal':
        return 'bg-gradient-to-br from-teal-500 to-teal-700 border-teal-400/30 shadow-teal-500/20';
      default:
        return 'bg-gradient-to-br from-blue-500 to-blue-700 border-blue-400/30 shadow-blue-500/20';
    }
  };

  // Compact view for week/month views
  if (compact) {
    return (
      <div
        className={cn(
          'rounded-lg border text-white cursor-pointer transition-all duration-200',
          'hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]',
          'flex flex-col justify-center px-2 py-1 h-full',
          'shadow-md',
          getGradientClass()
        )}
        onClick={(e) => onClick?.(e)}
        style={style}
      >
        <div className="font-semibold truncate text-center text-xs leading-tight">
          {shift.role}
        </div>
        <div className="opacity-80 text-[10px] truncate text-center leading-tight mt-0.5">
          {formatTime(shift.startTime)}
        </div>
      </div>
    );
  }

  // Full view for day/3-day views
  return (
    <div
      className={cn(
        'rounded-xl border text-white cursor-pointer transition-all duration-200',
        'hover:scale-[1.01] hover:shadow-xl active:scale-[0.99]',
        'p-3 h-full flex flex-col justify-between',
        'shadow-lg',
        getGradientClass()
      )}
      onClick={() => onClick?.()}
      style={style}
    >
      <div>
        {/* Role - Large and prominent */}
        <div className="font-bold text-sm mb-0.5 leading-tight">{shift.role}</div>
        {/* Sub-group */}
        <div className="text-xs opacity-80 leading-tight">{subGroupName}</div>
      </div>

      {/* Time */}
      <div className="text-xs opacity-90 leading-tight mt-2">
        {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
      </div>

      {/* Optional: Break indicator */}
      {shift.breakDuration && (
        <div className="text-[10px] opacity-70 mt-1">☕ {shift.breakDuration} break</div>
      )}
    </div>
  );
};

export default MyRosterShift;
