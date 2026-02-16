// src/modules/planning/ui/views/OpenBidsView/components/EmptySelectionState.tsx

import React from 'react';
import { Briefcase } from 'lucide-react';

export const EmptySelectionState: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full text-white/30 text-center p-8">
    <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-6 animate-pulse">
      <Briefcase className="h-12 w-12 opacity-20" />
    </div>
    <h2 className="text-xl font-bold text-white/50 mb-2">No Shift Selected</h2>
    <p className="max-w-xs text-sm">
      Select an open shift from the panel on the left to review details and manage bids.
    </p>
  </div>
);
