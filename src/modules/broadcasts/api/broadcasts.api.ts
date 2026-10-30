// ============================================================
// BROADCASTS API — backwards-compatible re-export barrel
// Location: src/modules/broadcasts/api/broadcasts.api.ts
//
// This file intentionally re-exports everything from the three
// split modules so that all existing import paths continue to
// work without modification.
//
//   broadcasts.dto.ts     — transformation / normalisation helpers
//   broadcasts.queries.ts — read-only operations
//   broadcasts.commands.ts — mutation operations
// ============================================================

// ── DTO helpers ───────────────────────────────────────────────────────────────

// ── Read operations ───────────────────────────────────────────────────────────
export {
    broadcastGroupQueries,
    broadcastQueries,
    groupParticipantQueries,
    broadcastNotificationQueries,
} from './broadcasts.queries';

// ── Mutation operations ───────────────────────────────────────────────────────
export {
    broadcastGroupCommands,
    broadcastChannelCommands,
    broadcastCommands,
    groupParticipantCommands,
    broadcastNotificationCommands,
} from './broadcasts.commands';

// ── Legacy service aliases ────────────────────────────────────────────────────
// These composite objects merge queries + commands under the same names that
// existed before the split so that all callers (useBroadcasts.ts, etc.) work
// without any changes.

import { broadcastNotificationQueries } from './broadcasts.queries';
import { toCamelCase } from './broadcasts.dto';
import { supabase } from '@/platform/supabase/client';
import type {
    Broadcast,
    BroadcastNotification,
} from '../model/broadcast.types';







// ── Real-time subscriptions ───────────────────────────────────────────────────
// Kept inline here: realtime helpers are thin wrappers around supabase.channel()
// and do not belong in queries or commands.

export const broadcastRealtimeService = {
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
                // The INSERT row has no subject/author/group; hydrate it first.
                (payload) => {
                    broadcastNotificationQueries
                        .hydrate([payload.new as any])
                        .then(([notification]) => notification && onInsert(notification))
                        .catch((error) =>
                            console.error('[broadcasts] Failed to load new notification:', error)
                        );
                }
            )
            .subscribe();
    },

    async unsubscribe(subscription: ReturnType<typeof supabase.channel>) {
        if (!subscription || subscription.state === 'closed') {
            return;
        }
        try {
            await supabase.removeChannel(subscription);
        } catch (_error) {
            // Ignore — channel may already be closed
        }
    },
};

// ── Aggregate service object (original default export shape) ──────────────────


