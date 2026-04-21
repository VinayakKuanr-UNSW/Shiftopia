import React from 'react';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import { MyBroadcastsScreen } from '../screens/MyBroadcastsScreen';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { Radio } from 'lucide-react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

export const MyBroadcastsPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

  return (
    <div className="pb-24 md:pb-0">
      <div className="px-4 pt-6">
        <PersonalPageHeader
          title="Broadcasts"
          Icon={Radio}
          scope={scope}
          setScope={setScope}
          isGammaLocked={isGammaLocked}
        />
      </div>
      <MyBroadcastsScreen layout={breakpoint} scope={scope} />
    </div>
  );
};

export default MyBroadcastsPage;
