import React, { useState } from 'react';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import { MyBroadcastsScreen } from '../screens/MyBroadcastsScreen';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { BroadcastFunctionBar } from '../components/BroadcastFunctionBar';
import { Radio } from 'lucide-react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';

export const MyBroadcastsPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

  const [searchQuery, setSearchQuery] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isInChannel, setIsInChannel] = useState(false);

  return (
    <PageLayout>
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
              // MyBroadcastsScreen is a member view — it has no group-creation
              // path, which is why this was previously wired to a no-op button.
              // Managers create groups on /broadcast.
              canCreateGroup={false}
            />
          }
        />
      )}

      <div className={cn(
        "flex-1 min-h-0 overflow-hidden",
        surface.bodyCard
      )}>
        <MyBroadcastsScreen
          layout={breakpoint}
          scope={scope}
          searchQuery={searchQuery}
          refreshTrigger={refreshTrigger}
          onInChannelChange={setIsInChannel}
        />
      </div>
    </PageLayout>
  );
};

export default MyBroadcastsPage;
