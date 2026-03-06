
// Broadcast Types
// Extracted from src/api/models/types.ts

export type BroadcastPriority = 'urgent' | 'high' | 'normal' | 'low';
export type BroadcastStatus = 'active' | 'archived' | 'expired';
export type AcknowledgementStatus = 'pending' | 'acknowledged';
export type BroadcastParticipantRole = 'admin' | 'broadcaster' | 'lead' | 'member';
export type BroadcastParticipantStatus = 'online' | 'offline' | 'away';
export type BroadcastFileType = 'pdf' | 'image' | 'document' | 'spreadsheet' | 'other';

export interface BroadcastAttachment {
    id: string;
    broadcastId: string;
    fileUrl: string;
    fileName: string;
    fileType: BroadcastFileType;
    fileSize?: number;
    createdAt?: string;
}

export interface Broadcast {
    id: string;
    channelId: string;
    authorId: string;
    organizationId?: string; // Multi-tenant support
    subject: string;
    content: string;
    priority: BroadcastPriority;
    isPinned: boolean;
    isArchived: boolean;
    requiresAcknowledgement: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface BroadcastWithDetails extends Broadcast {
    author: {
        id: string;
        name: string;
        email: string;
        avatar?: string;
    } | null;
    authorRole: string;
    attachments: BroadcastAttachment[];
    isRead?: boolean;
    acknowledgementStatus?: AcknowledgementStatus;
    acknowledgedAt?: string;
    ackStats?: BroadcastAckStats;
}

export interface BroadcastChannel {
    id: string;
    groupId: string;
    name: string;
    description?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface BroadcastChannelWithStats extends BroadcastChannel {
    activeBroadcastCount?: number;
}

export interface GroupParticipant {
    id: string;
    groupId: string;
    employeeId: string;
    role: BroadcastParticipantRole;
    joinedAt: string;
}

export interface GroupParticipantWithDetails extends GroupParticipant {
    employee: {
        id: string;
        name: string;
        email: string;
        avatar?: string;
    } | null;
}

export interface BroadcastGroup {
    id: string;
    name: string;
    description?: string;
    departmentId?: string;
    departmentName?: string;
    subDepartmentId?: string;
    subDepartmentName?: string;
    organizationId?: string;
    organizationName?: string;
    createdBy: string;
    isActive: boolean;
    icon?: string;
    color?: string;
    createdAt: string;
    updatedAt: string;
}

export interface BroadcastGroupWithStats extends BroadcastGroup {
    channelCount: number;
    participantCount: number;
    activeBroadcastCount: number;
    totalBroadcastCount?: number;
    lastBroadcastAt?: string;
    channels?: BroadcastChannelWithStats[];
    unreadCount?: number;
    hasUrgentMessages?: boolean;
    hasPendingAcknowledgements?: boolean;
}

export interface BroadcastGroupFull extends BroadcastGroupWithStats {
    participants: GroupParticipantWithDetails[];
}

export interface EmployeeBroadcastGroup extends BroadcastGroup {
    channels: BroadcastChannel[];
    unreadCount: number;
    hasUrgentMessages: boolean;
    hasPendingAcknowledgements: boolean;
    lastBroadcastAt?: string;
}


export interface BroadcastAcknowledgement {
    id: string;
    broadcastId: string;
    employeeId: string;
    acknowledgedAt: string;
}

export interface BroadcastAcknowledgementWithDetails extends BroadcastAcknowledgement {
    employee: {
        id: string;
        name: string;
        email: string;
    } | null;
}

export interface BroadcastAckStats {
    total: number;
    acknowledged: number;
    pending: number;
    percent: number;
}

export interface BroadcastNotification {
    id: string;
    broadcastId: string;
    channelId: string;
    groupId: string; // derived
    groupName: string; // derived
    subject: string;
    authorName: string;
    priority: BroadcastPriority;
    createdAt: string;
    isRead: boolean;
}

// REQUEST TYPES

export interface CreateBroadcastGroupRequest {
    name: string;
    description?: string;
    organizationId?: string;
    departmentId?: string;
    subDepartmentId?: string;
    icon?: string;
    color?: string;
}

export interface UpdateBroadcastGroupRequest extends Partial<CreateBroadcastGroupRequest> { }

export interface CreateBroadcastChannelRequest {
    groupId: string;
    name: string;
    description?: string;
}

export interface CreateBroadcastRequest {
    channelId: string;
    subject: string;
    content: string;
    priority: BroadcastPriority;
    isPinned?: boolean;
    requiresAcknowledgement?: boolean;
    attachments?: { file: File; name: string }[];
}

export interface AddParticipantRequest {
    groupId: string;
    employeeId: string;
    role?: BroadcastParticipantRole;
}

export interface BroadcastFilters {
    isArchived?: boolean;
    priority?: BroadcastPriority;
    isPinned?: boolean;
    requiresAcknowledgement?: boolean;
    search?: string;
    departmentId?: string; // Hierarchy filter
    subDepartmentId?: string; // Hierarchy filter
}

export interface PaginationOptions {
    page: number;
    pageSize: number;
}

// EMPLOYEE TYPE
export interface Employee {
    id: string;
    name: string;
    email: string;
    role: string;
    department?: string;
    avatar?: string;
}

export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}
