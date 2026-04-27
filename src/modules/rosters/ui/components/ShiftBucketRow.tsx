/**
 * ShiftBucketRow - Compact single-shift row inside a bucket.
 * Format: <Role>  <Start – End>  [Edit] [Delete] [Publish]
 */
import React from 'react';
import { Edit2, Trash2, Send, Lock, User, UserX, Undo2 } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { getShiftStatusIcons } from '../../domain/shift-ui';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';

export interface ShiftBucketRowProps {
    shiftId: string;
    role: string;
    startTime: string;
    endTime: string;
    employeeName?: string;
    isAssigned: boolean;
    isPublished: boolean;
    isDraft: boolean;
    isLocked: boolean;
    canEdit: boolean;
    onEdit: (shiftId: string) => void;
    onDelete: (shiftId: string) => void;
    onPublish: (shiftId: string) => void;
    onUnpublish: (shiftId: string) => void;
    rawShift?: any;
    showStatusIcons?: boolean;
}

function formatTime(time: string): string {
    // "14:00:00" -> "14:00"
    return time.substring(0, 5);
}

export const ShiftBucketRow: React.FC<ShiftBucketRowProps> = ({
    shiftId,
    role,
    startTime,
    endTime,
    employeeName,
    isAssigned,
    isPublished,
    isDraft,
    isLocked,
    canEdit,
    onEdit,
    onDelete,
    onPublish,
    onUnpublish,
    rawShift,
    showStatusIcons = true, // Default to true in Roster views
}) => {
    const disabled = isLocked || !canEdit;
    
    const statusIcons = React.useMemo(() => 
        (showStatusIcons && rawShift) ? getShiftStatusIcons(rawShift) : [], 
    [rawShift, showStatusIcons]);

    return (
        <div
            className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors group',
                'hover:bg-accent/20',
                isLocked && 'opacity-30'
            )}
        >
            {/* Assignment indicator */}
            <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                {isAssigned ? (
                    <User className="h-3 w-3 text-emerald-400" />
                ) : (
                    <UserX className="h-3 w-3 text-amber-400" />
                )}
            </div>

            {/* Role */}
            <span className="text-[11px] font-medium text-foreground truncate min-w-0 flex-shrink-0 max-w-[100px]" title={role}>
                {role}
            </span>

            {/* Employee name (if assigned) */}
            {employeeName && (
                <span className="text-[11px] text-muted-foreground truncate min-w-0 flex-shrink max-w-[90px]" title={employeeName}>
                    {employeeName}
                </span>
            )}

            {/* Time range */}
            <span className="text-[10px] text-muted-foreground/70 flex-shrink-0 ml-auto whitespace-nowrap">
                {formatTime(startTime)} – {formatTime(endTime)}
            </span>

            {/* Status badge */}
            {isPublished && (
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0 ml-1" title="Published" />
            )}
            {isDraft && !isPublished && (
                <div className="w-1.5 h-1.5 rounded-full bg-gray-500 flex-shrink-0 ml-1" title="Draft" />
            )}

            {/* Lock icon */}
            {isLocked && (
                <Lock className="h-3 w-3 text-amber-500 flex-shrink-0 ml-0.5" />
            )}

            {/* Status Icons (Roster Planner) */}
            {showStatusIcons && statusIcons.length > 0 && (
                <div className="flex items-center gap-1 ml-1 shrink-0">
                    {statusIcons.map((si, i) => (
                        <Tooltip key={i}>
                            <TooltipTrigger asChild>
                                <si.icon className={cn("h-3 w-3", si.color)} />
                            </TooltipTrigger>
                            <TooltipContent className="text-[10px] py-1 px-2">{si.tooltip}</TooltipContent>
                        </Tooltip>
                    ))}
                </div>
            )}

            {/* Action buttons - visible on hover */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 -mr-1">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 hover:bg-primary/10"
                    onClick={() => onEdit(shiftId)}
                    disabled={disabled}
                    title="Edit shift"
                >
                    <Edit2 className="h-3 w-3" />
                </Button>
                {isDraft && !isPublished && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 hover:bg-emerald-500/10"
                        onClick={() => onPublish(shiftId)}
                        disabled={disabled}
                        title="Publish shift"
                    >
                        <Send className="h-3 w-3" />
                    </Button>
                )}
                {isPublished && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 hover:bg-amber-500/10 hover:text-amber-400"
                        onClick={() => onUnpublish(shiftId)}
                        disabled={disabled}
                        title="Unpublish shift"
                    >
                        <Undo2 className="h-3 w-3" />
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 hover:bg-destructive/10"
                    onClick={() => onDelete(shiftId)}
                    disabled={disabled}
                    title="Delete shift"
                >
                    <Trash2 className="h-3 w-3" />
                </Button>
            </div>
        </div>
    );
};

export default ShiftBucketRow;
