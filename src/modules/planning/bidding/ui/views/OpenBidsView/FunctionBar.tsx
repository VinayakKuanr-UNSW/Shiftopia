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
      icon: <Flame className="h-3.5 w-3.5" />,
      activeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 shadow-sm shadow-rose-500/5 font-black',
    },
    {
      status: 'pending',
      label: 'Pending',
      icon: <Clock className="h-3.5 w-3.5" />,
      activeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 shadow-sm shadow-amber-500/5 font-black',
    },
    {
      status: 'resolved',
      label: 'Resolved',
      icon: <CheckCircle className="h-3.5 w-3.5" />,
      activeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 shadow-sm shadow-emerald-500/5 font-black',
    },
  ];

  return (
    <div className="shrink-0 z-20 relative">
      {/* Main Bar */}
      <div className="h-16 px-6 border-b border-border bg-card/80 backdrop-blur-xl flex items-center justify-between gap-4">
        {/* LEFT: Search */}
        <div className="flex items-center gap-3">
          <div className="relative w-80 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search roles, departments…"
              className="h-10 pl-10 bg-muted/30 border-border text-sm text-foreground placeholder:text-muted-foreground/40 rounded-xl focus:ring-1 focus:ring-primary/30 transition-all font-medium"
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
                  'px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all duration-300 flex items-center gap-2 border',
                  isActive
                    ? activeClass
                    : 'text-muted-foreground/40 border-transparent hover:text-foreground hover:bg-muted/50'
                )}
              >
                {icon}
                {label}
                <span
                  className={cn(
                    'rounded-full px-1.5 min-w-[20px] h-[20px] flex items-center justify-center text-[9px] font-black',
                    isActive ? 'bg-primary/10 text-inherit' : 'bg-muted text-muted-foreground/30'
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
              'h-10 w-10 flex items-center justify-center rounded-xl border transition-all duration-300',
              isBulkMode
                ? 'bg-primary/10 border-primary/30 text-primary shadow-lg shadow-primary/10'
                : 'bg-muted/30 border-border text-muted-foreground/40 hover:text-foreground hover:bg-muted/50'
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
        <div className="h-12 px-6 border-b border-primary/20 bg-primary/5 backdrop-blur-xl flex items-center justify-between gap-4 shadow-inner">
          <div className="flex items-center gap-4">
            <button
              onClick={onSelectAll}
              className="text-[11px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors flex items-center gap-2"
            >
              {selectedCount === totalCount && totalCount > 0 ? (
                <CheckSquare className="h-4 w-4" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {selectedCount === totalCount && totalCount > 0 ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-[11px] font-mono font-black text-muted-foreground/40 uppercase tracking-widest">
              {selectedCount} <span className="text-primary/30">/</span> {totalCount} SELECTED
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="destructive"
              disabled={selectedCount === 0}
              onClick={onBulkWithdraw}
              className={cn(
                'h-8 text-[10px] font-black uppercase tracking-[0.2em] rounded-xl transition-all shadow-lg',
                selectedCount > 0
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-500/20'
                  : 'bg-muted text-muted-foreground/30 shadow-none cursor-not-allowed border-none'
              )}
            >
              <XCircle className="h-3.5 w-3.5 mr-2" />
              Withdraw ({selectedCount})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
