// Public API for the Broadcasts module
// Following the Atlassian Model, only designated items are exported.

// Hooks
export {
    useBroadcastGroups,
    useEmployeeBroadcastGroups,
    useBroadcastGroup,
    useBroadcasts,
    useEmployeeBroadcasts,
    useBroadcastAcknowledgements,
    useBroadcastNotifications
} from './state/useBroadcasts';

// Pages (Layout Routers)
export { BroadcastsManagerPage } from './ui/pages/BroadcastsManager.page';
export { MyBroadcastsPage } from './ui/pages/MyBroadcastsPage';

// Screen Components (Orchestrators)
export { BroadcastsManagerScreen } from './ui/screens/BroadcastsManagerScreen';
export { MyBroadcastsScreen } from './ui/screens/MyBroadcastsScreen';

// Layout Components
export {
    BroadcastsManagerDesktopLayout,
    BroadcastsManagerTabletLayout,
    BroadcastsManagerMobileLayout,
    MyBroadcastsDesktopLayout,
    MyBroadcastsTabletLayout,
    MyBroadcastsMobileLayout,
} from './layout';

// Shared Components
export { EmployeeSelector } from './ui/components/EmployeeSelector';
export { GroupsList } from './ui/components/GroupsList';
export { GroupMembers } from './ui/components/GroupMembers';
export { StatCard } from './ui/components/StatCard';
export { GroupCard } from './ui/components/GroupCard';
export { RichTextEditor } from './ui/components/RichTextEditor';
export { BroadcastItem } from './ui/components/BroadcastItem';
export { ParticipantItem } from './ui/components/ParticipantItem';
export { ComposeSection } from './ui/components/ComposeSection';

// Dialogs
export { AddMemberDialog } from './ui/dialogs/AddMemberDialog';
export { CreateGroupDialog } from './ui/dialogs/CreateGroupDialog';
export { EditGroupDialog } from './ui/dialogs/EditGroupDialog';


// Views
export { BroadcastGroupsView } from './ui/views/BroadcastGroups.view';
export { BroadcastNotificationsList } from './ui/views/BroadcastNotificationsList.view';
export { BroadcastAnalytics } from './ui/views/BroadcastAnalytics.view';
export { ControlRoom } from './ui/views/ControlRoom.view';

// Types
export * from './model/broadcast.types';
export * from './api/broadcasts.api';
