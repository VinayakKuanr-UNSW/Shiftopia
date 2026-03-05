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
        'group relative px-5 py-4 cursor-pointer transition-all duration-300',
        'border-b border-border/50 hover:bg-muted/30',
        isSelected && !isBulkMode && 'bg-primary/5 border-l-4 border-l-primary shadow-inner',
        isBulkSelected && 'bg-primary/10 border-l-4 border-l-primary shadow-inner',
        isUrgent && !isSelected && !isBulkSelected && 'border-l-4 border-l-rose-500/50'
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
                'text-[9px] px-2 py-0.5 font-black border rounded-lg',
                'bg-primary/10 border-primary/20 text-primary'
              )}
            >
              {shift.subDepartment}
            </Badge>
          )}
        </div>

        {/* Urgency Indicator */}
        {isUrgent && (
          <div className="flex items-center gap-1.5 text-[9px] text-rose-500 font-black tracking-widest bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
            <Flame className="h-3 w-3" />
            URGENT
          </div>
        )}
      </div>

      {/* BREADCRUMB */}
      <div className="text-[10px] text-muted-foreground/40 mb-1.5 tracking-[0.1em] font-mono font-black uppercase">
        {shift.location} <span className="text-primary/30 mx-0.5">/</span> {shift.department}
        {shift.subDepartment && <> <span className="text-primary/30 mx-0.5">/</span> {shift.subDepartment}</>}
      </div>

      {/* ROLE */}
      <h4 className="font-black text-base text-foreground mb-3 leading-tight tracking-tight">{shift.role}</h4>

      {/* DATE + TIME row */}
      <div className="flex items-center gap-4 text-[11px] text-foreground/70 mb-2">
        <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded-lg border border-border/50">
          <Calendar className="h-3.5 w-3.5 text-primary" />
          <span className="font-black font-mono">{new Date(shift.date).toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded-lg border border-border/50">
          <Clock className="h-3.5 w-3.5 text-primary" />
          <span className="font-black font-mono">{shift.startTime} – {shift.endTime}</span>
        </div>
      </div>

      {/* BREAKS + NET */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60 mb-3">
        <div className="flex items-center gap-1.5">
          <Coffee className="h-3.5 w-3.5 text-orange-500/50" />
          <span className="font-black font-mono">Paid {shift.paidBreak}m · Unpaid {shift.unpaidBreak}m</span>
        </div>
        <span className="text-border">|</span>
        <span className="text-primary font-black font-mono">Net {netHoursDisplay}h</span>
      </div>

      {/* COUNTDOWN */}
      {!timeRemaining.isExpired ? (
        <div className={cn(
          'rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 w-fit border shadow-sm',
          timeRemaining.hours < 4
            ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
            : 'bg-amber-500/5 border-amber-500/10 text-amber-600 dark:text-amber-400'
        )}>
          <Clock size={12} className="animate-pulse" />
          <span>Closes in {timeRemaining.hours}h {timeRemaining.minutes}m</span>
        </div>
      ) : (
        <div className="rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 w-fit bg-muted border border-border text-muted-foreground/40">
          <Ban size={12} />
          <span>Bidding Closed</span>
        </div>
      )}

      {/* 6-ICON GRID (3×2) */}
      <div className="mt-4 bg-muted/20 rounded-2xl border border-border/50 p-2.5 shadow-inner">
        <div className="grid grid-cols-3 gap-y-1.5 gap-x-1 text-center">
          {/* ID */}
          <div className="flex flex-col items-center gap-1">
            <div className="w-5 h-5 flex items-center justify-center font-mono text-[9px] text-primary/60 border border-primary/20 bg-primary/5 rounded-lg shadow-sm">#</div>
            <span className="text-[9px] font-black text-primary/80 uppercase tracking-tighter">{shift.shiftIdDisplay}</span>
          </div>
          {/* LIFECYCLE */}
          <div className="flex flex-col items-center gap-1">
            <Megaphone className="w-4 h-4 text-blue-500/40" />
            <span className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest">Published</span>
          </div>
          {/* ASSIGNMENT */}
          <div className="flex flex-col items-center gap-1">
            {shift.assignmentStatus === 'assigned' ? (
              <UserCheck className="w-4 h-4 text-emerald-500/60" />
            ) : (
              <UserPlus className="w-4 h-4 text-amber-500/50" />
            )}
            <span className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest">
              {shift.assignmentStatus === 'assigned' ? 'Assigned' : 'Market'}
            </span>
          </div>
          {/* OFFER */}
          <div className="flex flex-col items-center gap-1">
            <Circle className="w-4 h-4 text-border" />
            <span className="text-[9px] font-black text-muted-foreground/20 uppercase tracking-widest">–</span>
          </div>
          {/* BIDDING */}
          <div className="flex flex-col items-center gap-1">
            {isUrgent ? (
              <Flame className="w-4 h-4 text-rose-500/60" />
            ) : (
              <Gavel className="w-4 h-4 text-primary/50" />
            )}
            <span className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest">{isUrgent ? 'Urgent' : 'Normal'}</span>
          </div>
          {/* TRADE */}
          <div className="flex flex-col items-center gap-1">
            <Minus className="w-4 h-4 text-border" />
            <span className="text-[9px] font-black text-muted-foreground/20 uppercase tracking-widest">NoTrade</span>
          </div>
        </div>
      </div>
    </div>
  );
};
