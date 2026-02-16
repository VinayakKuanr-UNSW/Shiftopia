// src/modules/planning/ui/views/OpenBidsView/components/ShiftsList.tsx

import React from 'react';
import { Search, Loader2 } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ShiftCard } from './ShiftCard';
import { calculateTimeRemaining } from './utils';
import type { OpenShift } from './types';

interface ShiftsListProps {
  shifts: OpenShift[];
  isLoading: boolean;
  selectedShiftId: string | null;
  onSelectShift: (shiftId: string) => void;
}

export const ShiftsList: React.FC<ShiftsListProps> = ({
  shifts,
  isLoading,
  selectedShiftId,
  onSelectShift,
}) => {
  return (
    <div className="w-[400px] border-r border-white/10 flex flex-col bg-[#111623]">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-white/5 shrink-0 bg-[#0d1424]">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <span>Open Shifts</span>
          <Badge
            variant="secondary"
            className="bg-white/10 text-white/70 h-5 px-1.5 text-[10px]"
          >
            {shifts.length}
          </Badge>
        </div>
        <div className="text-[10px] text-white/40">Sorted by Deadline</div>
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
              isSelected={selectedShiftId === shift.id}
              onClick={() => onSelectShift(shift.id)}
              timeRemaining={calculateTimeRemaining(shift.biddingDeadline)}
            />
          ))
        )}
      </div>
    </div>
  );
};

const LoadingState: React.FC = () => (
  <div className="p-8 flex justify-center">
    <Loader2 className="h-6 w-6 text-white/20 animate-spin" />
  </div>
);

const EmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-8 text-center text-white/30">
    <Search className="h-12 w-12 mb-4 opacity-20" />
    <p className="text-sm font-medium">No shifts found</p>
    <p className="text-xs mt-1">Try adjusting your filters</p>
  </div>
);
