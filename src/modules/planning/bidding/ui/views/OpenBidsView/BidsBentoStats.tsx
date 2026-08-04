// src/modules/planning/bidding/ui/views/OpenBidsView/BidsBentoStats.tsx

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Zap, Users, ShieldCheck, TrendingUp, Sparkles, ChevronUp, ChevronDown, Filter } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { BidToggle } from './types';

interface BidsBentoStatsProps {
  totalShifts: number;
  totalBids: number;
  avgBidsPerShift: string;
  urgentCount: number;
  readyForAutoAssign: number;
  resolvedRate: number;
  resolvedCount: number;
  activeToggle: BidToggle;
  onToggleChange: (toggle: BidToggle) => void;
  onRunBatch?: () => void;
  isBatchRunning?: boolean;
}

export const BidsBentoStats: React.FC<BidsBentoStatsProps> = ({
  totalShifts,
  totalBids,
  avgBidsPerShift,
  urgentCount,
  readyForAutoAssign,
  resolvedRate,
  resolvedCount,
  activeToggle,
  onToggleChange,
  onRunBatch,
  isBatchRunning,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="shrink-0 px-4 pt-3 pb-1 select-none">
      {/* Header & Collapse Toggle */}
      <div className="flex items-center justify-between mb-2.5 px-1">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <h2 className="text-xs font-black uppercase tracking-wider text-foreground/90">
            Manager Bidding Intelligence
          </h2>
          <span className="text-[10px] font-mono font-bold text-muted-foreground/50 bg-muted/40 px-2 py-0.5 rounded-full border border-border/40">
            Live Overview
          </span>
        </div>

        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-[10px] font-mono font-bold text-muted-foreground hover:text-foreground flex items-center gap-1 bg-muted/30 hover:bg-muted/60 px-2.5 py-1 rounded-lg border border-border/40 transition-all"
          title={isCollapsed ? "Expand Statistics" : "Collapse Statistics"}
        >
          {isCollapsed ? (
            <>Show Stats <ChevronDown className="h-3 w-3" /></>
          ) : (
            <>Hide Stats <ChevronUp className="h-3 w-3" /></>
          )}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {/* Bento Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pb-2">
              
              {/* BENTO CARD 1: Total Demand & Competition */}
              <div
                onClick={() => onToggleChange('standard')}
                className={cn(
                  'group relative overflow-hidden rounded-2xl p-4 border transition-all duration-300 cursor-pointer',
                  activeToggle === 'standard'
                    ? 'bg-primary/10 border-primary/40 shadow-lg shadow-primary/5 ring-1 ring-primary/20'
                    : 'bg-card/60 backdrop-blur-xl border-border/60 hover:border-primary/30 hover:bg-card/80 hover:shadow-md'
                )}
              >
                <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Users className="h-16 w-16 text-primary" />
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-primary" /> Demand & Bids
                  </span>
                  <span className="text-[9px] font-mono font-bold bg-primary/15 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                    {avgBidsPerShift} bids/shift
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black font-mono tracking-tight text-foreground">
                    {totalBids}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    total bids for <span className="font-bold text-foreground font-mono">{totalShifts}</span> shifts
                  </span>
                </div>
                <div className="mt-2.5 flex items-center gap-2 text-[10px] text-muted-foreground/80 font-medium">
                  <TrendingUp className="h-3 w-3 text-emerald-500" />
                  <span>High candidate interest</span>
                </div>
              </div>

              {/* BENTO CARD 2: Urgent Shifts */}
              <div
                onClick={() => onToggleChange('urgent')}
                className={cn(
                  'group relative overflow-hidden rounded-2xl p-4 border transition-all duration-300 cursor-pointer',
                  activeToggle === 'urgent'
                    ? 'bg-rose-500/10 border-rose-500/40 shadow-lg shadow-rose-500/5 ring-1 ring-rose-500/20'
                    : 'bg-card/60 backdrop-blur-xl border-border/60 hover:border-rose-500/30 hover:bg-card/80 hover:shadow-md'
                )}
              >
                <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Flame className="h-16 w-16 text-rose-500" />
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-rose-500/90 flex items-center gap-1.5">
                    <Flame className="h-3.5 w-3.5 text-rose-500 animate-pulse" /> Urgent Priority
                  </span>
                  {urgentCount > 0 && (
                    <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black font-mono tracking-tight text-rose-600 dark:text-rose-400">
                    {urgentCount}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    shifts require action
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[10px]">
                  <span className="text-rose-500/80 font-semibold">
                    {urgentCount > 0 ? 'High risk of unfilled shift' : 'All urgent shifts covered'}
                  </span>
                  <span className="font-mono text-muted-foreground/60 group-hover:text-rose-500 flex items-center gap-0.5 font-bold">
                    Filter <Filter className="h-2.5 w-2.5" />
                  </span>
                </div>
              </div>

              {/* BENTO CARD 3: Auto-Assign Batch Readiness */}
              <div
                onClick={() => onRunBatch?.()}
                className={cn(
                  'group relative overflow-hidden rounded-2xl p-4 border transition-all duration-300 cursor-pointer',
                  readyForAutoAssign > 0
                    ? 'bg-amber-500/10 border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 shadow-sm'
                    : 'bg-card/60 backdrop-blur-xl border-border/60 opacity-80'
                )}
              >
                <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Zap className="h-16 w-16 text-amber-500" />
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-amber-500" /> Auto-Assign Ready
                  </span>
                  <span className="text-[9px] font-mono font-bold bg-amber-500/20 text-amber-600 dark:text-amber-300 px-2 py-0.5 rounded-full">
                    1-Click Batch
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black font-mono tracking-tight text-amber-600 dark:text-amber-400">
                    {readyForAutoAssign}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    shifts clear for award
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[10px]">
                  <span className="text-amber-600/80 dark:text-amber-400/80 font-semibold">
                    {isBatchRunning ? 'Running batch…' : 'Click to run batch now'}
                  </span>
                  <span className="font-bold text-amber-500 group-hover:underline">
                    Run Batch &rarr;
                  </span>
                </div>
              </div>

              {/* BENTO CARD 4: Roster Resolution Rate */}
              <div
                onClick={() => onToggleChange('resolved')}
                className={cn(
                  'group relative overflow-hidden rounded-2xl p-4 border transition-all duration-300 cursor-pointer',
                  activeToggle === 'resolved'
                    ? 'bg-emerald-500/10 border-emerald-500/40 shadow-lg shadow-emerald-500/5 ring-1 ring-emerald-500/20'
                    : 'bg-card/60 backdrop-blur-xl border-border/60 hover:border-emerald-500/30 hover:bg-card/80 hover:shadow-md'
                )}
              >
                <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                  <ShieldCheck className="h-16 w-16 text-emerald-500" />
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Resolution Rate
                  </span>
                  <span className="text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                    {resolvedCount} awarded
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
                    {resolvedRate}%
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    shifts resolved
                  </span>
                </div>
                <div className="mt-2.5 w-full bg-muted/80 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${resolvedRate}%` }}
                  />
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
