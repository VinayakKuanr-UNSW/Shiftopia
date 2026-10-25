import React from 'react';
import { Users, TrendingUp, ShieldCheck, AlertTriangle, ActivitySquare, Info } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { BidToggle, ManagerBidShift } from './types';
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';

export interface OpenBidsMetricsFooterProps {
  shifts: ManagerBidShift[];
  activeToggle?: BidToggle;
  onToggleChange?: (toggle: BidToggle) => void;
  className?: string;
}

/**
 * OpenBidsMetricsFooter
 *
 * Bottom marketplace analytics footer matching the exact container dimensions,
 * glassmorphism, height (h-14), border, and typography of RosterMetricsFooter:
 * - Standalone rounded-2xl capsule container outside the parent card
 * - Left: Marketplace Live Overview badge + Open Shifts in view counter
 * - Right: 4 core metric panels (Bid Demand, Coverage, Award Completion, Expired w/o Bid)
 */
export const OpenBidsMetricsFooter: React.FC<OpenBidsMetricsFooterProps> = ({
  shifts = [],
  activeToggle,
  onToggleChange,
  className,
}) => {
  // Core Computations
  const totalPublished = shifts.length;
  const totalBids = shifts.reduce((acc, s) => acc + (s.bidCount || 0), 0);
  const avgBidsPerShift = totalPublished > 0 ? (totalBids / totalPublished).toFixed(1) : '0.0';

  const shiftsWithBids = shifts.filter((s) => (s.bidCount || 0) > 0).length;
  const bidCoverage = totalPublished > 0 ? Math.round((shiftsWithBids / totalPublished) * 100) : 0;

  const resolvedCount = shifts.filter((s) => s.toggle === 'resolved').length;
  const resolutionRate = totalPublished > 0 ? Math.round((resolvedCount / totalPublished) * 100) : 0;

  const expiredWithoutBidCount = shifts.filter((s) => s.toggle === 'expired' && (s.bidCount || 0) === 0).length;
  const expiredWithoutBidRate = totalPublished > 0 ? Math.round((expiredWithoutBidCount / totalPublished) * 100) : 0;

  return (
    <TooltipProvider delayDuration={0}>
      <footer
        role="region"
        aria-label="Open Bids statistics and analytics"
        className={cn('w-full shrink-0', className)}
      >
      <div className="h-14 rounded-2xl bg-white/95 dark:bg-[#1c2333]/85 border border-slate-300 dark:border-white/5 shadow-sm backdrop-blur-md px-2.5 sm:px-3 flex items-center justify-between gap-2 w-full">
        {/* Left: Overview Chip & Open Shifts Count */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Marketplace Overview Pill */}
          <div className="flex items-center gap-2 sm:gap-2.5 px-2.5 sm:px-3 py-1.5 rounded-xl h-10 sm:h-10.5 bg-white dark:bg-[#1c2333] transition-all duration-300 hover:scale-[1.02] shadow-none select-none">
            <div className="h-6 w-6 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 shrink-0">
              <ActivitySquare className="h-3.5 w-3.5" />
            </div>
            <div className="flex flex-col items-start gap-0.5 text-left leading-none">
              <span className="text-[11px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 leading-none">
                Marketplace
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-900 dark:text-foreground leading-none">
                  Analytics
                </span>
                <span className="text-[11px] font-mono font-bold text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded-full border border-border/40 leading-none">
                  Live
                </span>
              </div>
            </div>
          </div>

          {/* Open Shifts in View */}
          <div className="flex items-center gap-3 px-2.5 sm:px-3 py-1.5 rounded-xl h-10 sm:h-10.5 bg-white dark:bg-[#1c2333] min-w-[95px] sm:min-w-[120px] transition-all duration-300 hover:scale-[1.02] shadow-none select-none">
            <div className="flex flex-col items-start gap-0.5 text-left">
              <span className="text-[11px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 leading-none">
                Open Shifts
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] sm:text-[13px] font-bold tabular-nums leading-none text-slate-900 dark:text-foreground">
                  {totalPublished}
                </span>
                <span className="text-[11px] font-mono text-slate-500 dark:text-muted-foreground leading-none">
                  shift{totalPublished === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: The 4 Marketplace Analytics Cards (scrollable on tight viewports) */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto overflow-x-auto scrollbar-none py-0.5 max-w-full">
          {/* 1. Bid Demand Card */}
          <button
            type="button"
            onClick={() => onToggleChange?.('standard')}
            title="Filter by standard shifts"
            className={cn(
              "h-10 sm:h-10.5 rounded-xl border px-2.5 sm:px-3 py-1 min-w-[120px] sm:min-w-[140px] flex flex-col justify-between transition-all duration-300 hover:scale-[1.02] text-left cursor-pointer",
              activeToggle === 'standard'
                ? "border-purple-500/50 bg-purple-500/15 ring-1 ring-purple-500/30"
                : "border-purple-400/35 dark:border-purple-500/25 bg-purple-500/10 hover:bg-purple-500/15"
            )}
          >
            <div className="flex items-baseline justify-between gap-1.5 w-full">
              <span className="text-[11px] sm:text-[11px] font-bold uppercase tracking-widest text-purple-700 dark:text-purple-400 leading-none flex items-center gap-1">
                <Users className="h-3 w-3 shrink-0" /> Demand
              </span>
              <span className="text-[11px] sm:text-[13px] font-mono font-bold text-purple-700 dark:text-purple-300 tabular-nums leading-none">
                {avgBidsPerShift}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-1.5 w-full">
              <span className="text-[11px] font-mono text-slate-600 dark:text-muted-foreground/80 leading-none truncate max-w-[100px]">
                From {totalBids} bid{totalBids === 1 ? '' : 's'}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help inline-flex items-center">
                    <Info className="h-2.5 w-2.5 text-purple-600/50 dark:text-purple-300/50" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[11px]">
                  Average bids per published shift.
                </TooltipContent>
              </Tooltip>
            </div>
          </button>

          {/* 2. Coverage Card */}
          <div
            className="h-10 sm:h-10.5 rounded-xl border border-emerald-400/35 dark:border-emerald-500/25 bg-emerald-500/10 px-2.5 sm:px-3 py-1 min-w-[120px] sm:min-w-[140px] flex flex-col justify-between transition-all duration-300 hover:scale-[1.02] text-left"
          >
            <div className="flex items-baseline justify-between gap-1.5 w-full">
              <span className="text-[11px] sm:text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 leading-none flex items-center gap-1">
                <TrendingUp className="h-3 w-3 shrink-0" /> Coverage
              </span>
              <span className="text-[11px] sm:text-[13px] font-mono font-bold text-emerald-700 dark:text-emerald-300 tabular-nums leading-none">
                {bidCoverage}%
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-1.5 w-full">
              <span className="text-[11px] font-mono text-slate-600 dark:text-muted-foreground/80 leading-none truncate max-w-[100px]">
                {shiftsWithBids} of {totalPublished} shifts
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help inline-flex items-center">
                    <Info className="h-2.5 w-2.5 text-emerald-600/50 dark:text-emerald-300/50" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[11px]">
                  Percentage of published shifts with at least one bid.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* 3. Award Completion Card */}
          <button
            type="button"
            onClick={() => onToggleChange?.('resolved')}
            title="Filter by resolved shifts"
            className={cn(
              "h-10 sm:h-10.5 rounded-xl border px-2.5 sm:px-3 py-1 min-w-[120px] sm:min-w-[140px] flex flex-col justify-between transition-all duration-300 hover:scale-[1.02] text-left cursor-pointer",
              activeToggle === 'resolved'
                ? "border-teal-500/50 bg-teal-500/15 ring-1 ring-teal-500/30"
                : "border-teal-400/35 dark:border-teal-500/25 bg-teal-500/10 hover:bg-teal-500/15"
            )}
          >
            <div className="flex items-baseline justify-between gap-1.5 w-full">
              <span className="text-[11px] sm:text-[11px] font-bold uppercase tracking-widest text-teal-700 dark:text-teal-400 leading-none flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 shrink-0" /> Awarded
              </span>
              <span className="text-[11px] sm:text-[13px] font-mono font-bold text-teal-700 dark:text-teal-300 tabular-nums leading-none">
                {resolutionRate}%
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-1.5 w-full">
              <span className="text-[11px] font-mono text-slate-600 dark:text-muted-foreground/80 leading-none truncate max-w-[100px]">
                {resolvedCount} filled
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help inline-flex items-center">
                    <Info className="h-2.5 w-2.5 text-teal-600/50 dark:text-teal-300/50" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[11px]">
                  Percentage of published shifts successfully filled.
                </TooltipContent>
              </Tooltip>
            </div>
          </button>

          {/* 4. Expired W/O Bid Card */}
          <button
            type="button"
            onClick={() => onToggleChange?.('expired')}
            title="Filter by expired shifts"
            className={cn(
              "h-10 sm:h-10.5 rounded-xl border px-2.5 sm:px-3 py-1 min-w-[120px] sm:min-w-[140px] flex flex-col justify-between transition-all duration-300 hover:scale-[1.02] text-left cursor-pointer",
              activeToggle === 'expired'
                ? "border-slate-500/50 bg-slate-500/15 ring-1 ring-slate-500/30"
                : "border-slate-400/35 dark:border-white/10 bg-slate-500/10 hover:bg-slate-500/15"
            )}
          >
            <div className="flex items-baseline justify-between gap-1.5 w-full">
              <span className="text-[11px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300 leading-none flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" /> Expired w/o Bid
              </span>
              <span className="text-[11px] sm:text-[13px] font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums leading-none">
                {expiredWithoutBidRate}%
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-1.5 w-full">
              <span className="text-[11px] font-mono text-slate-600 dark:text-muted-foreground/80 leading-none truncate max-w-[100px]">
                {expiredWithoutBidCount} expired
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help inline-flex items-center">
                    <Info className="h-2.5 w-2.5 text-slate-500/50 dark:text-slate-400/50" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[11px]">
                  Percentage of published shifts that expired without receiving any bid.
                </TooltipContent>
              </Tooltip>
            </div>
          </button>
        </div>
      </div>
    </footer>
    </TooltipProvider>
  );
};

export default OpenBidsMetricsFooter;
