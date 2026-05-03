// src/modules/planning/bidding/ui/views/OpenBidsView/ShiftsList.tsx

import React from 'react';
import { Search, Loader2, Inbox } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ShiftCard } from './ShiftCard';
import { calculateTimeRemaining } from './utils';
import type { OpenShift } from './types';

interface ShiftsListProps {
  shifts: OpenShift[];
  isLoading: boolean;
  selectedV8ShiftId: string | null;
  onSelectShift: (shiftId: string) => void;
  isBulkMode?: boolean;
  selectedV8ShiftIds?: Set<string>;
}

export const ShiftsList: React.FC<ShiftsListProps> = ({
  shifts,
  isLoading,
  selectedV8ShiftId,
  onSelectShift,
  isBulkMode = false,
  selectedV8ShiftIds = new Set(),
}) => {
  return (
    <div className="w-[420px] border-r border-white/[0.04] flex flex-col bg-[#0a0e18]">
      {/* Header */}
      <div className="h-11 px-4 flex items-center justify-between border-b border-white/[0.04] shrink-0 bg-[#080c14]">
        <div className="flex items-center gap-2">
          <span className="text-white/80 font-semibold text-[13px] tracking-tight">Open Shifts</span>
          <Badge
            variant="secondary"
            className="bg-white/[0.06] text-white/50 h-5 px-1.5 text-[10px] font-bold rounded-md"
          >
            {shifts.length}
          </Badge>
        </div>
        <div className="text-[10px] text-white/25 font-medium tracking-wide uppercase">
          By Deadline
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <LoadingState />
        ) : shifts.length === 0 ? (
          <EmptyState />
        ) : (
          shifts.map((shift) => (
            <ShiftCard
              key={shift.id}
              shift={shift}
              isSelected={selectedV8ShiftId === shift.id}
              onClick={() => onSelectShift(shift.id)}
              timeRemaining={calculateTimeRemaining(shift.biddingDeadline)}
              isBulkMode={isBulkMode}
              isBulkSelected={selectedV8ShiftIds.has(shift.id)}
            />
          ))
        )}
      </div>
    </div>
  );
};

const LoadingState: React.FC = () => (
  <div className="p-12 flex flex-col items-center justify-center gap-3 text-white/20">
    <Loader2 className="h-6 w-6 animate-spin" />
    <span className="text-[11px] font-medium">Loading shifts…</span>
  </div>
);

const EmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
    <div className="w-16 h-16 bg-white/[0.03] rounded-2xl flex items-center justify-center mb-4 border border-white/[0.04]">
      <Inbox className="h-7 w-7 text-white/15" />
    </div>
    <p className="text-[13px] font-medium text-white/40 mb-1">No shifts found</p>
    <p className="text-[11px] text-white/20 max-w-[200px]">
      Try changing your scope or status filter to see more shifts.
    </p>
  </div>
);
