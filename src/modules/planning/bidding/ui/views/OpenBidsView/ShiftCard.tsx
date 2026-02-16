// src/modules/planning/ui/views/OpenBidsView/components/ShiftCard.tsx

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
  Minus
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { cn } from '@/modules/core/lib/utils';
import { getGroupColors } from './utils';
import type { OpenShift, TimeRemaining } from './types';

interface ShiftCardProps {
  shift: OpenShift;
  isSelected: boolean;
  onClick: () => void;
  timeRemaining: TimeRemaining;
}

export const ShiftCard: React.FC<ShiftCardProps> = ({
  shift,
  isSelected,
  onClick,
  timeRemaining,
}) => {
  const colors = getGroupColors(shift.group);

  // Calculate net length in minutes for display
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  let durationMins = (eh * 60 + em) - (sh * 60 + sm);
  if (durationMins < 0) durationMins += 24 * 60;
  const netMins = durationMins - shift.unpaidBreak;
  const netHoursDisplay = (netMins / 60).toFixed(1);

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative p-4 border-b border-white/5 cursor-pointer transition-all hover:bg-white/[0.02]',
        isSelected && 'bg-white/[0.04] border-l-2 border-l-purple-500'
      )}
    >
      {/* SELECT CHECKBOX ROW */}
      <div className="flex items-center gap-2 mb-3">
        <Checkbox
          checked={isSelected}
          className="h-4 w-4 border-white/30 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
        />
        <span className="text-xs text-white/60">Select</span>
      </div>

      {/* SUB-GROUP BADGE */}
      {shift.subDepartment && (
        <Badge
          className="mb-2 text-[10px] px-2 py-0.5 bg-green-900/30 border border-green-500/30 text-green-300"
        >
          {shift.subDepartment}
        </Badge>
      )}

      {/* BREADCRUMB: Org → Dept → SubDept */}
      <div className="text-[10px] text-white/50 mb-1">
        {shift.location} → {shift.department}
        {shift.subDepartment && ` → ${shift.subDepartment}`}
      </div>

      {/* ROLE TITLE */}
      <h4 className="font-bold text-sm text-white mb-3">{shift.role}</h4>

      {/* DATE */}
      <div className="flex items-center text-xs text-white/70 mb-1">
        <Calendar className="h-3 w-3 mr-2 text-white/50" />
        <span>{new Date(shift.date).toLocaleDateString('en-AU', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })}</span>
      </div>

      {/* TIME */}
      <div className="flex items-center text-xs text-white/70 mb-1">
        <Clock className="h-3 w-3 mr-2 text-white/50" />
        <span>{shift.startTime} - {shift.endTime}</span>
      </div>

      {/* BREAKS */}
      <div className="flex items-center text-xs text-white/70 mb-2">
        <Coffee className="h-3 w-3 mr-2 text-white/50" />
        <span>Paid: {shift.paidBreak}m | Unpaid: {shift.unpaidBreak}m</span>
      </div>

      {/* NET LENGTH */}
      <div className="bg-white/5 rounded px-2 py-1 mb-2 text-xs text-white/70">
        Net Length: <span className="font-bold text-white">{netMins}m</span> ({netHoursDisplay}h)
      </div>

      {/* BIDDING COUNTDOWN */}
      {!timeRemaining.isExpired ? (
        <div className="bg-amber-900/20 border border-amber-500/30 rounded px-2 py-1 mb-3 text-xs text-amber-300 flex items-center gap-1">
          <Clock size={12} />
          <span>Closes in {timeRemaining.hours}h {timeRemaining.minutes}m</span>
        </div>
      ) : (
        <div className="bg-red-900/20 border border-red-500/30 rounded px-2 py-1 mb-3 text-xs text-red-300 flex items-center gap-1">
          <Ban size={12} />
          <span>Bidding Closed</span>
        </div>
      )}

      {/* 6-ICON GRID (3x2) */}
      <div className="bg-[#0f172a] rounded-lg border border-white/10 p-2 mb-3">
        <div className="grid grid-cols-3 gap-y-2 gap-x-1 text-center">
          {/* ID */}
          <div className="flex flex-col items-center gap-0.5">
            <div className="w-4 h-4 flex items-center justify-center font-mono text-[10px] text-white/40 border border-white/20 rounded">#</div>
            <span className="text-[9px] font-bold text-blue-400">{shift.shiftIdDisplay}</span>
          </div>
          {/* LIFECYCLE */}
          <div className="flex flex-col items-center gap-0.5">
            <Megaphone className="w-4 h-4 text-blue-500" />
            <span className="text-[9px] text-gray-400">Published</span>
          </div>
          {/* ASSIGNMENT */}
          <div className="flex flex-col items-center gap-0.5">
            {shift.assignmentStatus === 'assigned' ? (
              <UserCheck className="w-4 h-4 text-green-500" />
            ) : (
              <UserPlus className="w-4 h-4 text-amber-500" />
            )}
            <span className="text-[9px] text-gray-400">
              {shift.assignmentStatus === 'assigned' ? 'Assigned' : 'Unassigned'}
            </span>
          </div>
          {/* OFFER */}
          <div className="flex flex-col items-center gap-0.5">
            <Circle className="w-4 h-4 text-gray-400" />
            <span className="text-[9px] text-gray-400">-</span>
          </div>
          {/* BIDDING */}
          <div className="flex flex-col items-center gap-0.5">
            {shift.isUrgent ? (
              <Flame className="w-4 h-4 text-red-500" />
            ) : (
              <Gavel className="w-4 h-4 text-blue-500" />
            )}
            <span className="text-[9px] text-gray-400">{shift.isUrgent ? 'Urgent' : 'Normal'}</span>
          </div>
          {/* TRADE */}
          <div className="flex flex-col items-center gap-0.5">
            <Minus className="w-4 h-4 text-gray-400" />
            <span className="text-[9px] text-gray-400">NoTrade</span>
          </div>
        </div>
      </div>
    </div>
  );
};
