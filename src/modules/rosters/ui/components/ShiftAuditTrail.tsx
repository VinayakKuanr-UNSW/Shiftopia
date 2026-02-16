/**
 * ShiftAuditTrail Component
 * 
 * Displays a timeline of all audit events for a shift with:
 * - Diff badges for field changes
 * - System actor indicators
 * - Batch grouping for bulk operations
 * - "Include Archived" checkbox for compliance
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
    Plus,
    Edit,
    Gavel,
    RefreshCw,
    User,
    Clock,
    Activity,
    Bot,
    ChevronDown,
    ChevronRight,
    Archive,
    ArrowRight,
    Loader2,
    AlertTriangle,
    Calendar,
    Users,
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { cn } from '@/modules/core/lib/utils';
import {
    getShiftAuditEvents,
    formatFieldName,
    formatEventType,
    getCategoryColor,
    isSystemActor,
    type ShiftAuditEvent,
} from '@/modules/rosters/api/audit.api';
import { format, formatDistanceToNow } from 'date-fns';

interface ShiftAuditTrailProps {
    shiftId: string;
    className?: string;
}

// Icon mapping for categories
const CategoryIcons: Record<string, React.ElementType> = {
    creation: Plus,
    modification: Edit,
    bidding: Gavel,
    status: RefreshCw,
    assignment: User,
    attendance: Clock,
};

// Color mapping for categories
const CategoryColors: Record<string, string> = {
    creation: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    modification: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    bidding: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    status: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    assignment: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    attendance: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

// Timeline dot colors
const DotColors: Record<string, string> = {
    creation: 'bg-emerald-500',
    modification: 'bg-blue-500',
    bidding: 'bg-purple-500',
    status: 'bg-amber-500',
    assignment: 'bg-cyan-500',
    attendance: 'bg-orange-500',
};

export const ShiftAuditTrail: React.FC<ShiftAuditTrailProps> = ({ shiftId, className }) => {
    const [events, setEvents] = useState<ShiftAuditEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [includeArchived, setIncludeArchived] = useState(false);
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

    // Fetch audit events
    useEffect(() => {
        const fetchEvents = async () => {
            if (!shiftId) return;

            // Skip for template shifts with temporary IDs (non-UUIDs)
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shiftId);
            if (!isUuid) {
                setEvents([]);
                setIsLoading(false);
                setError(null);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const data = await getShiftAuditEvents({
                    shiftId,
                    includeArchived,
                    categoryFilter: categoryFilter === 'all' ? undefined : categoryFilter,
                });
                setEvents(data);
            } catch (err: any) {
                console.error('[ShiftAuditTrail] Error:', err);
                setError(err.message || 'Failed to load audit trail');
            } finally {
                setIsLoading(false);
            }
        };

        fetchEvents();
    }, [shiftId, includeArchived, categoryFilter]);

    // Group events by batch
    const groupedEvents = useMemo(() => {
        const batchMap = new Map<string, ShiftAuditEvent[]>();
        const result: Array<ShiftAuditEvent | { isBatch: true; batch_id: string; events: ShiftAuditEvent[] }> = [];

        events.forEach(event => {
            if (event.batch_id) {
                if (!batchMap.has(event.batch_id)) {
                    batchMap.set(event.batch_id, []);
                }
                batchMap.get(event.batch_id)!.push(event);
            } else {
                result.push(event);
            }
        });

        // Add batch groups
        batchMap.forEach((batchEvents, batchId) => {
            result.push({
                isBatch: true,
                batch_id: batchId,
                events: batchEvents,
            });
        });

        // Sort by date
        return result.sort((a, b) => {
            const dateA = 'isBatch' in a ? a.events[0].created_at : a.created_at;
            const dateB = 'isBatch' in b ? b.events[0].created_at : b.created_at;
            return new Date(dateB).getTime() - new Date(dateA).getTime();
        });
    }, [events]);

    const toggleBatch = (batchId: string) => {
        setExpandedBatches(prev => {
            const next = new Set(prev);
            if (next.has(batchId)) {
                next.delete(batchId);
            } else {
                next.add(batchId);
            }
            return next;
        });
    };

    // Render a diff badge for field changes
    const renderDiffBadge = (event: ShiftAuditEvent) => {
        if (!event.field_changed || !event.old_value || !event.new_value) return null;

        return (
            <div className="flex items-center gap-2 mt-2 text-sm">
                <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 font-mono text-xs">
                    {event.old_value}
                </Badge>
                <ArrowRight className="h-3 w-3 text-white/40" />
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-mono text-xs">
                    {event.new_value}
                </Badge>
            </div>
        );
    };

    // Render a single event
    const renderEvent = (event: ShiftAuditEvent, isNested = false) => {
        const IconComponent = CategoryIcons[event.event_category] || Activity;
        const colorClass = CategoryColors[event.event_category] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
        const dotColor = DotColors[event.event_category] || 'bg-gray-500';
        const isSystem = isSystemActor(event.performed_by_role);

        return (
            <div
                key={event.id}
                className={cn(
                    'relative flex gap-4',
                    isNested && 'ml-6 opacity-80'
                )}
            >
                {/* Timeline dot and line */}
                <div className="flex flex-col items-center">
                    <div className={cn(
                        'w-3 h-3 rounded-full ring-4 ring-[#0d1424]',
                        dotColor
                    )} />
                    <div className="w-0.5 flex-1 bg-white/10 -mt-0.5" />
                </div>

                {/* Event content */}
                <div className="flex-1 pb-6">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={cn('flex items-center gap-1.5', colorClass)}>
                                <IconComponent className="h-3 w-3" />
                                {formatEventType(event.event_type)}
                            </Badge>

                            {event.field_changed && (
                                <span className="text-sm text-white/60">
                                    {formatFieldName(event.field_changed)}
                                </span>
                            )}

                            {isSystem && (
                                <Badge variant="outline" className="bg-gray-500/20 text-gray-400 border-gray-500/30 flex items-center gap-1">
                                    <Bot className="h-3 w-3" />
                                    Automated
                                </Badge>
                            )}
                        </div>

                        <span className="text-xs text-white/40 whitespace-nowrap">
                            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                        </span>
                    </div>

                    {/* Diff badge for field changes */}
                    {renderDiffBadge(event)}

                    {/* Performer info */}
                    <div className="mt-2 text-sm text-white/50 flex items-center gap-1.5">
                        {isSystem ? (
                            <Bot className="h-3.5 w-3.5" />
                        ) : (
                            <User className="h-3.5 w-3.5" />
                        )}
                        <span>{event.performed_by_name}</span>
                        <span className="text-white/30">•</span>
                        <span className="text-white/40 text-xs">
                            {format(new Date(event.created_at), 'MMM d, yyyy h:mm a')}
                        </span>
                    </div>

                    {/* Metadata for bidding events */}
                    {event.metadata && event.event_category === 'bidding' && (
                        <div className="mt-2 p-2 rounded bg-white/5 text-xs text-white/60">
                            {event.metadata.employee_name && (
                                <div>Employee: {event.metadata.employee_name}</div>
                            )}
                            {event.metadata.bid_notes && (
                                <div className="mt-1 italic">"{event.metadata.bid_notes}"</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Render a batch group
    const renderBatchGroup = (batch: { isBatch: true; batch_id: string; events: ShiftAuditEvent[] }) => {
        const isExpanded = expandedBatches.has(batch.batch_id);
        const firstEvent = batch.events[0];
        const dotColor = DotColors[firstEvent.event_category] || 'bg-gray-500';

        return (
            <div key={batch.batch_id} className="relative">
                {/* Batch header */}
                <div className="relative flex gap-4">
                    <div className="flex flex-col items-center">
                        <div className={cn(
                            'w-3 h-3 rounded-full ring-4 ring-[#0d1424]',
                            dotColor
                        )} />
                        <div className="w-0.5 flex-1 bg-white/10 -mt-0.5" />
                    </div>

                    <div className="flex-1 pb-4">
                        <button
                            onClick={() => toggleBatch(batch.batch_id)}
                            className="flex items-center gap-2 text-left w-full group"
                        >
                            {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-white/60" />
                            ) : (
                                <ChevronRight className="h-4 w-4 text-white/60" />
                            )}

                            <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/30 flex items-center gap-1.5">
                                <Users className="h-3 w-3" />
                                Bulk Update ({batch.events.length} changes)
                            </Badge>

                            <span className="text-xs text-white/40">
                                {formatDistanceToNow(new Date(firstEvent.created_at), { addSuffix: true })}
                            </span>
                        </button>

                        <div className="mt-2 text-sm text-white/50 flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5" />
                            <span>{firstEvent.performed_by_name}</span>
                        </div>
                    </div>
                </div>

                {/* Expanded batch events */}
                {isExpanded && (
                    <div className="ml-6 border-l border-white/10 pl-4">
                        {batch.events.map(event => renderEvent(event, true))}
                    </div>
                )}
            </div>
        );
    };

    // Loading state
    if (isLoading) {
        return (
            <div className={cn('flex items-center justify-center py-12', className)}>
                <Loader2 className="h-6 w-6 animate-spin text-white/40" />
                <span className="ml-2 text-white/40">Loading audit trail...</span>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className={cn('flex items-center justify-center py-12 text-red-400', className)}>
                <AlertTriangle className="h-5 w-5 mr-2" />
                <span>{error}</span>
            </div>
        );
    }

    return (
        <div className={cn('flex flex-col h-full', className)}>
            {/* Filters */}
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div className="flex items-center gap-4">
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="w-[180px] bg-white/5 border-white/10 text-white">
                            <SelectValue placeholder="Filter by category" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a2744] border-white/10">
                            <SelectItem value="all" className="text-white">All Categories</SelectItem>
                            <SelectItem value="creation" className="text-white">Creation</SelectItem>
                            <SelectItem value="modification" className="text-white">Modifications</SelectItem>
                            <SelectItem value="bidding" className="text-white">Bidding</SelectItem>
                            <SelectItem value="status" className="text-white">Status Changes</SelectItem>
                            <SelectItem value="assignment" className="text-white">Assignments</SelectItem>
                            <SelectItem value="attendance" className="text-white">Attendance</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-2">
                    <Checkbox
                        id="include-archived"
                        checked={includeArchived}
                        onCheckedChange={(checked) => setIncludeArchived(!!checked)}
                        className="border-white/30"
                    />
                    <label
                        htmlFor="include-archived"
                        className="text-sm text-white/60 cursor-pointer flex items-center gap-1.5"
                    >
                        <Archive className="h-3.5 w-3.5" />
                        Include Archived
                    </label>
                </div>
            </div>

            {/* Timeline */}
            <ScrollArea className="flex-1 pt-4">
                {groupedEvents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-white/40">
                        <Calendar className="h-8 w-8 mb-2" />
                        <span>No audit events found</span>
                    </div>
                ) : (
                    <div className="space-y-0">
                        {groupedEvents.map(item =>
                            'isBatch' in item
                                ? renderBatchGroup(item as { isBatch: true; batch_id: string; events: ShiftAuditEvent[] })
                                : renderEvent(item as ShiftAuditEvent)
                        )}
                    </div>
                )}
            </ScrollArea>

            {/* Summary footer */}
            <div className="pt-4 border-t border-white/10 text-xs text-white/40">
                {events.length} event{events.length !== 1 ? 's' : ''} recorded
                {includeArchived && ' (including archived)'}
            </div>
        </div>
    );
};

export default ShiftAuditTrail;
