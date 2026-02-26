// src/modules/planning/bidding/ui/views/OpenBidsView/BidsList.tsx

import React from 'react';
import { Users, Loader2, ArrowUpDown } from 'lucide-react';
import { BidCard } from './BidCard';
import type { EmployeeBid } from './types';

interface BidsListProps {
  bids: EmployeeBid[];
  isLoading: boolean;
  onAssign: (bid: EmployeeBid) => void;
}

export const BidsList: React.FC<BidsListProps> = ({ bids, isLoading, onAssign }) => {
  return (
    <>
      {/* Bids Header */}
      <BidsListHeader bidCount={bids.length} />

      {/* Bids Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <LoadingState />
        ) : bids.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2.5 max-w-4xl mx-auto">
            {bids.map((bid) => (
              <BidCard key={bid.id} bid={bid} onAssign={onAssign} />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

interface BidsListHeaderProps {
  bidCount: number;
}

const BidsListHeader: React.FC<BidsListHeaderProps> = ({ bidCount }) => (
  <div className="h-11 border-b border-white/[0.04] bg-[#0a0e18] px-6 flex items-center justify-between shrink-0">
    <div className="flex items-center gap-4 text-[12px] font-medium">
      <button className="h-11 border-b-2 border-cyan-500 text-cyan-400 px-1 flex items-center gap-1.5 transition-colors">
        All Bids
        <span className="bg-cyan-500/15 text-cyan-400 text-[10px] px-1.5 rounded-md font-bold">
          {bidCount}
        </span>
      </button>
      <button className="h-11 border-b-2 border-transparent text-white/30 hover:text-white/50 px-1 transition-colors">
        Shortlist (0)
      </button>
    </div>
    <div className="flex items-center gap-1.5 text-[10px] text-white/25 font-medium">
      <ArrowUpDown className="h-3 w-3" />
      Sort: Best Match
    </div>
  </div>
);

const LoadingState: React.FC = () => (
  <div className="flex justify-center p-12">
    <Loader2 className="h-7 w-7 text-cyan-500/50 animate-spin" />
  </div>
);

const EmptyState: React.FC = () => (
  <div className="border border-dashed border-white/[0.06] rounded-xl p-12 text-center flex flex-col items-center justify-center h-64">
    <div className="w-14 h-14 bg-white/[0.03] rounded-2xl flex items-center justify-center mb-4 border border-white/[0.04]">
      <Users className="h-7 w-7 text-white/15" />
    </div>
    <h3 className="text-white/60 font-semibold text-[13px] mb-1">No bids received yet</h3>
    <p className="text-[11px] text-white/25 max-w-[240px]">
      Employees haven't started bidding on this shift. Check back later.
    </p>
  </div>
);
