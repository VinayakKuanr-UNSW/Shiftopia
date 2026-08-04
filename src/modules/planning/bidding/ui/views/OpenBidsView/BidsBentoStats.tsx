import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Zap, Users, ShieldCheck, TrendingUp, Sparkles, ChevronUp, ChevronDown, Activity, Clock, Percent, AlertTriangle, Info, Bot, ActivitySquare } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { BidToggle, ManagerBidShift } from './types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';

interface BidsBentoStatsProps {
  shifts: ManagerBidShift[];
  activeToggle: BidToggle;
  onToggleChange: (toggle: BidToggle) => void;
  onRunBatch?: () => void;
  isBatchRunning?: boolean;
}

export const BidsBentoStats: React.FC<BidsBentoStatsProps> = ({
  shifts,
  activeToggle,
  onToggleChange,
  onRunBatch,
  isBatchRunning,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Core Computations
  const totalPublished = shifts.length;
  const totalBids = shifts.reduce((acc, s) => acc + (s.bidCount || 0), 0);
  const avgBidsPerShift = totalPublished > 0 ? (totalBids / totalPublished).toFixed(1) : '0.0';
  
  const shiftsWithBids = shifts.filter(s => s.bidCount > 0).length;
  const bidCoverage = totalPublished > 0 ? Math.round((shiftsWithBids / totalPublished) * 100) : 0;
  
  const urgentCount = shifts.filter(s => s.toggle === 'urgent').length;
  // Critical Risk: Urgent shifts with NO bids
  const criticalCount = shifts.filter(s => s.toggle === 'urgent' && s.bidCount === 0).length;
  
  const autoAssignReady = shifts.filter(s => (s.toggle === 'standard' || s.toggle === 'urgent') && s.bidCount > 0).length;
  
  const resolvedCount = shifts.filter(s => s.toggle === 'resolved').length;
  const resolutionRate = totalPublished > 0 ? Math.round((resolvedCount / totalPublished) * 100) : 0;
  
  const expiredCount = shifts.filter(s => s.toggle === 'expired').length;
  const expiredWithoutBidCount = shifts.filter(s => s.toggle === 'expired' && s.bidCount === 0).length;
  const expiredWithoutBidRate = totalPublished > 0 ? Math.round((expiredWithoutBidCount / totalPublished) * 100) : 0;



  // Reusable sub-component for metric cards
  const MetricCard = ({ 
    title, value, subtitle, icon: Icon, colorClass, borderClass, bgClass, 
    onClick, isInteractive, badgeText, badgeColorClass,
    tooltipText 
  }: any) => (
    <div
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-xl p-3 border transition-all duration-300',
        isInteractive ? 'cursor-pointer hover:shadow-md' : '',
        bgClass || 'bg-card/60 backdrop-blur-xl hover:bg-card/80',
        borderClass || 'border-border/60 hover:border-border/80 hover:border-primary/30'
      )}
    >
      <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-10 transition-opacity">
        <Icon className={cn("h-12 w-12", colorClass)} />
      </div>
      <div className="flex items-start justify-between mb-2">
        <span className={cn("text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5", colorClass)}>
          <Icon className="h-3.5 w-3.5" />
          {title}
          {tooltipText && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/60 cursor-help ml-0.5" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px] text-xs">
                {tooltipText}
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        {badgeText && (
          <span className={cn("text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full border", badgeColorClass)}>
            {badgeText}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 z-10 relative">
        <span className={cn("text-xl font-black font-mono tracking-tight", colorClass)}>
          {value}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground/80 font-medium z-10 relative">
        <span>{subtitle}</span>
      </div>
    </div>
  );

  return (
    <div className="shrink-0 px-4 pt-3 pb-1 select-none">
      {/* Header & Collapse Toggle */}
      <div className="flex items-center justify-between mb-2.5 px-1">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
            <ActivitySquare className="h-3.5 w-3.5" />
          </div>
          <h2 className="text-xs font-black uppercase tracking-wider text-foreground/90">
            Marketplace Analytics
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
            {/* Bento Grid: 2 rows of 2 on md, 1 row of 4 on wide screens */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pb-2">
              
              <MetricCard
                title="Bid Demand"
                value={`${avgBidsPerShift}`}
                subtitle={`From ${totalBids} total bids`}
                icon={Users}
                colorClass="text-primary"
                borderClass={activeToggle === 'standard' ? 'border-primary/40 ring-1 ring-primary/20' : ''}
                bgClass={activeToggle === 'standard' ? 'bg-primary/10' : ''}
                isInteractive
                onClick={() => onToggleChange('standard')}
                tooltipText="Average bids per published shift."
              />

              <MetricCard
                title="Coverage"
                value={`${bidCoverage}%`}
                subtitle={`${shiftsWithBids} of ${totalPublished} shifts`}
                icon={TrendingUp}
                colorClass="text-emerald-500"
                tooltipText="Percentage of published shifts that have at least one bid."
              />



              <MetricCard
                title="Award Completion"
                value={`${resolutionRate}%`}
                subtitle={`${resolvedCount} awarded`}
                icon={ShieldCheck}
                colorClass="text-teal-500"
                borderClass={activeToggle === 'resolved' ? 'border-teal-500/40 ring-1 ring-teal-500/20' : ''}
                bgClass={activeToggle === 'resolved' ? 'bg-teal-500/10' : ''}
                isInteractive
                onClick={() => onToggleChange('resolved')}
                tooltipText="Percentage of published shifts that have been successfully filled."
              />

              <MetricCard
                title="Expired W/O Bid"
                value={`${expiredWithoutBidRate}%`}
                subtitle={`${expiredWithoutBidCount} expired w/o bid`}
                icon={AlertTriangle}
                colorClass="text-slate-400"
                borderClass={activeToggle === 'expired' ? 'border-slate-500/40 ring-1 ring-slate-500/20' : ''}
                bgClass={activeToggle === 'expired' ? 'bg-slate-500/10' : ''}
                isInteractive
                onClick={() => onToggleChange('expired')}
                tooltipText="Percentage of published shifts that expired without receiving a single bid."
              />

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
