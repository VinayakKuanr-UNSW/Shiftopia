// src/modules/templates/ui/components/editor/TemplateShiftRow.tsx
// A compact row component for displaying/editing a shift in the template editor

import React from 'react';
import { Clock, Edit2, Trash2, User } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { TemplateShift } from '../../../model/templates.types';

interface TemplateShiftRowProps {
    shift: TemplateShift;
    onEdit?: () => void;
    onDelete?: () => void;
    onClick?: () => void;
    className?: string;
}

/**
 * Format time for display (24h to 12h with AM/PM)
 */
function formatTime(time: string): string {
    if (!time) return '--:--';
    const [hours, minutes] = time.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return time;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Calculate shift duration in hours
 */
function calculateDuration(start: string, end: string, unpaidBreak: number = 0): number {
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);

    if (isNaN(startH) || isNaN(endH)) return 0;

    let startMins = startH * 60 + startM;
    let endMins = endH * 60 + endM;

    if (endMins <= startMins) endMins += 24 * 60;

    const netMins = endMins - startMins - unpaidBreak;
    return Math.round((netMins / 60) * 10) / 10;
}

export function TemplateShiftRow({
    shift,
    onEdit,
    onDelete,
    onClick,
    className,
}: TemplateShiftRowProps) {
    const duration = calculateDuration(
        shift.startTime,
        shift.endTime,
        shift.unpaidBreakDuration
    );

    const hasRequirements =
        (shift.skills?.length || 0) > 0 ||
        (shift.licenses?.length || 0) > 0;

    return (
        <div
            className={cn(
                'flex items-center justify-between p-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors group',
                onClick && 'cursor-pointer',
                className
            )}
            onClick={onClick}
        >
            {/* Left: Time and Role */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-gray-400">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-xs font-mono">
                        {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
                    </span>
                </div>

                <div className="flex items-center gap-2 truncate">
                    {shift.roleName && (
                        <span className="text-sm text-white truncate">
                            {shift.roleName}
                        </span>
                    )}
                    {shift.name && shift.name !== shift.roleName && (
                        <span className="text-xs text-gray-500 truncate">
                            ({shift.name})
                        </span>
                    )}
                </div>
            </div>

            {/* Middle: Duration and Requirements */}
            <div className="flex items-center gap-2 px-3">
                <Badge variant="outline" className="text-xs">
                    {duration}h
                </Badge>

                {hasRequirements && (
                    <Badge variant="secondary" className="text-xs bg-purple-500/20 text-purple-300">
                        +{(shift.skills?.length || 0) + (shift.licenses?.length || 0)} req
                    </Badge>
                )}

                {shift.assignedEmployeeName && (
                    <Badge variant="secondary" className="text-xs bg-emerald-500/20 text-emerald-300">
                        <User className="h-3 w-3 mr-1" />
                        {shift.assignedEmployeeName.split(' ')[0]}
                    </Badge>
                )}
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {onEdit && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit();
                        }}
                    >
                        <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                )}
                {onDelete && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                )}
            </div>
        </div>
    );
}
