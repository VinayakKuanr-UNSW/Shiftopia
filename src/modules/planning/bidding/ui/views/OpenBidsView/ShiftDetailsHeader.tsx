// src/modules/planning/bidding/ui/views/OpenBidsView/ShiftDetailsHeader.tsx

import React from 'react';
import { Clock, DollarSign, Building, Calendar, Coffee, Ban } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { getGroupColors, calculateTimeRemaining, formatTimeRemaining } from './utils';
import type { OpenShift } from './types';

interface ShiftDetailsHeaderProps {
  shift: OpenShift;
  onWithdraw?: () => void;
}

export const ShiftDetailsHeader: React.FC<ShiftDetailsHeaderProps> = ({
  shift,
  onWithdraw,
}) => {
  const colors = getGroupColors(shift.group);
  const timeRemaining = calculateTimeRemaining(shift.biddingDeadline);

  return (
    <div className="shrink-0 relative overflow-hidden border-b border-white/[0.06]">
      {/* Ambient Background Glow */}
      <div className={cn('absolute inset-0 opacity-[0.06] blur-3xl', colors.bg)} />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#080c14]/80" />

      <div className="relative z-10 p-6 pb-5">
        {/* Top Row: Badges + Withdraw */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={cn('text-[10px] px-2.5 py-0.5 font-semibold border rounded-md', colors.accent)}>
              {shift.groupLabel}
            </Badge>
            {shift.subDepartment && (
              <Badge className="text-[10px] px-2.5 py-0.5 font-medium bg-white/[0.04] border-white/[0.08] text-white/50 rounded-md">
                {shift.subDepartment}
              </Badge>
            )}
            <span className="text-white/30 text-[11px]">•</span>
            <span className="text-white/40 text-[11px] font-medium">{shift.dayLabel}</span>
          </div>

          {onWithdraw && (
            <Button
              variant="outline"
              size="sm"
              onClick={onWithdraw}
              className="h-7 text-[11px] border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-all"
            >
              <Ban className="h-3 w-3 mr-1.5" />
              Withdraw
            </Button>
          )}
        </div>

        {/* Role Title */}
        <h1 className="text-2xl font-black text-white/95 tracking-tight leading-none mb-4">
          {shift.role}
        </h1>

        {/* Info Grid */}
        <div className="flex items-center gap-5 text-[12px] text-white/55 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-cyan-400/60" />
            <span>{shift.startTime} – {shift.endTime}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-cyan-400/60" />
            <span>{shift.date}</span>
          </div>
          {shift.remunerationLevel && (
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-emerald-400/60" />
              <span>{shift.remunerationLevel}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Building className="h-3.5 w-3.5 text-blue-400/60" />
            <span>{shift.department}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Coffee className="h-3.5 w-3.5 text-white/30" />
            <span>Net {shift.netHours}h</span>
          </div>
        </div>

        {/* Countdown Strip */}
        <div className="mt-4 flex items-center gap-3">
          <div className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold border',
            timeRemaining.isExpired
              ? 'bg-white/[0.03] border-white/[0.06] text-white/30'
              : timeRemaining.hours < 4
                ? 'bg-red-500/10 border-red-500/20 text-red-400'
                : 'bg-amber-500/8 border-amber-500/15 text-amber-400/80'
          )}>
            <Clock className="h-3 w-3" />
            {timeRemaining.isExpired ? 'EXPIRED' : `Closes in ${formatTimeRemaining(timeRemaining)}`}
          </div>
          <span className="text-[10px] text-white/20 font-mono">{shift.stateId}</span>
        </div>
      </div>
    </div>
  );
};
