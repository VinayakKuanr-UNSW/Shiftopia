import React, { useState } from 'react';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import { BroadcastsManagerScreen } from '../screens/BroadcastsManagerScreen';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { BroadcastFunctionBar } from '../components/BroadcastFunctionBar';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { Megaphone } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

export const BroadcastsManagerPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
  const { isDark } = useTheme();
  
  // Hoisted state for standardization
  const [controlRoomOpen, setControlRoomOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 lg:p-6">
      {/* ── Unified Header Block (Rows 1-3) ────────────────────────────── */}
      {!controlRoomOpen && (
        <div className="flex-shrink-0 mb-6">
          <div className={cn(
            "rounded-[32px] p-4 lg:p-6 transition-all border",
            isDark 
              ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
              : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
          )}>
            {/* Row 1 & 2: Identity & Scope Filter */}
            <PersonalPageHeader
              title="Broadcast Center"
              Icon={Megaphone}
              scope={scope}
              setScope={setScope}
              isGammaLocked={isGammaLocked}
              className="mb-4 lg:mb-6"
            />

            {/* Row 3: Module Function Bar */}
            <BroadcastFunctionBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onRefresh={() => setRefreshTrigger(prev => prev + 1)}
              onCreateGroup={() => setShowCreateDialog(true)}
              className="mt-1"
            />
          </div>
        </div>
      )}

      {/* ── Main Content Area (Glassmorphic Container) ─────────────────── */}
      <div className={cn(
        "flex-1 min-h-0 overflow-hidden",
        !controlRoomOpen && "rounded-[32px] border transition-all",
        !controlRoomOpen && (isDark 
          ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
          : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50")
      )}>
        <BroadcastsManagerScreen
          layout={breakpoint}
          scope={scope}
          searchQuery={searchQuery}
          refreshTrigger={refreshTrigger}
          showCreateDialogOverride={showCreateDialog}
          onCloseCreateDialog={() => setShowCreateDialog(false)}
          onControlRoomChange={setControlRoomOpen}
        />
      </div>
    </div>
  );
};

export default BroadcastsManagerPage;
