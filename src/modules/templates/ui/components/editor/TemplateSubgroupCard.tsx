// src/modules/templates/ui/components/editor/TemplateSubgroupCard.tsx
// A card component representing a subgroup within a template group

import React, { useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    Copy,
    Edit2,
    MoreVertical,
    Plus,
    Trash2,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/modules/core/ui/primitives/collapsible';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { Input } from '@/modules/core/ui/primitives/input';
import { SubGroup, TemplateShift } from '../../../model/templates.types';

interface TemplateSubgroupCardProps {
    subgroup: SubGroup;
    groupColor?: string;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    onUpdateName?: (name: string) => void;
    onDelete?: () => void;
    onClone?: () => void;
    onAddShift?: () => void;
    renderShifts?: (subgroup: SubGroup) => React.ReactNode;
    className?: string;
}

export function TemplateSubgroupCard({
    subgroup,
    groupColor = 'blue',
    isExpanded = true,
    onToggleExpand,
    onUpdateName,
    onDelete,
    onClone,
    onAddShift,
    renderShifts,
    className,
}: TemplateSubgroupCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(subgroup.name);

    const handleSaveName = () => {
        if (editName.trim() && onUpdateName) {
            onUpdateName(editName.trim());
        }
        setIsEditing(false);
    };

    const colorClasses: Record<string, { bg: string; border: string; text: string }> = {
        blue: {
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/30',
            text: 'text-blue-400',
        },
        green: {
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/30',
            text: 'text-emerald-400',
        },
        red: {
            bg: 'bg-red-500/10',
            border: 'border-red-500/30',
            text: 'text-red-400',
        },
    };

    const colors = colorClasses[groupColor] || colorClasses.blue;

    return (
        <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
            <div
                className={cn(
                    'rounded-lg border bg-slate-900/50',
                    colors.border,
                    className
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2">
                    <CollapsibleTrigger asChild>
                        <div className="flex items-center gap-2 cursor-pointer flex-1">
                            {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-gray-400" />
                            ) : (
                                <ChevronRight className="h-4 w-4 text-gray-400" />
                            )}

                            {isEditing ? (
                                <Input
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    onBlur={handleSaveName}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveName();
                                        if (e.key === 'Escape') setIsEditing(false);
                                    }}
                                    autoFocus
                                    className="h-7 text-sm w-48"
                                    onClick={(e) => e.stopPropagation()}
                                />
                            ) : (
                                <span className={cn('font-medium text-sm', colors.text)}>
                                    {subgroup.name}
                                </span>
                            )}

                            <span className="text-xs text-gray-500">
                                ({subgroup.shifts.length} shifts)
                            </span>
                        </div>
                    </CollapsibleTrigger>

                    <div className="flex items-center gap-1">
                        {onAddShift && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onAddShift}
                                className="h-7 px-2"
                            >
                                <Plus className="h-3.5 w-3.5" />
                            </Button>
                        )}

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                    <MoreVertical className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setIsEditing(true)}>
                                    <Edit2 className="h-4 w-4 mr-2" />
                                    Rename
                                </DropdownMenuItem>
                                {onClone && (
                                    <DropdownMenuItem onClick={onClone}>
                                        <Copy className="h-4 w-4 mr-2" />
                                        Duplicate
                                    </DropdownMenuItem>
                                )}
                                {onDelete && (
                                    <DropdownMenuItem
                                        onClick={onDelete}
                                        className="text-red-400 focus:text-red-400"
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                {/* Content */}
                <CollapsibleContent>
                    <div className="px-3 pb-3">
                        {subgroup.shifts.length === 0 ? (
                            <div className="text-center py-4 text-gray-500 text-sm">
                                <p>No shifts yet</p>
                                {onAddShift && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={onAddShift}
                                        className="mt-1"
                                    >
                                        <Plus className="h-3 w-3 mr-1" />
                                        Add shift
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {renderShifts?.(subgroup)}
                            </div>
                        )}
                    </div>
                </CollapsibleContent>
            </div>
        </Collapsible>
    );
}
