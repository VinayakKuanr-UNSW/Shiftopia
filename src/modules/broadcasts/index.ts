// Public API for the Broadcasts module
// Following the Atlassian Model, only designated items are exported.

// Hooks
export {
    useBroadcastGroups,
    useEmployeeBroadcastGroups,
    useBroadcastGroup,
    useBroadcasts,
    useEmployeeBroadcasts,
    useBroadcastNotifications
} from './state/useBroadcasts';

// Pages (Layout Routers)
export { BroadcastsManagerPage } from './ui/pages/BroadcastsManager.page';
export { MyBroadcastsPage } from './ui/pages/MyBroadcastsPage';

// Screen Components (Orchestrators)
export { BroadcastsManagerScreen } from './ui/screens/BroadcastsManagerScreen';
export { MyBroadcastsScreen } from './ui/screens/MyBroadcastsScreen';

// Shared Components
export { EmployeeSelector } from '@/modules/core/ui/components/EmployeeSelector';
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
export { ControlRoom } from './ui/screens/ControlRoom';

// Types — explicit named exports only (no internal-only types leaked)
export type {
    BroadcastPriority,
    BroadcastStatus,
    AcknowledgementStatus,
    BroadcastParticipantRole,
    BroadcastParticipantStatus,
    BroadcastFileType,
    BroadcastAttachment,
    Broadcast,
    BroadcastWithDetails,
    BroadcastChannel,
    BroadcastChannelWithStats,
    GroupParticipant,
    GroupParticipantWithDetails,
    BroadcastGroup,
    BroadcastGroupWithStats,
    BroadcastGroupFull,
    EmployeeBroadcastGroup,
    BroadcastAcknowledgement,
    BroadcastAcknowledgementWithDetails,
    BroadcastAckStats,
    BroadcastNotification,
    CreateBroadcastGroupRequest,
    UpdateBroadcastGroupRequest,
    CreateBroadcastChannelRequest,
    CreateBroadcastRequest,
    AddParticipantRequest,
    BroadcastFilters,
    PaginationOptions,
    Employee,
    PaginatedResponse,
} from './model/broadcast.types';

// Services — public service objects only; internal query/command/DTO objects are not exposed
export {
    broadcastGroupService,
    broadcastChannelService,
    broadcastService,
    broadcastAttachmentService,
    groupParticipantService,
    broadcastNotificationService,
    broadcastRealtimeService,
    broadcastServices,
} from './api/broadcasts.api';
