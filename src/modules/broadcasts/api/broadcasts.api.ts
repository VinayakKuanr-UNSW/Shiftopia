// ============================================================
// BROADCAST API - TAILORED FOR YOUR SETUP
// Location: src/modules/broadcasts/api/broadcasts.api.ts
// ============================================================

import { supabase } from '@/platform/realtime/client';
import type {
    BroadcastGroup,
    BroadcastGroupWithStats,
    BroadcastGroupFull,
    EmployeeBroadcastGroup,
    BroadcastChannel,
    BroadcastChannelWithStats,
    Broadcast,
    BroadcastWithDetails,
    BroadcastAttachment,
    BroadcastAcknowledgement,
    BroadcastAcknowledgementWithDetails,
    BroadcastNotification,
    GroupParticipant,
    GroupParticipantWithDetails,
    BroadcastAckStats,
    CreateBroadcastGroupRequest,
    UpdateBroadcastGroupRequest,
    CreateBroadcastChannelRequest,
    CreateBroadcastRequest,
    AddParticipantRequest,
    BroadcastFilters,
    PaginationOptions,
    PaginatedResponse,
    BroadcastParticipantRole,
    BroadcastFileType,
} from '../model/broadcast.types';

// ============================================================
// HELPER: Convert snake_case to camelCase
// ============================================================

function toCamelCase<T>(obj: any): T {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
        return obj.map((item) => toCamelCase(item)) as T;
    }

    if (typeof obj === 'object' && obj !== null) {
        return Object.keys(obj).reduce((result, key) => {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
                letter.toUpperCase()
            );
            result[camelKey] = toCamelCase(obj[key]);
            return result;
        }, {} as any) as T;
    }

    return obj;
}

function toSnakeCase(obj: any): any {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
        return obj.map((item) => toSnakeCase(item));
    }

    if (typeof obj === 'object' && obj !== null) {
        return Object.keys(obj).reduce((result, key) => {
            const snakeKey = key.replace(
                /[A-Z]/g,
                (letter) => `_${letter.toLowerCase()}`
            );
            result[snakeKey] = toSnakeCase(obj[key]);
            return result;
        }, {} as any);
    }

    return obj;
}

// Helper to get file type from extension
function getFileTypeFromName(fileName: string): BroadcastFileType {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    const typeMap: Record<string, BroadcastFileType> = {
        pdf: 'pdf',
        png: 'image',
        jpg: 'image',
        jpeg: 'image',
        gif: 'image',
        webp: 'image',
        doc: 'document',
        docx: 'document',
        txt: 'document',
        rtf: 'document',
        xls: 'spreadsheet',
        xlsx: 'spreadsheet',
        csv: 'spreadsheet',
    };
    return typeMap[ext] || 'other';
}

// ============================================================
// BROADCAST GROUPS
// ============================================================

export const broadcastGroupService = {
    /**
     * Get all groups (manager view with full stats)
     */
    async getAll(filters?: { departmentId?: string; subDepartmentId?: string }): Promise<BroadcastGroupWithStats[]> {
        let query = supabase
            .from('v_broadcast_groups_with_stats')
            .select('*')
            .order('name');

        if (filters?.departmentId) {
            query = query.eq('department_id', filters.departmentId);
        }

        if (filters?.subDepartmentId) {
            query = query.eq('sub_department_id', filters.subDepartmentId);
        }

        // Cast result to break infinite recursion in type inference
        const { data, error } = (await query) as any;

        if (error) throw error;
        return toCamelCase(data || []);
    },

    /**
     * Get groups for employee (with unread counts)
     */
    async getForEmployee(employeeId: string): Promise<EmployeeBroadcastGroup[]> {
        // Get groups where employee is a participant
        const { data: participantGroups, error: pgError } = await supabase
            .from('group_participants')
            .select('group_id')
            .eq('employee_id', employeeId);

        if (pgError) throw pgError;

        const groupIds = (participantGroups || []).map((p: any) => p.group_id);

        if (groupIds.length === 0) {
            return [];
        }

        // Get groups with stats
        const { data: groups, error: groupsError } = await supabase
            .from('v_broadcast_groups_with_stats')
            .select('*')
            .in('id', groupIds);

        if (groupsError) throw groupsError;

        // Get channels for each group
        const { data: channels, error: channelsError } = await supabase
            .from('v_channels_with_stats')
            .select('*')
            .in('group_id', groupIds)
            .eq('is_active', true);

        if (channelsError) throw channelsError;

        // Get unread stats
        const { data: unreadStats, error: unreadError } = await supabase
            .from('v_unread_broadcasts_by_group')
            .select('*')
            .eq('employee_id', employeeId);

        if (unreadError) throw unreadError;

        // Merge data
        const unreadMap = new Map(unreadStats?.map((s) => [s.group_id, s]) || []);
        const channelsMap = new Map<string, any[]>();
        channels?.forEach((c) => {
            if (!channelsMap.has(c.group_id)) channelsMap.set(c.group_id, []);
            channelsMap.get(c.group_id)!.push(c);
        });

        return toCamelCase(
            (groups || []).map((group) => {
                const stats = unreadMap.get(group.id);
                return {
                    ...group,
                    channels: channelsMap.get(group.id) || [],
                    unreadCount: stats?.unread_count || 0,
                    hasUrgentMessages: stats?.has_urgent_unread || false,
                    hasPendingAcknowledgements: stats?.has_pending_ack || false,
                };
            })
        );
    },

    /**
     * Get single group with full details
     */
    async getById(groupId: string): Promise<BroadcastGroupFull | null> {
        const { data: group, error: groupError } = await supabase
            .from('broadcast_groups')
            .select('*')
            .eq('id', groupId)
            .single();

        if (groupError) {
            if (groupError.code === 'PGRST116') return null;
            throw groupError;
        }
        if (!group) return null;

        // Get channels
        const { data: channels, error: channelsError } = await supabase
            .from('v_channels_with_stats')
            .select('*')
            .eq('group_id', groupId)
            .eq('is_active', true);

        if (channelsError) throw channelsError;

        // Get participants with employee details
        const { data: participants, error: participantsError } = await supabase
            .from('group_participants')
            .select(
                `
        *,
        profiles(id, first_name, last_name, email)
      `
            )
            .eq('group_id', groupId);

        if (participantsError) throw participantsError;

        // Get stats
        const { data: stats, error: statsError } = await supabase
            .from('v_broadcast_groups_with_stats')
            .select('*')
            .eq('id', groupId)
            .single();

        if (statsError && statsError.code !== 'PGRST116') throw statsError;

        // Transform participants to include full name
        const transformedParticipants = (participants || []).map((p: any) => ({
            ...p,
            employee: p.profiles
                ? {
                    id: p.profiles.id,
                    name: `${p.profiles.first_name} ${p.profiles.last_name}`,
                    email: p.profiles.email,
                }
                : null,
        }));

        return toCamelCase({
            ...group,
            channelCount: stats?.channel_count || 0,
            participantCount: stats?.participant_count || 0,
            activeBroadcastCount: stats?.active_broadcast_count || 0,
            totalBroadcastCount: (stats as any)?.total_broadcast_count || 0,
            lastBroadcastAt: stats?.last_broadcast_at,
            channels: channels || [],
            participants: transformedParticipants,
        });
    },

    /**
     * Create new group
     */
    async create(
        data: CreateBroadcastGroupRequest,
        createdBy: string
    ): Promise<BroadcastGroup> {
        const { data: group, error } = await supabase
            .from('broadcast_groups')
            .insert({
                name: data.name,
                description: data.description,
                icon: data.icon || 'megaphone',
                color: data.color || 'blue',
                created_by: createdBy,
                department_id: data.departmentId,
                sub_department_id: data.subDepartmentId,
                organization_id: data.organizationId,
            })
            .select()
            .single();

        if (error) throw error;

        // Add creator as admin
        await supabase.from('group_participants').insert({
            group_id: group.id,
            employee_id: createdBy,
            role: 'admin',
        });

        // Create default 'General' channel
        const { data: channel, error: channelError } = await supabase
            .from('broadcast_channels')
            .insert({
                group_id: group.id,
                name: 'General',
                description: 'General discussion',
                is_active: true,
            })
            .select()
            .single();

        if (channelError) throw channelError;

        return toCamelCase({
            ...group,
            channels: [channel],
            participantCount: 1, // Start with 1 participant (creator)
            activeBroadcastCount: 0,
            channelCount: 1
        });
    },

    /**
     * Update group
     */
    async update(
        groupId: string,
        data: UpdateBroadcastGroupRequest
    ): Promise<BroadcastGroup> {
        const { data: group, error } = await supabase
            .from('broadcast_groups')
            .update(toSnakeCase(data))
            .eq('id', groupId)
            .select()
            .single();

        if (error) throw error;
        return toCamelCase(group);
    },

    /**
     * Delete group (soft delete)
     */
    async delete(groupId: string): Promise<void> {
        const { error } = await supabase
            .from('broadcast_groups')
            .update({ is_active: false })
            .eq('id', groupId);

        if (error) throw error;
    },
};

// ============================================================
// BROADCAST CHANNELS
// ============================================================

export const broadcastChannelService = {
    /**
     * Get channels for a group
     */
    async getByGroupId(groupId: string): Promise<BroadcastChannelWithStats[]> {
        const { data, error } = await supabase
            .from('v_channels_with_stats')
            .select('*')
            .eq('group_id', groupId)
            .eq('is_active', true)
            .order('name');

        if (error) throw error;
        return toCamelCase(data || []);
    },

    /**
     * Create channel
     */
    async create(data: CreateBroadcastChannelRequest): Promise<BroadcastChannel> {
        const { data: channel, error } = await supabase
            .from('broadcast_channels')
            .insert({
                group_id: data.groupId,
                name: data.name,
                description: data.description,
            })
            .select()
            .single();

        if (error) throw error;
        return toCamelCase(channel);
    },

    /**
     * Delete channel (soft delete)
     */
    async delete(channelId: string): Promise<void> {
        const { error } = await supabase
            .from('broadcast_channels')
            .update({ is_active: false })
            .eq('id', channelId);

        if (error) throw error;
    },
};

// ============================================================
// BROADCASTS
// ============================================================

export const broadcastService = {
    /**
     * Get broadcasts for a channel (manager view)
     */
    async getByChannelId(
        channelId: string,
        filters?: BroadcastFilters,
        pagination?: PaginationOptions
    ): Promise<PaginatedResponse<BroadcastWithDetails>> {
        let query = supabase
            .from('broadcasts')
            .select('*', { count: 'exact' })
            .eq('channel_id', channelId);

        // Apply filters
        if (filters?.isArchived !== undefined) {
            query = query.eq('is_archived', filters.isArchived);
        } else {
            query = query.eq('is_archived', false);
        }

        if (filters?.priority) {
            query = query.eq('priority', filters.priority);
        }

        if (filters?.isPinned !== undefined) {
            query = query.eq('is_pinned', filters.isPinned);
        }

        if (filters?.requiresAcknowledgement !== undefined) {
            query = query.eq(
                'requires_acknowledgement',
                filters.requiresAcknowledgement
            );
        }

        if (filters?.search) {
            query = query.or(
                `subject.ilike.%${filters.search}%,content.ilike.%${filters.search}%`
            );
        }

        // Apply sorting
        query = query
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: false });

        // Apply pagination
        const page = pagination?.page || 1;
        const pageSize = pagination?.pageSize || 20;
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;

        if (error) throw error;

        // Get ack stats and author info for each broadcast
        const broadcasts = await Promise.all(
            (data || []).map(async (broadcast) => {
                let ackStats: BroadcastAckStats | undefined;
                let author = null;

                if (broadcast.requires_acknowledgement) {
                    const { data: stats } = await supabase.rpc(
                        'get_broadcast_ack_stats',
                        { broadcast_uuid: broadcast.id }
                    );
                    if (stats && stats.length > 0) {
                        ackStats = toCamelCase(stats[0]);
                    }
                }

                // Get author info separately if author_id exists
                if (broadcast.author_id) {
                    const { data: emp } = await supabase
                        .from('profiles')
                        .select('id, first_name, last_name, email')
                        .eq('id', broadcast.author_id)
                        .maybeSingle();

                    if (emp) {
                        author = {
                            id: emp.id,
                            name: `${emp.first_name} ${emp.last_name}`,
                            email: emp.email,
                        };
                    }
                }

                // Get channel to find group, then get author role
                let authorRole = 'member';
                let attachments = [];

                if (broadcast.channel_id && broadcast.author_id) {
                    const { data: channel } = await supabase
                        .from('broadcast_channels')
                        .select('group_id')
                        .eq('id', broadcast.channel_id)
                        .maybeSingle();

                    if (channel?.group_id) {
                        const { data: participant } = await supabase
                            .from('group_participants')
                            .select('role')
                            .eq('group_id', channel.group_id)
                            .eq('employee_id', broadcast.author_id)
                            .maybeSingle();

                        authorRole = participant?.role || 'member';
                    }
                }

                // Fetch attachments separately
                const { data: attachmentData } = await supabase
                    .from('broadcast_attachments')
                    .select('*')
                    .eq('broadcast_id', broadcast.id);

                attachments = attachmentData || [];

                return {
                    ...broadcast,
                    author,
                    authorRole,
                    attachments,
                    ackStats,
                };
            })
        );

        return {
            data: toCamelCase(broadcasts),
            total: count || 0,
            page,
            pageSize,
            totalPages: Math.ceil((count || 0) / pageSize),
        };
    },

    /**
     * Get broadcasts for employee view (with read status) - Paginated
     */
    async getForEmployee(
        channelId: string,
        employeeId: string,
        pagination?: PaginationOptions
    ): Promise<PaginatedResponse<BroadcastWithDetails>> {
        let query = supabase
            .from('broadcasts')
            .select(
                `
        *,
        employees!author_id(id, first_name, last_name, email),
        broadcast_attachments(*),
        broadcast_channels!inner(group_id)
      `,
                { count: 'exact' }
            )
            .eq('channel_id', channelId)
            .eq('is_archived', false)
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: false });

        // Apply pagination
        const page = pagination?.page || 1;
        const pageSize = pagination?.pageSize || 20;
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;

        if (error) throw error;

        // Get read status and acknowledgements for this employee
        const broadcastIds = (data || []).map((b) => b.id);

        let readMap = new Map();
        let ackMap = new Map();

        if (broadcastIds.length > 0) {
            const { data: readStatuses } = await supabase
                .from('broadcast_read_status')
                .select('broadcast_id, read_at')
                .eq('employee_id', employeeId)
                .in('broadcast_id', broadcastIds);

            readMap = new Map(
                readStatuses?.map((r) => [r.broadcast_id, r.read_at]) || []
            );
        }

        // Transform broadcasts
        const broadcasts = await Promise.all(
            (data || []).map(async (broadcast) => {
                const { data: participant } = await supabase
                    .from('group_participants')
                    .select('role')
                    .eq('group_id', broadcast.broadcast_channels.group_id)
                    .eq('employee_id', broadcast.author_id)
                    .maybeSingle();

                return {
                    ...broadcast,
                    author: (broadcast as any).employees
                        ? {
                            id: (broadcast as any).employees.id,
                            name: `${(broadcast as any).employees.first_name} ${(broadcast as any).employees.last_name}`,
                            email: (broadcast as any).employees.email,
                        }
                        : null,
                    authorRole: participant?.role || 'member',
                    attachments: broadcast.broadcast_attachments || [],
                    isRead: readMap.has(broadcast.id),
                    acknowledgementStatus: 'pending',
                    acknowledgedAt: undefined,
                };
            })
        );

        return {
            data: toCamelCase(broadcasts),
            total: count || 0,
            page,
            pageSize,
            totalPages: Math.ceil((count || 0) / pageSize),
        };
    },

    /**
     * Create broadcast
     */
    async create(
        data: CreateBroadcastRequest,
        authorId: string
    ): Promise<Broadcast> {
        const { attachments, ...broadcastData } = data;

        const { data: broadcast, error } = await supabase
            .from('broadcasts')
            .insert({
                channel_id: broadcastData.channelId,
                author_id: authorId,
                created_by: authorId, // Map to created_by to satisfy DB constraint
                subject: broadcastData.subject,
                title: broadcastData.subject, // Map subject to title to satisfy DB constraint
                content: broadcastData.content,
                priority: broadcastData.priority,
                is_pinned: broadcastData.isPinned || false,
                requires_acknowledgement:
                    broadcastData.requiresAcknowledgement || false,
            })
            .select()
            .single();

        if (error) throw error;

        // Upload attachments
        if (attachments && attachments.length > 0) {
            for (const attachment of attachments) {
                await broadcastAttachmentService.create(broadcast.id, attachment.file);
            }
        }

        return toCamelCase(broadcast);
    },

    /**
     * Archive broadcast
     */
    async archive(broadcastId: string, archivedBy: string): Promise<void> {
        const { error } = await supabase
            .from('broadcasts')
            .update({
                is_archived: true,
                archived_by: archivedBy,
            })
            .eq('id', broadcastId);

        if (error) throw error;
    },

    /**
     * Unarchive broadcast
     */
    async unarchive(broadcastId: string): Promise<void> {
        const { error } = await supabase
            .from('broadcasts')
            .update({
                is_archived: false,
                archived_by: null,
            })
            .eq('id', broadcastId);

        if (error) throw error;
    },

    /**
     * Pin/Unpin broadcast
     */
    async togglePin(broadcastId: string, isPinned: boolean): Promise<void> {
        const { error } = await supabase
            .from('broadcasts')
            .update({ is_pinned: isPinned })
            .eq('id', broadcastId);

        if (error) throw error;
    },

    /**
     * Mark broadcast as read - DEPRECATED / REMOVED
     */
    // async markAsRead() ... removed

    /**
     * Acknowledge broadcast - DEPRECATED / REMOVED
     */
    // async acknowledge() ... removed

    /**
     * Delete acknowledgements - DEPRECATED / REMOVED
     */
    // async deleteAcknowledgements() ... removed

    /**
     * Get acknowledgement details - DEPRECATED / REMOVED
     */
    // async getAcknowledgements() ... removed
};

// ============================================================
// BROADCAST ATTACHMENTS
// ============================================================

export const broadcastAttachmentService = {
    /**
     * Upload and create attachment
     */
    async create(broadcastId: string, file: File): Promise<BroadcastAttachment> {
        const fileExt = file.name.split('.').pop();
        const fileName = `${broadcastId}/${Date.now()}.${fileExt}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('broadcast-attachments')
            .upload(fileName, file);

        if (uploadError) throw uploadError;

        const {
            data: { publicUrl },
        } = supabase.storage.from('broadcast-attachments').getPublicUrl(fileName);

        const { data, error } = await supabase
            .from('broadcast_attachments')
            .insert({
                broadcast_id: broadcastId,
                file_name: file.name,
                file_type: getFileTypeFromName(file.name),
                file_size: file.size,
                file_url: publicUrl,
                storage_path: uploadData.path,
            })
            .select()
            .single();

        if (error) throw error;
        return toCamelCase(data);
    },

    /**
     * Delete attachment
     */
    async delete(attachmentId: string): Promise<void> {
        const { data: attachment, error: getError } = await supabase
            .from('broadcast_attachments')
            .select('storage_path')
            .eq('id', attachmentId)
            .single();

        if (getError) throw getError;

        if (attachment?.storage_path) {
            await supabase.storage
                .from('broadcast-attachments')
                .remove([attachment.storage_path]);
        }

        const { error } = await supabase
            .from('broadcast_attachments')
            .delete()
            .eq('id', attachmentId);

        if (error) throw error;
    },
};

// ============================================================
// GROUP PARTICIPANTS
// ============================================================

export const groupParticipantService = {
    /**
     * Get participants for a group
     */
    async getByGroupId(groupId: string): Promise<GroupParticipantWithDetails[]> {
        const { data, error } = await supabase
            .from('group_participants')
            .select('*')
            .eq('group_id', groupId)
            .order('role')
            .order('joined_at');

        if (error) throw error;

        // Fetch employee details separately for each participant
        const participantsWithDetails = await Promise.all(
            (data || []).map(async (p) => {
                let employee = null;
                if (p.employee_id) {
                    const { data: emp } = await supabase
                        .from('profiles')
                        .select('id, first_name, last_name, email')
                        .eq('id', p.employee_id)
                        .maybeSingle();

                    if (emp) {
                        employee = {
                            id: emp.id,
                            name: `${emp.first_name} ${emp.last_name}`,
                            email: emp.email,
                        };
                    }
                }

                return {
                    ...p,
                    employee,
                };
            })
        );

        return toCamelCase(participantsWithDetails);
    },

    /**
     * Add participant to group
     */
    async add(data: AddParticipantRequest): Promise<GroupParticipant> {
        const { data: participant, error } = await supabase
            .from('group_participants')
            .insert({
                group_id: data.groupId,
                employee_id: data.employeeId,
                role: data.role || 'member',
            })
            .select()
            .single();

        if (error) throw error;
        return toCamelCase(participant);
    },

    /**
     * Update participant role
     */
    async updateRole(
        groupId: string,
        employeeId: string,
        role: BroadcastParticipantRole
    ): Promise<void> {
        // @ts-ignore
        if (role !== 'admin' && role !== 'broadcaster' && role !== 'member') {
            throw new Error('Invalid role');
        }

        const { error } = await supabase
            .from('group_participants')
            .update({ role: role as any } as any) // Double cast to force acceptance
            .eq('group_id', groupId)
            .eq('employee_id', employeeId);

        if (error) throw error;
    },

    /**
     * Remove participant from group
     */
    async remove(groupId: string, employeeId: string): Promise<void> {
        const { error } = await supabase
            .from('group_participants')
            .delete()
            .eq('group_id', groupId)
            .eq('employee_id', employeeId);

        if (error) throw error;
    },

    /**
     * Get user's role in a group
     */
    async getUserRole(
        groupId: string,
        employeeId: string
    ): Promise<BroadcastParticipantRole | null> {
        const { data, error } = await supabase
            .from('group_participants')
            .select('role')
            .eq('group_id', groupId)
            .eq('employee_id', employeeId)
            .maybeSingle();

        if (error) throw error;
        return data?.role || null;
    },
};

// ============================================================
// BROADCAST NOTIFICATIONS
// ============================================================

export const broadcastNotificationService = {
    /**
     * Get notifications for a user
     */
    async getForUser(
        employeeId: string,
        unreadOnly = false
    ): Promise<BroadcastNotification[]> {
        let query = supabase
            .from('broadcast_notifications')
            .select('*')
            .eq('employee_id', employeeId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (unreadOnly) {
            query = query.eq('is_read', false);
        }

        const { data, error } = await query;

        if (error) throw error;
        return toCamelCase(data || []);
    },

    /**
     * Get unread count
     */
    async getUnreadCount(employeeId: string): Promise<number> {
        const { count, error } = await supabase
            .from('broadcast_notifications')
            .select('*', { count: 'exact', head: true })
            .eq('employee_id', employeeId)
            .eq('is_read', false);

        if (error) throw error;
        return count || 0;
    },

    /**
     * Mark notification as read
     */
    async markAsRead(notificationId: string): Promise<void> {
        const { error } = await supabase
            .from('broadcast_notifications')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('id', notificationId);

        if (error) throw error;
    },

    /**
     * Mark all notifications as read
     */
    async markAllAsRead(employeeId: string): Promise<void> {
        const { error } = await supabase
            .from('broadcast_notifications')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('employee_id', employeeId)
            .eq('is_read', false);

        if (error) throw error;
    },
};

// ============================================================
// REAL-TIME SUBSCRIPTIONS
// ============================================================

export const broadcastRealtimeService = {
    /**
     * Subscribe to broadcasts in a channel
     */
    subscribeToChannel(
        channelId: string,
        onInsert: (broadcast: Broadcast) => void,
        onUpdate: (broadcast: Broadcast) => void,
        onDelete: (id: string) => void
    ) {
        return supabase
            .channel(`broadcasts:${channelId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'broadcasts',
                    filter: `channel_id=eq.${channelId}`,
                },
                (payload) => onInsert(toCamelCase(payload.new))
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'broadcasts',
                    filter: `channel_id=eq.${channelId}`,
                },
                (payload) => onUpdate(toCamelCase(payload.new))
            )
            .on(
                'postgres_changes',
                {
                    event: 'DELETE',
                    schema: 'public',
                    table: 'broadcasts',
                    filter: `channel_id=eq.${channelId}`,
                },
                (payload) => onDelete(payload.old.id)
            )
            .subscribe();
    },

    /**
     * Subscribe to acknowledgements for a broadcast
     */
    subscribeToAcknowledgements(
        broadcastId: string,
        onInsert: (ack: BroadcastAcknowledgement) => void
    ) {
        return supabase
            .channel(`acks:${broadcastId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'broadcast_acknowledgements',
                    filter: `broadcast_id=eq.${broadcastId}`,
                },
                (payload) => onInsert(toCamelCase(payload.new))
            )
            .subscribe();
    },

    /**
     * Subscribe to notifications for a user
     */
    subscribeToNotifications(
        employeeId: string,
        onInsert: (notification: BroadcastNotification) => void
    ) {
        return supabase
            .channel(`notifications:${employeeId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'broadcast_notifications',
                    filter: `employee_id=eq.${employeeId}`,
                },
                (payload) => onInsert(toCamelCase(payload.new))
            )
            .subscribe();
    },

    /**
     * Unsubscribe from a channel
     */
    /**
     * Unsubscribe from a channel
     */
    async unsubscribe(subscription: ReturnType<typeof supabase.channel>) {
        if (!subscription || subscription.state === 'closed') {
            return;
        }
        try {
            await supabase.removeChannel(subscription);
        } catch (error) {
            // Ignore error if channel is already closed or removed
            // console.warn('Error unsubscribing from broadcast channel:', error);
        }
    },
};

// ============================================================
// EXPORT ALL SERVICES
// ============================================================

export const broadcastServices = {
    groups: broadcastGroupService,
    channels: broadcastChannelService,
    broadcasts: broadcastService,
    attachments: broadcastAttachmentService,
    participants: groupParticipantService,
    notifications: broadcastNotificationService,
    realtime: broadcastRealtimeService,
};

export default broadcastServices;
