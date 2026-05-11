/**
 * ShiftBucketHeader - Sticky header row for a shift bucket.
 * Shows time range, shift count, assignment summary, publish status, and actions.
 * Refined for compact display in narrow columns.
 */
import React from 'react';
import {
    ChevronDown,
    ChevronRight,
    Send,
    Trash2,
    Lock,
    Clock,
    Box,
    UserCheck,
    UserX,
    Undo2
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { type BucketStats, getBucketPublishStatus } from '@/modules/rosters/utils/bucket.utils';

export interface ShiftBucketHeaderProps {
    startTime: string;
    endTime: string;
    stats: BucketStats;
    isExpanded: boolean;
    canEdit: boolean;
    onToggle: () => void;
    onPublishBucket: () => void;
    onUnpublishBucket: () => void;
    onDeleteBucket: () => void;
}

function formatTime(time: string): string {
    return time.substring(0, 5);
}

export const ShiftBucketHeader: React.FC<ShiftBucketHeaderProps> = ({
    startTime,
    endTime,
    stats,
    isExpanded,
    canEdit,
    onToggle,
    onPublishBucket,
    onUnpublishBucket,
    onDeleteBucket,
}) => {
    const publishStatus = getBucketPublishStatus(stats);
    const hasLocked = stats.lockedCount > 0;
    const hasDrafts = stats.draftCount > 0;
    const hasPublished = stats.publishedCount > 0;

    const publishStatusStyle = {
        'Draft': 'text-muted-foreground',
        'Partially Published': 'text-amber-400',
        'Published': 'text-emerald-400',
    }[publishStatus];

    return (
        <div
            className={cn(
                'flex flex-col gap-3 px-5 py-4 rounded-xl cursor-pointer select-none border-2 transition-colors',
                'bg-card shadow-lg border-border hover:bg-accent/40 hover:border-primary/30',
                isExpanded && 'rounded-b-none border-b-0 border-primary/40 bg-accent/10 shadow-xl'
            )}
            onClick={onToggle}
        >
            {/* Row 1: Time & Actions */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {/* Expand/Collapse chevron */}
                    <div className="flex-shrink-0 text-muted-foreground/60">
                        {isExpanded ? (
                            <ChevronDown className="h-5 w-5" />
                        ) : (
                            <ChevronRight className="h-5 w-5" />
                        )}
                    </div>

                    {/* Time range */}
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-md bg-primary/10">
                            <Clock className="h-4.5 w-4.5 text-primary" />
                        </div>
                        <span className="text-lg font-black text-foreground tracking-tighter">
                            {formatTime(startTime)} - {formatTime(endTime)}
                        </span>
                    </div>
                </div>

                {/* Actions & Lock */}
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {hasLocked && (
                        <div className="flex items-center gap-1.5 text-amber-500 mr-3 px-2 py-1 bg-amber-500/5 rounded-md border border-amber-500/20" title={`${stats.lockedCount} locked shifts`}>
                            <Lock className="h-4 w-4" />
                            <span className="text-sm font-black">{stats.lockedCount}</span>
                        </div>
                    )}

                    {hasDrafts && (
                        <Button
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20"
                            onClick={onPublishBucket}
                            disabled={!canEdit}
                            title="Publish all draft shifts"
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    )}
                    
                    {hasPublished && (
                        <Button
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20"
                            onClick={onUnpublishBucket}
                            disabled={!canEdit}
                            title="Unpublish all published shifts"
                        >
                            <Undo2 className="h-4 w-4" />
                        </Button>
                    )}

                    <Button
                        variant="secondary"
                        size="icon"
                        className="h-8 w-8 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20"
                        onClick={onDeleteBucket}
                        disabled={!canEdit}
                        title="Delete all shifts"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Row 2: Stats & Status */}
            <div className="flex items-center gap-5 text-[11px] pl-8">
                {/* Total Count */}
                <div title="Total Shifts" className="flex items-center gap-2 text-muted-foreground font-black uppercase tracking-wider">
                    <Box className="h-4 w-4 opacity-60" />
                    <span>{stats.total} Total</span>
                </div>

                {/* Assigned Count */}
                <div title="Assigned" className="flex items-center gap-2 text-emerald-500 font-black uppercase tracking-wider">
                    <UserCheck className="h-4 w-4" />
                    <span>{stats.assignedCount} Filled</span>
                </div>

                {/* Unassigned Count (only if exists) */}
                {stats.unassignedCount > 0 && (
                    <div title="Unassigned" className="flex items-center gap-2 text-amber-500 font-black uppercase tracking-wider">
                        <UserX className="h-4 w-4" />
                        <span>{stats.unassignedCount} Open</span>
                    </div>
                )}

                {/* Status Text (Right aligned) */}
                <div className={cn("ml-auto font-black uppercase tracking-[0.2em] text-[10px] px-2 py-0.5 rounded bg-muted/30", publishStatusStyle)}>
                    {publishStatus === 'Partially Published' ? 'Partial' : publishStatus}
                </div>
            </div>
        </div>

    );
};

export default ShiftBucketHeader;
