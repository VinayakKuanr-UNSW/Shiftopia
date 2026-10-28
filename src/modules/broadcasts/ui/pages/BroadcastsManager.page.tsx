import React, { useState } from 'react';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import { BroadcastsManagerScreen } from '../screens/BroadcastsManagerScreen';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { BroadcastFunctionBar } from '../components/BroadcastFunctionBar';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { Megaphone } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';

const BroadcastsManagerPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');

  const [controlRoomOpen, setControlRoomOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  return (
    <PageLayout bleed={controlRoomOpen}>
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
              onCreateGroup={() => setShowCreateDialog(true)}
            />
          }
        />
      )}

      <div className={cn(
        "flex-1 min-h-0 overflow-hidden",
        // The control room is full-screen: no card.
        !controlRoomOpen && surface.bodyCard
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
    </PageLayout>
  );
};

export default BroadcastsManagerPage;
