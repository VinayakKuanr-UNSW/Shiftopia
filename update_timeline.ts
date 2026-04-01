import * as fs from 'fs';

let content = fs.readFileSync('src/modules/audit/components/ShiftTimeline.tsx', 'utf-8');

// 1. Update imports
content = content.replace(
    /import React from 'react';[\s\S]*?import { Badge } from '@\/modules\/core\/ui\/primitives\/badge';/,
`import React, { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
    Plus, UserPlus, UserMinus, Send, EyeOff, Trash2, XCircle, Pencil,
    CheckCircle, Clock, Lock, Gavel, Trophy, Undo2, TimerOff, Zap,
    ArrowLeftRight, CheckCircle2, PlayCircle, LogIn, LogOut, UserX,
    Timer, ShieldCheck, X, Handshake, ChevronDown, ChevronRight
} from 'lucide-react';
import { AuditLogEntryWithActor, AUDIT_ACTION_META, AuditAction } from '../types/audit.types';
import { useShiftTimeline } from '../hooks/useAuditLog';
import { AuditLogGroup, groupAuditLogs } from '../utils/auditGrouping';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Label } from '@/modules/core/ui/primitives/label';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Plus, UserPlus, UserMinus, Send, EyeOff, Trash2, XCircle, Pencil,
    CheckCircle, Clock, Lock, Gavel, Trophy, Undo2, TimerOff, Zap,
    ArrowLeftRight, CheckCircle2, PlayCircle, LogIn, LogOut, UserX,
    Timer, ShieldCheck, X, Handshake, ChevronDown, ChevronRight
};`
);

// Remove the old ICON_MAP definition since we included it above
content = content.replace(/const ICON_MAP[\s\S]*?};\n/, '');

// 2. TimelineEvent Styling
content = content.replace(
    /const IconComp = ICON_MAP\[meta.icon\] \?\? Clock;\n    const actorName = entry.actor\?.full_name \?\? entry.actor_role \?\? 'System';\n    const isSystem  = !entry.actor_id \|\| entry.actor_role === 'system';\n\n    return \(\n        <div className="flex gap-3">/,
`const fallbackMeta = { label: entry.action, icon: 'Clock', color: 'bg-gray-500/20 text-gray-400', category: 'system', priority: 'low', is_system: true };
    const IconComp = ICON_MAP[meta?.icon || fallbackMeta.icon] ?? Clock;
    const actorName = entry.actor?.full_name ?? entry.actor_role ?? 'System';
    const isSystem  = !entry.actor_id || entry.actor_role === 'system';

    const isHighPriority = meta?.priority === 'high';
    const isLowPriority = meta?.priority === 'low' || isSystem;

    return (
        <div className={\`flex gap-3 \${isLowPriority ? 'opacity-85 grayscale-[30%]' : ''}\`}>`
);

content = content.replace(
    /<span className="font-medium text-sm text-foreground">/,
    `<span className={\`text-sm \${isHighPriority ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'}\`}>`
);

// 3. Add GroupedTimelineEvent before main component
const groupComponent = `

// ── Group Component ───────────────────────────────────────────────────────────

interface GroupedTimelineEventProps {
    group: AuditLogGroup;
    isLast: boolean;
}

const GroupedTimelineEvent: React.FC<GroupedTimelineEventProps> = ({ group, isLast }) => {
    const meta = AUDIT_ACTION_META[group.action as AuditAction];
    const fallbackMeta = { label: group.action, icon: 'Clock', color: 'bg-gray-500/20 text-gray-400', category: 'system', priority: 'low', is_system: true };
    const IconComp = ICON_MAP[meta?.icon || fallbackMeta.icon] ?? Clock;
    const [expanded, setExpanded] = useState(false);

    const isHighPriority = meta?.priority === 'high';
    const isLowPriority = meta?.priority === 'low';

    return (
        <div className={\`flex gap-3 \${isLowPriority ? 'opacity-85 grayscale-[30%]' : ''}\`}>
            {/* Connector line + icon */}
            <div className="flex flex-col items-center">
                <div className={\`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center \${meta?.color || fallbackMeta.color}\`}>
                    <IconComp className="w-4 h-4" />
                </div>
                {!isLast && <div className="w-px flex-1 bg-border dark:bg-white/10 mt-1" />}
            </div>

            {/* Content */}
            <div className="pb-6 flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <span className={\`text-sm \${isHighPriority ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'}\`}>
                            {group.entries.length} {meta?.label ? meta.label.toLowerCase() + 's' : 'events'}
                        </span>
                        {meta?.priority === 'low' && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                                Auto
                            </span>
                        )}
                    </div>
                    <time
                        className="flex-shrink-0 text-xs text-muted-foreground"
                        title={format(new Date(group.primaryEntry.occurred_at), 'PPpp')}
                    >
                        {formatDistanceToNow(new Date(group.primaryEntry.occurred_at), { addSuffix: true })}
                    </time>
                </div>

                <button
                    onClick={() => setExpanded(!expanded)}
                    className="flex items-center gap-1 mt-1.5 text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors"
                >
                    {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {expanded ? 'Hide details' : 'View details'}
                </button>

                {expanded && (
                    <div className="mt-3 space-y-2 border-l-2 border-border/50 dark:border-white/5 pl-3 ml-1.5">
                        {group.entries.map((entry) => {
                            const actorName = entry.actor?.full_name ?? entry.actor_role ?? 'System';
                            return (
                                <div key={entry.id} className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1 h-1 rounded-full bg-border" />
                                        <span className="text-muted-foreground">
                                            {actorName}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground/60 w-20 text-right">
                                        {formatDistanceToNow(new Date(entry.occurred_at), { addSuffix: true })}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
`;

content = content.replace(
    /\/\/ ── Main component ────────────────────────────────────────────────────────────/,
    groupComponent + '\n// ── Main component ────────────────────────────────────────────────────────────'
);

// 4. Update ShiftTimeline
content = content.replace(
    /export const ShiftTimeline: React\.FC<ShiftTimelineProps> = \({ shiftId, className = '' }\) => {[\s\S]*?    if \(isLoading\) {/,
`export const ShiftTimeline: React.FC<ShiftTimelineProps> = ({ shiftId, className = '' }) => {
    const { data: entries, isLoading, error } = useShiftTimeline(shiftId);
    const [showSystemEvents, setShowSystemEvents] = useState(false);

    const groups = useMemo(() => groupAuditLogs(entries || []), [entries]);

    const filteredGroups = useMemo(() => {
        return groups.filter(g => {
            if (showSystemEvents) return true;
            const meta = AUDIT_ACTION_META[g.action as AuditAction];
            return !meta?.is_system;
        });
    }, [groups, showSystemEvents]);

    if (isLoading) {`
);

content = content.replace(
    /return \([\s\S]*?<div className={`pt-2 \${className}`}>\n[\s\S]*?\{entries\.map\(\(entry, idx\) => \(\n[\s\S]*?<TimelineEvent\n[\s\S]*?key=\{entry\.id\}\n[\s\S]*?entry=\{entry\}\n[\s\S]*?isLast=\{idx === entries\.length - 1\}\n[\s\S]*?\/>\n[\s\S]*?\)\)}\n[\s\S]*?<\/div>\n[\s\S]*?\);/,
`return (
        <div className={\`flex flex-col \${className}\`}>
            {/* Toolbar */}
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-border/50 sticky top-0 bg-background/95 backdrop-blur z-10 pt-2 -mt-2">
                <p className="text-xs font-medium text-muted-foreground">History</p>
                <div className="flex items-center gap-2">
                    <Label htmlFor="show-system" className="text-[11px] text-muted-foreground cursor-pointer">
                        Show system events
                    </Label>
                    <Switch
                        id="show-system"
                        checked={showSystemEvents}
                        onCheckedChange={setShowSystemEvents}
                        className="scale-75 origin-right"
                    />
                </div>
            </div>

            {/* Timeline */}
            <div className="pt-2">
                {filteredGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        No events visible. 
                        {!showSystemEvents && <button onClick={() => setShowSystemEvents(true)} className="text-blue-500 hover:underline ml-1">Show hidden</button>}
                    </p>
                ) : (
                    filteredGroups.map((group, idx) => {
                        const isLast = idx === filteredGroups.length - 1;
                        if (group.entries.length === 1) {
                            return (
                                <TimelineEvent
                                    key={group.id}
                                    entry={group.primaryEntry}
                                    isLast={isLast}
                                />
                            );
                        }
                        return (
                            <GroupedTimelineEvent
                                key={group.id}
                                group={group}
                                isLast={isLast}
                            />
                        );
                    })
                )}
            </div>
        </div>
    );`
);

fs.writeFileSync('src/modules/audit/components/ShiftTimeline.tsx', content);
