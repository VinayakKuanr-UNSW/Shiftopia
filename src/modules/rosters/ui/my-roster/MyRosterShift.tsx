import React from 'react';
import { Shift } from '@/modules/rosters';
import { cn } from '@/modules/core/lib/utils';
import { ArrowRightLeft, CheckCircle2, Inbox } from 'lucide-react';
import { formatInTimezone } from '@/modules/core/lib/date.utils';

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
  // Format time helper using UTC-at-Rest where possible
  const formatTime = (utcTime?: string | null, localTimeString?: string, tzIdentifier?: string) => {
    // Favor local time string as it is the direct user intention and updated first.
    // Falls back to UTC only if local string is missing.
    if (!localTimeString && utcTime) {
      return formatInTimezone(new Date(utcTime), tzIdentifier || 'Australia/Sydney', 'h:mm a');
    }

    if (!localTimeString) return '';
    try {
      const time = localTimeString.includes('T')
        ? localTimeString.split('T')[1].substring(0, 5)
        : localTimeString;
      const [hours, minutes] = time.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
    } catch {
      return localTimeString;
    }
  };

  // Get gradient class based on group color
  const getGradientClass = () => {
    const base = 'dept-card-glass-base';
    switch (groupColor?.toLowerCase()) {
      case 'convention':
        return `${base} dept-card-glass-convention border-blue-400/30 shadow-blue-500/20`;
      case 'exhibition':
        return `${base} dept-card-glass-exhibition border-green-400/30 shadow-green-500/20`;
      case 'theatre':
        return `${base} dept-card-glass-theatre border-red-400/30 shadow-red-500/20`;
      default:
        return `${base} dept-card-glass-default border-blue-400/30 shadow-blue-500/20`;
    }
  };

  const isTradeRequested = shift.trading_status === 'TradeRequested' || shift.trading_status === 'TradeAccepted';
  const isTradeAccepted = shift.trading_status === 'TradeAccepted';
  const isPendingOffer = (shift as any).assignment_outcome === 'offered';

  const cardClass = getGradientClass();

  // Compact view for week/month views
  if (compact) {
    return (
      <div
        className={cn(
          'rounded-lg border cursor-pointer transition-all duration-200',
          'hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]',
          'flex flex-col justify-center px-2 py-1 h-full relative overflow-hidden',
          'shadow-md',
          'text-white',
          cardClass
        )}
        onClick={(e) => onClick?.(e)}
        style={style}
      >
        {isPendingOffer && (
          <div className="absolute top-0 right-0 p-0.5 bg-slate-700/40 rounded-bl-lg">
            <Inbox className="w-3 h-3 text-slate-400" />
          </div>
        )}
        {isTradeRequested && !isPendingOffer && (
          <div className="absolute top-0 right-0 p-0.5 bg-black/20 rounded-bl-lg">
            <ArrowRightLeft className="w-3 h-3 text-amber-300" />
          </div>
        )}
        <div className="font-semibold truncate text-center text-xs leading-tight">
          {shift.roles?.name || 'Shift'}
        </div>
        <div className="opacity-80 text-[10px] truncate text-center leading-tight mt-0.5">
          {formatTime(shift.start_at, shift.start_time, shift.tz_identifier)}
        </div>
      </div>
    );
  }

  // Full view for day/3-day views
  return (
    <div
      className={cn(
        'rounded-xl border cursor-pointer transition-all duration-200',
        'hover:scale-[1.01] hover:shadow-xl active:scale-[0.99]',
        'p-3 h-full flex flex-col justify-between relative overflow-hidden',
        'shadow-lg',
        'text-white',
        cardClass
      )}
      onClick={() => onClick?.()}
      style={style}
    >
      {/* Status Indicators */}
      {isPendingOffer && (
        <div className="absolute top-0 right-0 bg-black/20 backdrop-blur-sm px-2 py-1 rounded-bl-xl border-l border-b border-white/10 flex items-center gap-1.5">
          <Inbox className="w-3 h-3 text-white/80" />
          <span className="text-[10px] font-medium text-white/80">Offer Pending</span>
        </div>
      )}
      {isTradeRequested && !isPendingOffer && (
        <div className="absolute top-0 right-0 bg-black/30 backdrop-blur-sm px-2 py-1 rounded-bl-xl border-l border-b border-white/10 flex items-center gap-1.5">
          {isTradeAccepted ? (
            <>
              <CheckCircle2 className="w-3 h-3 text-green-400" />
              <span className="text-[10px] font-medium text-green-100">Pending Approval</span>
            </>
          ) : (
            <>
              <ArrowRightLeft className="w-3 h-3 text-amber-300" />
              <span className="text-[10px] font-medium text-amber-100">Swap Requested</span>
            </>
          )}
        </div>
      )}

      <div className={cn((isTradeRequested || isPendingOffer) && "mt-4")}>
        {/* Role - Large and prominent */}
        <div className="font-bold text-sm mb-0.5 leading-tight">{shift.roles?.name || 'Shift'}</div>
        {/* Sub-group */}
        <div className="text-xs opacity-80 leading-tight">{subGroupName}</div>
      </div>

      {/* Time */}
      <div className="text-xs opacity-90 leading-tight mt-2">
        {formatTime(shift.start_at, shift.start_time, shift.tz_identifier)} - {formatTime(shift.end_at, shift.end_time, shift.tz_identifier)}
      </div>

      {/* Optional: Break indicator */}
      {shift.break_minutes > 0 && (
        <div className="text-[10px] opacity-70 mt-1">☕ {shift.break_minutes}m break</div>
      )}
    </div>
  );
};

export default MyRosterShift;
