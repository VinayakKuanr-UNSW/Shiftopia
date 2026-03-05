// src/modules/planning/bidding/ui/views/OpenBidsView/BidCard.tsx

import React from 'react';
import { CheckCircle2, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { cn } from '@/modules/core/lib/utils';
import type { EmployeeBid } from './types';

interface BidCardProps {
  bid: EmployeeBid;
  onAssign: (bid: EmployeeBid) => void;
}

export const BidCard: React.FC<BidCardProps> = ({ bid, onAssign }) => {
  const riskConfig = {
    low: {
      label: 'Low Risk',
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      colorClass: 'text-emerald-600 dark:text-emerald-400',
      bgClass: 'bg-emerald-500/10 border-emerald-500/20',
    },
    medium: {
      label: 'Medium Risk',
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      colorClass: 'text-amber-600 dark:text-amber-400',
      bgClass: 'bg-amber-500/10 border-amber-500/20',
    },
    high: {
      label: 'High Risk',
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
      colorClass: 'text-rose-600 dark:text-rose-400',
      bgClass: 'bg-rose-500/10 border-rose-500/20',
    },
  };

  const risk = riskConfig[bid.fatigueRisk as keyof typeof riskConfig] || riskConfig.low;

  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-5 hover:bg-muted/30 hover:shadow-xl transition-all duration-300 group shadow-sm">
      {/* Avatar */}
      <Avatar className="h-12 w-12 ring-1 ring-border shadow-sm shrink-0">
        <AvatarImage
          src={`https://api.dicebear.com/7.x/personas/svg?seed=${bid.employeeName}`}
        />
        <AvatarFallback className="bg-primary text-primary-foreground text-xs font-black">
          {bid.employeeName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {/* Employee Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="text-foreground font-black text-sm truncate tracking-tight">{bid.employeeName}</h4>
          {bid.isBestMatch && (
            <Badge className="bg-primary/10 text-primary text-[8px] px-1.5 h-4 border-primary/20 font-black uppercase tracking-widest">
              BEST MATCH
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 font-mono font-black uppercase tracking-widest">
          <span>{bid.employmentType}</span>
          <span className="text-primary/20">•</span>
          <span>Submitted {new Date(bid.submittedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
        </div>
      </div>

      {/* Fatigue Risk */}
      <div className={cn(
        'px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-widest flex items-center gap-2 shrink-0 shadow-sm transition-transform group-hover:scale-105',
        risk.bgClass, risk.colorClass
      )}>
        {risk.icon}
        {risk.label}
      </div>

      {/* Assign Button */}
      <Button
        size="sm"
        onClick={() => onAssign(bid)}
        className="h-9 px-5 text-[10px] font-black uppercase tracking-[0.2em] bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20 rounded-xl transition-all duration-300 shrink-0 border-none"
      >
        Assign
      </Button>
    </div>
  );
};
