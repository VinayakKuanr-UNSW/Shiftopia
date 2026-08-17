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
  const [sortField, setSortField] = React.useState<'timestamp' | 'sss'>('sss');
  const [sortDirection, setSortDirection] = React.useState<'desc' | 'asc'>('desc');

  const sortedBids = React.useMemo(() => {
    return [...bids].sort((a, b) => {
      if (sortField === 'sss') {
        const diff = (b.sss ?? 0) - (a.sss ?? 0);
        return sortDirection === 'desc' ? diff : -diff;
      } else {
        const timeA = new Date(a.submittedAt).getTime();
        const timeB = new Date(b.submittedAt).getTime();
        const diff = timeB - timeA;
        return sortDirection === 'desc' ? diff : -diff;
      }
    });
  }, [bids, sortField, sortDirection]);

  return (
    <>
      {/* Bids Header */}
      <BidsListHeader
        bidCount={bids.length}
        sortField={sortField}
        sortDirection={sortDirection}
        onSortToggle={(field) => {
          if (sortField === field) {
            setSortDirection(d => d === 'desc' ? 'asc' : 'desc');
          } else {
            setSortField(field);
            setSortDirection('desc');
          }
        }}
      />

      {/* Bids Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <LoadingState />
        ) : sortedBids.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2.5 w-full">
            {sortedBids.map((bid) => (
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
  sortField: 'timestamp' | 'sss';
  sortDirection: 'asc' | 'desc';
  onSortToggle: (field: 'timestamp' | 'sss') => void;
}

const BidsListHeader: React.FC<BidsListHeaderProps> = ({
  bidCount,
  sortField,
  sortDirection,
  onSortToggle,
}) => (
  <div className="h-11 border-b border-white/[0.04] bg-[#0a0e18] px-6 flex items-center justify-between shrink-0">
    <div className="flex items-center gap-4 text-[12px] font-medium">
      <button className="h-11 border-b-2 border-cyan-500 text-cyan-400 px-1 flex items-center gap-1.5 transition-colors">
        All Bids
        <span className="bg-cyan-500/15 text-cyan-400 text-[10px] px-1.5 rounded-md font-bold">
          {bidCount}
        </span>
      </button>
    </div>
    <div className="flex items-center gap-2 text-[10px] font-medium">
      <span className="text-white/25 flex items-center gap-1"><ArrowUpDown className="h-3 w-3" /> Sort:</span>
      <button
        onClick={() => onSortToggle('sss')}
        className={`px-2 py-0.5 rounded font-bold transition-colors ${
          sortField === 'sss' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-white/40 hover:text-white/70'
        }`}
      >
        SSS {sortField === 'sss' && (sortDirection === 'desc' ? '↓' : '↑')}
      </button>
      <button
        onClick={() => onSortToggle('timestamp')}
        className={`px-2 py-0.5 rounded font-bold transition-colors ${
          sortField === 'timestamp' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-white/40 hover:text-white/70'
        }`}
      >
        Timestamp {sortField === 'timestamp' && (sortDirection === 'desc' ? '↓' : '↑')}
      </button>
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
