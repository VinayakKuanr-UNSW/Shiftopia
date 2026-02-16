// src/modules/planning/ui/views/OpenBidsView/components/ShiftDetailsHeader.tsx

import React from 'react';
import { Clock, DollarSign, Building } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { getGroupColors, calculateTimeRemaining, formatTimeRemaining } from './utils';
import type { OpenShift } from './types';

interface ShiftDetailsHeaderProps {
  shift: OpenShift;
  onWithdraw?: () => void; // Made optional, not used
}

export const ShiftDetailsHeader: React.FC<ShiftDetailsHeaderProps> = ({
  shift,
}) => {
  const colors = getGroupColors(shift.group);
  const timeRemaining = calculateTimeRemaining(shift.biddingDeadline);

  return (
    <div className="h-48 shrink-0 relative overflow-hidden flex flex-col justify-end p-8 border-b border-white/10">
      {/* Ambient Background */}
      <div className={cn('absolute inset-0 opacity-10 blur-3xl', colors.bg)} />

      <div className="relative z-10 flex justify-between items-end">
        {/* Left Side: Shift Info */}
        <div>
          {/* Sub-Group Badge */}
          {shift.subDepartment && (
            <div className="mb-2">
              <Badge className={cn('text-[10px] px-2 py-0.5 bg-purple-900/50 border border-purple-500/30', colors.accent)}>
                {shift.subDepartment}
              </Badge>
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <Badge className={cn('text-[10px] px-2 py-0.5', colors.accent)}>
              {shift.groupLabel}
            </Badge>
            <span className="text-white/50 text-xs">• {shift.dayLabel}</span>
          </div>

          <h1 className="text-3xl font-black text-white tracking-tight leading-none mb-3">
            {shift.role}
          </h1>

          <div className="flex items-center gap-6 text-sm text-white/70">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-purple-400" />
              <span>
                {shift.startTime} - {shift.endTime}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              <span>{shift.remunerationLevel}</span>
            </div>
            <div className="flex items-center gap-2">
              <Building className="h-4 w-4 text-blue-400" />
              <span>{shift.department}</span>
            </div>
            <div className="text-white/50 text-xs">
              Net: <span className="text-white font-bold">{shift.netHours}h</span>
            </div>
          </div>
        </div>

        {/* Right Side: Countdown ONLY (Withdraw button removed) */}
        <div className="flex flex-col items-end gap-3">
          <div className="text-right">
            <div className="text-[10px] text-white/40 uppercase font-bold tracking-widest mb-1">
              Bidding Closes In
            </div>
            <div className="text-xl font-mono text-white font-bold">
              {formatTimeRemaining(timeRemaining)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
