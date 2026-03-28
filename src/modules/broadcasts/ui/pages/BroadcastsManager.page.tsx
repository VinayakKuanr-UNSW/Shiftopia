import React, { useState } from 'react';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import { BroadcastsManagerScreen } from '../screens/BroadcastsManagerScreen';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

export const BroadcastsManagerPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
  const [controlRoomOpen, setControlRoomOpen] = useState(false);

  return (
    <div>
      {!controlRoomOpen && (
        <ScopeFilterBanner
          mode="managerial"
          onScopeChange={setScope}
          hidden={isGammaLocked}
          className="m-4 md:m-6"
        />
      )}
      <BroadcastsManagerScreen
        layout={breakpoint}
        scope={scope}
        onControlRoomChange={setControlRoomOpen}
      />
    </div>
  );
};

export default BroadcastsManagerPage;
