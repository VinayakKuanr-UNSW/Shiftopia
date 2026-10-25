// src/modules/planning/bidding/ui/views/OpenBidsView/ShiftsList.tsx

import { PageState } from '@/modules/core/ui/components/PageState';
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
            className="bg-white/[0.06] text-white/50 h-5 px-1.5 text-[11px] font-bold rounded-md"
          >
            {shifts.length}
          </Badge>
        </div>
        <div className="text-[11px] text-white/25 font-medium tracking-wide uppercase">
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
  <PageState state="loading" title="Loading shifts" />
);

const EmptyState: React.FC = () => (
  <PageState state="empty" title="No shifts found" description="Try changing your scope or status filter to see more shifts." />
);
