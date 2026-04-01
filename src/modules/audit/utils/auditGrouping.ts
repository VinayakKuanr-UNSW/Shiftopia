import { AuditLogEntryWithActor, AuditAction } from '../types/audit.types';

export interface AuditLogGroup {
    id: string;
    action: AuditAction;
    entries: AuditLogEntryWithActor[];
    primaryEntry: AuditLogEntryWithActor;
}

const GROUPABLE_ACTIONS = new Set<AuditAction>([
    'BID_PLACED',
    'BID_REJECTED',
    'OFFER_EXPIRED',
    'OFFER_DECLINED'
]);

/**
 * Groups consecutive audit log entries of the same action.
 * This is primarily used to collapse noisy events like bulk bid rejections
 * or multiple bid placements into a single summary block in the timeline.
 */
export function groupAuditLogs(entries: AuditLogEntryWithActor[]): AuditLogGroup[] {
    if (!entries || entries.length === 0) return [];

    const groups: AuditLogGroup[] = [];
    let currentGroup: AuditLogEntryWithActor[] = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        
        if (currentGroup.length === 0) {
            currentGroup.push(entry);
            continue;
        }

        const prevEntry = currentGroup[currentGroup.length - 1];

        // Group consecutive events if they share the same action and are groupable
        if (entry.action === prevEntry.action && GROUPABLE_ACTIONS.has(entry.action)) {
            currentGroup.push(entry);
        } else {
            // Close current group and start a new one
            groups.push(createGroup(currentGroup));
            currentGroup = [entry];
        }
    }

    if (currentGroup.length > 0) {
        groups.push(createGroup(currentGroup));
    }

    return groups;
}

function createGroup(entries: AuditLogEntryWithActor[]): AuditLogGroup {
    // For BID_PLACED, we want the primary entry to be the *last* one so the timestamp
    // reflects the most recent bid. For BID_REJECTED, they all happen at the same time.
    const primary = entries[entries.length - 1];
    return {
        id: `group-${primary.action}-${primary.id}`,
        action: primary.action,
        entries: entries,
        primaryEntry: primary
    };
}
