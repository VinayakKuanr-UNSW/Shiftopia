// src/modules/planning/bidding/ui/views/OpenBidsView/EmptySelectionState.tsx

import React from 'react';
import { Briefcase, CheckSquare } from 'lucide-react';

interface EmptySelectionStateProps {
  isBulkMode?: boolean;
  selectedCount?: number;
}

export const EmptySelectionState: React.FC<EmptySelectionStateProps> = ({
  isBulkMode = false,
  selectedCount = 0,
}) => (
  <div className="flex flex-col items-center justify-center h-full text-center p-8">
    {isBulkMode ? (
      <>
        <div className="w-20 h-20 bg-cyan-500/[0.06] rounded-2xl flex items-center justify-center mb-5 border border-cyan-500/10">
          <CheckSquare className="h-9 w-9 text-cyan-400/40" />
        </div>
        <h2 className="text-lg font-bold text-white/60 mb-1.5 tracking-tight">Bulk Mode Active</h2>
        <p className="max-w-[280px] text-[12px] text-white/25 leading-relaxed">
          {selectedCount === 0
            ? 'Select shifts from the panel on the left to perform bulk actions.'
            : `${selectedCount} shift${selectedCount !== 1 ? 's' : ''} selected. Use the action bar above to withdraw or modify.`
          }
        </p>
      </>
    ) : (
      <>
        <div className="w-20 h-20 bg-white/[0.025] rounded-2xl flex items-center justify-center mb-5 border border-white/[0.04]">
          <Briefcase className="h-9 w-9 text-white/12" />
        </div>
        <h2 className="text-lg font-bold text-white/50 mb-1.5 tracking-tight">No Shift Selected</h2>
        <p className="max-w-[260px] text-[12px] text-white/20 leading-relaxed">
          Select an open shift from the panel on the left to review details and manage bids.
        </p>
      </>
    )}
  </div>
);
