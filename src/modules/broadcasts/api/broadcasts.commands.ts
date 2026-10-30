// ============================================================
// BROADCASTS COMMANDS — all mutation operations
// Location: src/modules/broadcasts/api/broadcasts.commands.ts
// ============================================================

import { supabase } from '@/platform/supabase/client';
import { assertWrote, WriteRefusedError } from '@/platform/supabase/writes';
import type {
    BroadcastGroup,
    BroadcastChannel,
    BroadcastAttachment,
    GroupParticipant,
    CreateBroadcastGroupRequest,
    UpdateBroadcastGroupRequest,
    CreateBroadcastChannelRequest,
    CreateBroadcastRequest,
    AddParticipantRequest,
    Broadcast,
} from '../model/broadcast.types';
import { toCamelCase, toSnakeCase, getFileTypeFromName } from './broadcasts.dto';

// ── Broadcast Groups ──────────────────────────────────────────────────────────

export const broadcastGroupCommands = {
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
                name:               data.name,
                description:        data.description,
                icon:               data.icon  || 'megaphone',
                color:              data.color || 'blue',
                created_by:         createdBy,
                department_id:      data.departmentId,
                sub_department_id:  data.subDepartmentId,
                organization_id:    data.organizationId,
            })
            .select()
            .single();

        if (error) throw error;

        // Add creator as admin
        await supabase.from('group_participants').insert({
            group_id:    group.id,
            employee_id: createdBy,
            role:        'admin',
        });

        // Create default 'General' channel
        const { data: channel, error: channelError } = await supabase
            .from('broadcast_channels')
            .insert({
                group_id:    group.id,
                name:        'General',
                description: 'General discussion',
                is_active:   true,
            })
            .select()
            .single();

        if (channelError) throw channelError;

        return toCamelCase({
            ...group,
            channels:             [channel],
            participantCount:     1,
            activeBroadcastCount: 0,
            channelCount:         1,
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

        // PGRST116 = no row came back: row-level security refused the update.
        if (error?.code === 'PGRST116') throw new WriteRefusedError('change this group');
        if (error) throw error;
        return toCamelCase(group);
    },

    /**
     * Delete group (soft delete)
     */
    async delete(groupId: string): Promise<void> {
        const result = await supabase
            .from('broadcast_groups')
            .update({ is_active: false }, { count: 'exact' })
            .eq('id', groupId);

        if (result.error) throw result.error;
        assertWrote(result, 'archive this group');
    },
};

// ── Broadcast Channels ────────────────────────────────────────────────────────

export const broadcastChannelCommands = {
    /**
     * Create channel
     */
    async create(data: CreateBroadcastChannelRequest): Promise<BroadcastChannel> {
        const { data: channel, error } = await supabase
            .from('broadcast_channels')
            .insert({
                group_id:    data.groupId,
                name:        data.name,
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
        const result = await supabase
            .from('broadcast_channels')
            .update({ is_active: false }, { count: 'exact' })
            .eq('id', channelId);

        if (result.error) throw result.error;
        assertWrote(result, 'archive this channel');
    },
};

// ── Broadcasts ────────────────────────────────────────────────────────────────

export const broadcastCommands = {
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
                channel_id:              broadcastData.channelId,
                author_id:               authorId,
                created_by:              authorId, // satisfies DB constraint
                subject:                 broadcastData.subject,
                title:                   broadcastData.subject, // satisfies DB constraint
                content:                 broadcastData.content,
                priority:                broadcastData.priority,
                is_pinned:               broadcastData.isPinned               || false,
                requires_acknowledgement: broadcastData.requiresAcknowledgement || false,
            })
            .select()
            .single();

        if (error) throw error;

        // Upload attachments sequentially (storage writes must be ordered)
        if (attachments && attachments.length > 0) {
            for (const attachment of attachments) {
                await broadcastAttachmentCommands.create(broadcast.id, attachment.file);
            }
        }

        return toCamelCase(broadcast);
    },

    /**
     * Delete broadcast
     */
    async delete(broadcastId: string): Promise<void> {
        const result = await supabase
            .from('broadcasts')
            .delete({ count: 'exact' })
            .eq('id', broadcastId);

        if (result.error) throw result.error;
        assertWrote(result, 'delete this broadcast');
    },

    /**
     * Pin / Unpin broadcast
     */
    async togglePin(broadcastId: string, isPinned: boolean): Promise<void> {
        const result = await supabase
            .from('broadcasts')
            .update({ is_pinned: isPinned }, { count: 'exact' })
            .eq('id', broadcastId);

        if (result.error) throw result.error;
        assertWrote(result, 'pin or unpin this broadcast');
    },
};

// ── Broadcast Attachments ─────────────────────────────────────────────────────

const broadcastAttachmentCommands = {
    /**
     * Upload and create attachment
     */
    async create(broadcastId: string, file: File): Promise<BroadcastAttachment> {
        const fileExt  = file.name.split('.').pop();
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
                broadcast_id:  broadcastId,
                file_name:     file.name,
                file_type:     getFileTypeFromName(file.name),
                file_size:     file.size,
                file_url:      publicUrl,
                storage_path:  uploadData.path,
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

        const result = await supabase
            .from('broadcast_attachments')
            .delete({ count: 'exact' })
            .eq('id', attachmentId);

        if (result.error) throw result.error;
        assertWrote(result, 'delete this attachment');
    },
};

// ── Group Participants ────────────────────────────────────────────────────────

export const groupParticipantCommands = {
    /**
     * Add participant to group
     */
    async add(data: AddParticipantRequest): Promise<GroupParticipant> {
        const { data: participant, error } = await supabase
            .from('group_participants')
            .insert({
                group_id:    data.groupId,
                employee_id: data.employeeId,
                role:        data.role || 'member',
            })
            .select()
            .single();

        if (error) throw error;
        return toCamelCase(participant);
    },

    /**
     * Remove participant from group
     */
    async remove(groupId: string, employeeId: string): Promise<void> {
        const result = await supabase
            .from('group_participants')
            .delete({ count: 'exact' })
            .eq('group_id', groupId)
            .eq('employee_id', employeeId);

        if (result.error) throw result.error;
        assertWrote(result, 'remove this member');
    },
};

// ── Broadcast Notifications ───────────────────────────────────────────────────

export const broadcastNotificationCommands = {
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
