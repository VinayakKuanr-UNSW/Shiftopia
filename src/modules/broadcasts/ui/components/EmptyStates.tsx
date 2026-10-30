import React from 'react';
import { Radio, MessageSquare, Hash } from 'lucide-react';
import { PageState } from '@/modules/core/ui/components/PageState';

export const EmptyGroups: React.FC = () => (
  <PageState
    state="empty"
    scope="page"
    icon={Radio}
    title="No broadcast groups"
    description="You haven't been added to any broadcast groups yet. Contact your manager if you believe this is an error."
  />
);

export const EmptyMessages: React.FC = () => (
  <PageState
    state="empty"
    className="h-full"
    icon={MessageSquare}
    title="No messages"
    description="No broadcasts have been sent to this channel yet."
  />
);

export const EmptyChannels: React.FC = () => (
  <PageState
    state="empty"
    className="h-full"
    icon={Hash}
    title="No channels"
    description="This group doesn't have any channels configured."
  />
);
