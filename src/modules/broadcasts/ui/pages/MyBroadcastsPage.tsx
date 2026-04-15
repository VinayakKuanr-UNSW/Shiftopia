import React from 'react';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import { MyBroadcastsScreen } from '../screens/MyBroadcastsScreen';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

export const MyBroadcastsPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

  return (
    <div className="pb-24 md:pb-0">
      <ScopeFilterBanner
        mode="personal"
        onScopeChange={setScope}
        hidden={isGammaLocked}
        className="m-4 md:m-6"
      />
      <MyBroadcastsScreen layout={breakpoint} scope={scope} />
    </div>
  );
};

export default MyBroadcastsPage;
