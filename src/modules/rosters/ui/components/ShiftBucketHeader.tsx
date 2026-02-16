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
    UserX
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
    onDeleteBucket,
}) => {
    const publishStatus = getBucketPublishStatus(stats);
    const hasLocked = stats.lockedCount > 0;
    const hasDrafts = stats.draftCount > 0;

    const publishStatusStyle = {
        'Draft': 'text-gray-400',
        'Partially Published': 'text-amber-400',
        'Published': 'text-emerald-400',
    }[publishStatus];

    return (
        <div
            className={cn(
                'flex flex-col gap-1.5 px-3 py-2 rounded-lg cursor-pointer select-none transition-colors border',
                'bg-[#1a2034]/80 hover:bg-[#1f283d] border-white/[0.08]',
                isExpanded && 'rounded-b-none border-b-0'
            )}
            onClick={onToggle}
        >
            {/* Row 1: Time & Actions */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {/* Expand/Collapse chevron */}
                    <div className="flex-shrink-0 text-muted-foreground/70">
                        {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                        )}
                    </div>

                    {/* Time range */}
                    <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-muted-foreground/60" />
                        <span className="text-xs font-semibold text-foreground tracking-tight">
                            {formatTime(startTime)} - {formatTime(endTime)}
                        </span>
                    </div>
                </div>

                {/* Actions & Lock */}
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {hasLocked && (
                        <div className="flex items-center gap-0.5 text-amber-500 mr-1" title={`${stats.lockedCount} locked shifts`}>
                            <Lock className="h-3 w-3" />
                            <span className="text-[10px] font-medium">{stats.lockedCount}</span>
                        </div>
                    )}

                    {hasDrafts && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 hover:bg-emerald-500/20 text-emerald-400/70 hover:text-emerald-400"
                            onClick={onPublishBucket}
                            disabled={!canEdit}
                            title="Publish all draft shifts"
                        >
                            <Send className="h-3 w-3" />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 hover:bg-red-500/20 text-red-400/70 hover:text-red-400"
                        onClick={onDeleteBucket}
                        disabled={!canEdit}
                        title="Delete all shifts"
                    >
                        <Trash2 className="h-3 w-3" />
                    </Button>
                </div>
            </div>

            {/* Row 2: Stats & Status */}
            <div className="flex items-center gap-3 text-[10px] pl-5.5">
                {/* Total Count */}
                <div title="Total Shifts" className="flex items-center gap-1 text-muted-foreground/80 font-medium">
                    <Box className="h-3 w-3 opacity-70" />
                    <span>{stats.total}</span>
                </div>

                {/* Assigned Count */}
                <div title="Assigned" className="flex items-center gap-1 text-emerald-400/90 font-medium">
                    <UserCheck className="h-3 w-3 opacity-80" />
                    <span>{stats.assignedCount}</span>
                </div>

                {/* Unassigned Count (only if exists) */}
                {stats.unassignedCount > 0 && (
                    <div title="Unassigned" className="flex items-center gap-1 text-amber-400/90 font-medium">
                        <UserX className="h-3 w-3 opacity-80" />
                        <span>{stats.unassignedCount}</span>
                    </div>
                )}

                {/* Status Text (Right aligned) */}
                <div className={cn("ml-auto font-medium", publishStatusStyle)}>
                    {publishStatus === 'Partially Published' ? 'Partial' : publishStatus}
                </div>
            </div>
        </div>
    );
};

export default ShiftBucketHeader;
