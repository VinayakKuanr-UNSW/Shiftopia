import { describe, expect, it, vi } from 'vitest';

// Rows exactly as the live tables return them: broadcast_notifications has no
// priority/subject/author columns, those live on the parent broadcast.
const tables: Record<string, unknown[]> = {
    broadcast_notifications: [
        { id: 'n1', broadcast_id: 'b1', employee_id: 'e1', is_read: false, read_at: null, created_at: '2026-10-27T00:00:00Z' },
        { id: 'n2', broadcast_id: 'gone', employee_id: 'e1', is_read: true, read_at: null, created_at: '2026-10-26T00:00:00Z' },
    ],
    broadcasts: [
        {
            id: 'b1',
            subject: 'Roster change',
            priority: 'high',
            channel_id: 'c1',
            profiles: { id: 'a1', first_name: 'Ada', last_name: 'Lee', email: 'ada@example.com' },
            broadcast_channels: { group_id: 'g1', broadcast_groups: { name: 'Front of House' } },
        },
    ],
};

vi.mock('@/platform/supabase/client', () => ({
    supabase: {
        from: (table: string) => {
            const result = { data: tables[table] ?? [], error: null };
            const builder: Record<string, unknown> = {
                then: (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve),
            };
            for (const method of ['select', 'eq', 'order', 'limit', 'in']) {
                builder[method] = () => builder;
            }
            return builder;
        },
    },
}));

import { broadcastNotificationQueries } from '../broadcasts.queries';

describe('broadcastNotificationQueries.getForUser', () => {
    it('fills subject, priority, author and group from the parent broadcast', async () => {
        const [notification, ...rest] = await broadcastNotificationQueries.getForUser('e1');

        expect(notification).toEqual({
            id: 'n1',
            broadcastId: 'b1',
            channelId: 'c1',
            groupId: 'g1',
            groupName: 'Front of House',
            subject: 'Roster change',
            authorName: 'Ada Lee',
            priority: 'high',
            createdAt: '2026-10-27T00:00:00Z',
            isRead: false,
        });
        // n2's broadcast no longer exists, so there is nothing to show for it.
        expect(rest).toEqual([]);
    });
});
