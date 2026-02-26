// src/modules/planning/bidding/ui/views/OpenBidsView/ShiftCard.tsx

import React from 'react';
import {
  Clock,
  Calendar,
  Ban,
  Coffee,
  Megaphone,
  UserPlus,
  UserCheck,
  Circle,
  Gavel,
  Flame,
  Minus,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import type { OpenShift, TimeRemaining } from './types';

interface ShiftCardProps {
  shift: OpenShift;
  isSelected: boolean;
  onClick: () => void;
  timeRemaining: TimeRemaining;
  isBulkMode?: boolean;
  isBulkSelected?: boolean;
}

export const ShiftCard: React.FC<ShiftCardProps> = ({
  shift,
  isSelected,
  onClick,
  timeRemaining,
  isBulkMode = false,
  isBulkSelected = false,
}) => {
  // Net duration
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  let durationMins = (eh * 60 + em) - (sh * 60 + sm);
  if (durationMins < 0) durationMins += 24 * 60;
  const netMins = durationMins - shift.unpaidBreak;
  const netHoursDisplay = (netMins / 60).toFixed(1);

  const isUrgent = shift.isUrgent;

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative px-4 py-3.5 cursor-pointer transition-all duration-200',
        'border-b border-white/[0.04] hover:bg-white/[0.025]',
        isSelected && !isBulkMode && 'bg-white/[0.04] border-l-2 border-l-cyan-500',
        isBulkSelected && 'bg-cyan-500/[0.06] border-l-2 border-l-cyan-500',
        isUrgent && !isSelected && !isBulkSelected && 'border-l-2 border-l-red-500/50'
      )}
    >
      {/* TOP ROW: Bulk checkbox OR status dot */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          {isBulkMode && (
            <span className="text-cyan-400/80">
              {isBulkSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </span>
          )}
          {/* Sub-Department Badge */}
          {shift.subDepartment && (
            <Badge
              className={cn(
                'text-[10px] px-2 py-0.5 font-medium border rounded-md',
                'bg-white/[0.03] border-white/[0.08] text-white/50'
              )}
            >
              {shift.subDepartment}
            </Badge>
          )}
        </div>

        {/* Urgency Indicator */}
        {isUrgent && (
          <div className="flex items-center gap-1 text-[10px] text-red-400 font-semibold">
            <Flame className="h-3 w-3" />
            URGENT
          </div>
        )}
      </div>

      {/* BREADCRUMB */}
      <div className="text-[10px] text-white/30 mb-1 tracking-wide">
        {shift.location} → {shift.department}
        {shift.subDepartment && ` → ${shift.subDepartment}`}
      </div>

      {/* ROLE */}
      <h4 className="font-bold text-sm text-white/90 mb-2.5 leading-tight">{shift.role}</h4>

      {/* DATE + TIME row */}
      <div className="flex items-center gap-4 text-[11px] text-white/55 mb-1.5">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3 w-3 text-white/30" />
          <span>{new Date(shift.date).toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-white/30" />
          <span>{shift.startTime} – {shift.endTime}</span>
        </div>
      </div>

      {/* BREAKS + NET */}
      <div className="flex items-center gap-3 text-[11px] text-white/40 mb-2.5">
        <div className="flex items-center gap-1">
          <Coffee className="h-3 w-3 text-white/25" />
          <span>Paid {shift.paidBreak}m · Unpaid {shift.unpaidBreak}m</span>
        </div>
        <span className="text-white/15">|</span>
        <span className="text-white/60 font-semibold">Net {netMins}m ({netHoursDisplay}h)</span>
      </div>

      {/* COUNTDOWN */}
      {!timeRemaining.isExpired ? (
        <div className={cn(
          'rounded-md px-2.5 py-1 text-[10px] font-medium flex items-center gap-1.5 w-fit',
          timeRemaining.hours < 4
            ? 'bg-red-500/10 border border-red-500/20 text-red-400'
            : 'bg-amber-500/8 border border-amber-500/15 text-amber-400/80'
        )}>
          <Clock size={10} />
          <span>Closes in {timeRemaining.hours}h {timeRemaining.minutes}m</span>
        </div>
      ) : (
        <div className="rounded-md px-2.5 py-1 text-[10px] font-medium flex items-center gap-1.5 w-fit bg-white/[0.03] border border-white/[0.06] text-white/30">
          <Ban size={10} />
          <span>Bidding Closed</span>
        </div>
      )}

      {/* 6-ICON GRID (3×2) */}
      <div className="mt-3 bg-white/[0.015] rounded-lg border border-white/[0.04] p-2">
        <div className="grid grid-cols-3 gap-y-1.5 gap-x-1 text-center">
          {/* ID */}
          <div className="flex flex-col items-center gap-0.5">
            <div className="w-4 h-4 flex items-center justify-center font-mono text-[9px] text-white/25 border border-white/[0.08] rounded">#</div>
            <span className="text-[9px] font-bold text-cyan-400/70">{shift.shiftIdDisplay}</span>
          </div>
          {/* LIFECYCLE */}
          <div className="flex flex-col items-center gap-0.5">
            <Megaphone className="w-3.5 h-3.5 text-blue-400/50" />
            <span className="text-[9px] text-white/30">Published</span>
          </div>
          {/* ASSIGNMENT */}
          <div className="flex flex-col items-center gap-0.5">
            {shift.assignmentStatus === 'assigned' ? (
              <UserCheck className="w-3.5 h-3.5 text-emerald-400/60" />
            ) : (
              <UserPlus className="w-3.5 h-3.5 text-amber-400/50" />
            )}
            <span className="text-[9px] text-white/30">
              {shift.assignmentStatus === 'assigned' ? 'Assigned' : 'Unassigned'}
            </span>
          </div>
          {/* OFFER */}
          <div className="flex flex-col items-center gap-0.5">
            <Circle className="w-3.5 h-3.5 text-white/15" />
            <span className="text-[9px] text-white/20">–</span>
          </div>
          {/* BIDDING */}
          <div className="flex flex-col items-center gap-0.5">
            {isUrgent ? (
              <Flame className="w-3.5 h-3.5 text-red-400/60" />
            ) : (
              <Gavel className="w-3.5 h-3.5 text-blue-400/50" />
            )}
            <span className="text-[9px] text-white/30">{isUrgent ? 'Urgent' : 'Normal'}</span>
          </div>
          {/* TRADE */}
          <div className="flex flex-col items-center gap-0.5">
            <Minus className="w-3.5 h-3.5 text-white/15" />
            <span className="text-[9px] text-white/20">NoTrade</span>
          </div>
        </div>
      </div>
    </div>
  );
};
