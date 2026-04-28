import React, { useState } from 'react';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import { MyBroadcastsScreen } from '../screens/MyBroadcastsScreen';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { BroadcastFunctionBar } from '../components/BroadcastFunctionBar';
import { Radio } from 'lucide-react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';

export const MyBroadcastsPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');
  const { isDark } = useTheme();

  const [searchQuery, setSearchQuery] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isInChannel, setIsInChannel] = useState(false);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {!isInChannel && (
        <GoldStandardHeader
          title="My Broadcasts"
          Icon={Radio}
          scope={scope}
          setScope={setScope}
          isGammaLocked={isGammaLocked}
          functionBar={
            <BroadcastFunctionBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onRefresh={() => setRefreshTrigger(prev => prev + 1)}
              onCreateGroup={() => {}}
            />
          }
        />
      )}

      <div className={cn(
        "flex-1 min-h-0 overflow-hidden mx-4 lg:mx-6 mb-4 lg:mb-6 rounded-[32px] border transition-all",
        isInChannel && "mt-4 lg:mt-6",
        isDark
          ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20"
          : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
      )}>
        <MyBroadcastsScreen
          layout={breakpoint}
          scope={scope}
          searchQuery={searchQuery}
          refreshTrigger={refreshTrigger}
          onInChannelChange={setIsInChannel}
        />
      </div>
    </div>
  );
};

export default MyBroadcastsPage;
