import React, { useState } from 'react';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import { BroadcastsManagerScreen } from '../screens/BroadcastsManagerScreen';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { BroadcastFunctionBar } from '../components/BroadcastFunctionBar';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { Megaphone } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

export const BroadcastsManagerPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
  const { isDark } = useTheme();

  const [controlRoomOpen, setControlRoomOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {!controlRoomOpen && (
        <GoldStandardHeader
          title="Broadcast Center"
          Icon={Megaphone}
          mode="managerial"
          scope={scope}
          setScope={setScope}
          isGammaLocked={isGammaLocked}
          functionBar={
            <BroadcastFunctionBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onRefresh={() => setRefreshTrigger(prev => prev + 1)}
              onCreateGroup={() => setShowCreateDialog(true)}
            />
          }
        />
      )}

      <div className={cn(
        "flex-1 min-h-0 overflow-hidden",
        !controlRoomOpen && "mx-4 lg:mx-6 mb-4 lg:mb-6 rounded-[32px] border transition-all",
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
