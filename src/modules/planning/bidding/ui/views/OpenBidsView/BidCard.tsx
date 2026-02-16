// src/modules/planning/ui/views/OpenBidsView/components/BidCard.tsx

import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import type { EmployeeBid } from './types';

interface BidCardProps {
  bid: EmployeeBid;
  onAssign: (bid: EmployeeBid) => void;
}

export const BidCard: React.FC<BidCardProps> = ({ bid, onAssign }) => {
  return (
    <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-4 flex items-center gap-4 hover:border-purple-500/30 transition-colors">
      {/* Avatar */}
      <Avatar className="h-10 w-10 border border-white/10">
        <AvatarImage
          src={`https://api.dicebear.com/7.x/personas/svg?seed=${bid.employeeName}`}
        />
        <AvatarFallback>{bid.employeeName.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>

      {/* Employee Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="text-white font-bold text-sm truncate">{bid.employeeName}</h4>
          {bid.isBestMatch && (
            <Badge className="bg-purple-500 text-white text-[10px] px-1.5 h-4">
              BEST MATCH
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-white/50">
          <span>{bid.employmentType}</span>
          <span>•</span>
          <span>Submitted {new Date(bid.submittedAt).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Fatigue/Compliance Indicator */}
      <FatigueIndicator risk={bid.fatigueRisk} />

      {/* Assign Button */}
      <Button
        size="sm"
        className="bg-white/5 hover:bg-white/10 text-white border border-white/10 ml-2"
        onClick={() => onAssign(bid)}
      >
        Assign
      </Button>
    </div>
  );
};

interface FatigueIndicatorProps {
  risk: string;
}

const FatigueIndicator: React.FC<FatigueIndicatorProps> = ({ risk }) => {
  const getRiskDisplay = () => {
    switch (risk) {
      case 'low':
        return { label: 'Low Risk', colorClass: 'text-green-400' };
      case 'medium':
        return { label: 'Medium Risk', colorClass: 'text-amber-400' };
      case 'high':
        return { label: 'High Risk', colorClass: 'text-red-400' };
      default:
        return { label: 'Unknown', colorClass: 'text-white/50' };
    }
  };

  const { label, colorClass } = getRiskDisplay();

  return (
    <div className="px-4 py-1.5 bg-[#0d1424] rounded-lg border border-white/5">
      <div className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">
        Fatigue Risk
      </div>
      <div className={`text-xs font-bold ${colorClass} flex items-center gap-1`}>
        <CheckCircle2 className="h-3 w-3" /> {label}
      </div>
    </div>
  );
};
