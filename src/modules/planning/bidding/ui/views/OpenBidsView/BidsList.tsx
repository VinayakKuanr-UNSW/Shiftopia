// src/modules/planning/ui/views/OpenBidsView/components/BidsList.tsx

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
      {/* Bids Header / Tabs */}
      <BidsListHeader bidCount={bids.length} />

      {/* Bids Content */}
      <div className="flex-1 overflow-y-auto p-8">
        {isLoading ? (
          <LoadingState />
        ) : bids.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3 max-w-4xl mx-auto">
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
  <div className="h-12 border-b border-white/10 bg-[#111623] px-8 flex items-center justify-between shrink-0">
    <div className="flex items-center gap-4 text-sm font-medium text-white/80">
      <button className="h-12 border-b-2 border-purple-500 text-purple-400 px-2">
        All Bids ({bidCount})
      </button>
      <button className="h-12 border-b-2 border-transparent text-white/40 hover:text-white/60 px-2 transition-colors">
        Shortlist (0)
      </button>
    </div>
    <div className="flex items-center gap-2 text-xs text-white/40">
      <ArrowUpDown className="h-3 w-3" /> Sort by: Best Match
    </div>
  </div>
);

const LoadingState: React.FC = () => (
  <div className="flex justify-center p-12">
    <Loader2 className="h-8 w-8 text-purple-500 animate-spin" />
  </div>
);

const EmptyState: React.FC = () => (
  <div className="border-2 border-dashed border-white/10 rounded-xl p-12 text-center flex flex-col items-center justify-center h-64">
    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
      <Users className="h-8 w-8 text-white/20" />
    </div>
    <h3 className="text-white font-medium mb-1">No bids received yet</h3>
    <p className="text-sm text-white/40 max-w-xs">
      Employees haven't started bidding on this shift. Check back later.
    </p>
  </div>
);
