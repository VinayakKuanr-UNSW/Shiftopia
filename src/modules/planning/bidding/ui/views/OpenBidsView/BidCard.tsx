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
      icon: <ShieldCheck className="h-3 w-3" />,
      colorClass: 'text-emerald-400',
      bgClass: 'bg-emerald-500/8 border-emerald-500/15',
    },
    medium: {
      label: 'Medium',
      icon: <AlertTriangle className="h-3 w-3" />,
      colorClass: 'text-amber-400',
      bgClass: 'bg-amber-500/8 border-amber-500/15',
    },
    high: {
      label: 'High Risk',
      icon: <ShieldAlert className="h-3 w-3" />,
      colorClass: 'text-red-400',
      bgClass: 'bg-red-500/8 border-red-500/15',
    },
  };

  const risk = riskConfig[bid.fatigueRisk as keyof typeof riskConfig] || riskConfig.low;

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 flex items-center gap-4 hover:bg-white/[0.035] hover:border-white/[0.1] transition-all duration-200 group">
      {/* Avatar */}
      <Avatar className="h-10 w-10 border border-white/[0.08] shrink-0">
        <AvatarImage
          src={`https://api.dicebear.com/7.x/personas/svg?seed=${bid.employeeName}`}
        />
        <AvatarFallback className="bg-white/[0.04] text-white/50 text-xs font-bold">
          {bid.employeeName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {/* Employee Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h4 className="text-white/90 font-semibold text-sm truncate">{bid.employeeName}</h4>
          {bid.isBestMatch && (
            <Badge className="bg-cyan-500/15 text-cyan-400 text-[9px] px-1.5 h-4 border-cyan-500/20 font-bold">
              BEST MATCH
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-white/35">
          <span>{bid.employmentType}</span>
          <span className="text-white/15">•</span>
          <span>Submitted {new Date(bid.submittedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
        </div>
      </div>

      {/* Fatigue Risk */}
      <div className={cn(
        'px-3 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 shrink-0',
        risk.bgClass, risk.colorClass
      )}>
        {risk.icon}
        {risk.label}
      </div>

      {/* Assign Button */}
      <Button
        size="sm"
        onClick={() => onAssign(bid)}
        className="h-8 px-4 text-[11px] font-semibold bg-white/[0.04] hover:bg-cyan-500/15 text-white/60 hover:text-cyan-400 border border-white/[0.08] hover:border-cyan-500/25 rounded-lg transition-all duration-200 shrink-0"
      >
        Assign
      </Button>
    </div>
  );
};
