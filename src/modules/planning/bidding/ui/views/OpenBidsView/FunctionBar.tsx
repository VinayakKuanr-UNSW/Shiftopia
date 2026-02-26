// src/modules/planning/bidding/ui/views/OpenBidsView/FunctionBar.tsx

import React from 'react';
import { Search, CheckSquare, Square, XCircle, Flame, Clock, CheckCircle } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { cn } from '@/modules/core/lib/utils';
import type { FilterState, ShiftStatus, StatusCounts } from './types';

interface FunctionBarProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  isBulkMode: boolean;
  toggleBulkMode: () => void;
  counts: StatusCounts;
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onBulkWithdraw: () => void;
}

export const FunctionBar: React.FC<FunctionBarProps> = ({
  searchQuery,
  setSearchQuery,
  filters,
  setFilters,
  isBulkMode,
  toggleBulkMode,
  counts,
  selectedCount,
  totalCount,
  onSelectAll,
  onBulkWithdraw,
}) => {
  const statusButtons: Array<{ status: ShiftStatus; label: string; icon: React.ReactNode; activeClass: string }> = [
    {
      status: 'urgent',
      label: 'Urgent',
      icon: <Flame className="h-3 w-3" />,
      activeClass: 'bg-red-500/15 text-red-400 border-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.1)]',
    },
    {
      status: 'pending',
      label: 'Pending',
      icon: <Clock className="h-3 w-3" />,
      activeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.1)]',
    },
    {
      status: 'resolved',
      label: 'Resolved',
      icon: <CheckCircle className="h-3 w-3" />,
      activeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.1)]',
    },
  ];

  return (
    <div className="shrink-0 z-20 relative">
      {/* Main Bar */}
      <div className="h-14 px-5 border-b border-white/[0.06] bg-[#0a0f1a]/80 backdrop-blur-xl flex items-center justify-between gap-4">
        {/* LEFT: Search */}
        <div className="flex items-center gap-3">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search roles, departments…"
              className="h-9 pl-9 bg-white/[0.03] border-white/[0.06] text-sm text-white/80 placeholder:text-white/25 rounded-lg focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-500/20 transition-all"
            />
          </div>
        </div>

        {/* CENTER: Status Chips */}
        <div className="flex items-center gap-1.5">
          {statusButtons.map(({ status, label, icon, activeClass }) => {
            const isActive = filters.status === status;
            return (
              <button
                key={status}
                onClick={() =>
                  setFilters({ status: filters.status === status ? 'all' : status })
                }
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 border',
                  isActive
                    ? activeClass
                    : 'text-white/35 border-transparent hover:text-white/55 hover:bg-white/[0.03]'
                )}
              >
                {icon}
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 min-w-[18px] text-center text-[10px] font-bold',
                    isActive ? 'bg-white/10 text-inherit' : 'bg-white/[0.04] text-white/25'
                  )}
                >
                  {counts[status]}
                </span>
              </button>
            );
          })}
        </div>

        {/* RIGHT: Bulk Mode Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleBulkMode}
            className={cn(
              'h-9 w-9 flex items-center justify-center rounded-lg border transition-all duration-200',
              isBulkMode
                ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400 shadow-[0_0_16px_rgba(6,182,212,0.15)]'
                : 'bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.05]'
            )}
            title={isBulkMode ? 'Exit Bulk Mode' : 'Enter Bulk Mode'}
          >
            {isBulkMode ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Bulk Action Bar — appears when in bulk mode with selections */}
      {isBulkMode && (
        <div className="h-11 px-5 border-b border-cyan-500/10 bg-gradient-to-r from-cyan-950/40 via-cyan-900/20 to-transparent backdrop-blur-xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onSelectAll}
              className="text-[11px] font-medium text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1.5"
            >
              {selectedCount === totalCount && totalCount > 0 ? (
                <CheckSquare className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              {selectedCount === totalCount && totalCount > 0 ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-[11px] text-white/30">
              {selectedCount} of {totalCount} selected
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={selectedCount === 0}
              onClick={onBulkWithdraw}
              className={cn(
                'h-7 text-[11px] gap-1.5 rounded-lg border transition-all',
                selectedCount > 0
                  ? 'border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300'
                  : 'border-white/[0.06] text-white/25 cursor-not-allowed'
              )}
            >
              <XCircle className="h-3 w-3" />
              Withdraw ({selectedCount})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
