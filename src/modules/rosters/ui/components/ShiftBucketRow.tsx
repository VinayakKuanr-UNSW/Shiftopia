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
} from '@/modules/core/ui/primitives/tooltip';export interface ShiftBucketRowProps {
    shiftId: string;
    role: string;
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
    accentColor?: string;
}

export const ShiftBucketRow: React.FC<ShiftBucketRowProps> = ({
    shiftId,
    role,
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
    accentColor,
}) => {
    const disabled = isLocked || !canEdit;
    
    const statusIcons = React.useMemo(() => 
        (showStatusIcons && rawShift) ? getShiftStatusIcons(rawShift) : [], 
    [rawShift, showStatusIcons]);

    return (
        <div
            className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md group transition-colors duration-150',
                'hover:bg-[var(--hover-bg,rgba(255,255,255,0.05))]',
                isLocked && 'opacity-30'
            )}
            style={{ 
                '--hover-bg': `${accentColor}15`,
            } as any}
        >
            {/* Assignment indicator */}
            <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                {isAssigned ? (
                    <User className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                    <UserX className="h-3.5 w-3.5 text-amber-400" />
                )}
            </div>

            {/* Role */}
            <span className="text-xs font-semibold text-foreground truncate min-w-0 flex-shrink-0 max-w-[120px]" title={role}>
                {role}
            </span>

            {/* Employee name (if assigned) */}
            {employeeName && (
                <span className="text-xs text-muted-foreground truncate min-w-0 flex-shrink max-w-[110px]" title={employeeName}>
                    {employeeName}
                </span>
            )}

            {/* Status badge */}
            {isPublished && (
                <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 ml-auto" title="Published" />
            )}
            {isDraft && !isPublished && (
                <div className="w-2 h-2 rounded-full bg-gray-500 flex-shrink-0 ml-auto" title="Draft" />
            )}

            {/* Lock icon */}
            {isLocked && (
                <Lock className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 ml-1" />
            )}

            {/* Status Icons (Roster Planner) */}
            {showStatusIcons && statusIcons.length > 0 && (
                <div className="flex items-center gap-1.5 ml-2 shrink-0">
                    {statusIcons.map((si, i) => (
                        <Tooltip key={i}>
                            <TooltipTrigger asChild>
                                <si.icon className={cn("h-3.5 w-3.5", si.color)} />
                            </TooltipTrigger>
                            <TooltipContent className="text-[10px] py-1 px-2">{si.tooltip}</TooltipContent>
                        </Tooltip>
                    ))}
                </div>
            )}

            {/* Action buttons - visible on hover */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 flex-shrink-0 -mr-1">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 hover:bg-primary/10"
                    onClick={() => onEdit(shiftId)}
                    disabled={disabled}
                    title="Edit shift"
                >
                    <Edit2 className="h-3.5 w-3.5" />
                </Button>
                {isDraft && !isPublished && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 hover:bg-emerald-500/10"
                        onClick={() => onPublish(shiftId)}
                        disabled={disabled}
                        title="Publish shift"
                    >
                        <Send className="h-3.5 w-3.5" />
                    </Button>
                )}
                {isPublished && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 hover:bg-amber-500/10 hover:text-amber-400"
                        onClick={() => onUnpublish(shiftId)}
                        disabled={disabled}
                        title="Unpublish shift"
                    >
                        <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 hover:bg-destructive/10"
                    onClick={() => onDelete(shiftId)}
                    disabled={disabled}
                    title="Delete shift"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
};

export default ShiftBucketRow;
;
