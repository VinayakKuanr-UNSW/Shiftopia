// src/modules/planning/bidding/ui/views/OpenBidsView/ShiftCard.tsx

import React from 'react';
import {
  Calendar,
  Clock,
  Coffee,
  Megaphone,
  UserPlus,
  UserCheck as LucideUserCheck,
  Circle,
  Gavel,
  Flame,
  Minus,
  CheckSquare,
  Square,
} from 'lucide-react';
import { SharedShiftCard } from '../../../../ui/components/SharedShiftCard';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import type { OpenShift, TimeRemaining } from './types';
import { formatTimeRemaining } from './utils';

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

  return (
    <SharedShiftCard
        organization={shift.location}
        department={shift.department}
        subGroup={shift.subDepartment}
        role={shift.role}
        shiftDate={shift.date}
        startTime={shift.startTime}
        endTime={shift.endTime}
        netLength={netMins}
        paidBreak={shift.paidBreak}
        unpaidBreak={shift.unpaidBreak}
        timerText={timeRemaining.isExpired ? 'Bidding Closed' : `Closes in ${formatTimeRemaining(timeRemaining)}`}
        isExpired={timeRemaining.isExpired}
        lifecycleStatus={shift.lifecycleStatus || 'Published'}
        shiftData={shift}

        topContent={
            isBulkMode && (
                <div className="flex items-center gap-2">
                    <span className="text-cyan-400/80">
                      {isBulkSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider">
                        {isBulkSelected ? 'Selected' : 'Select'}
                    </span>
                </div>
            )
        }
        className={cn(
            isSelected && !isBulkMode && 'bg-primary/5 border-l-4 border-l-primary shadow-inner',
            isBulkSelected && 'bg-primary/10 border-l-4 border-l-primary shadow-inner'
        )}
        onClick={onClick}
    />
  );
};
