// src/modules/templates/ui/components/editor/TemplateSubgroupCard.tsx
// A card component representing a subgroup within a template group

import React, { useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    Copy,
    Edit2,
    MoreHorizontal,
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
            bg: 'bg-blue-500/15 dark:bg-blue-900/40',
            border: 'border-blue-500/30',
            text: 'text-blue-700 dark:text-blue-300',
        },
        green: {
            bg: 'bg-emerald-500/15 dark:bg-emerald-900/40',
            border: 'border-emerald-500/30',
            text: 'text-emerald-700 dark:text-emerald-300',
        },
        red: {
            bg: 'bg-red-500/15 dark:bg-red-900/40',
            border: 'border-red-500/30',
            text: 'text-red-700 dark:text-red-300',
        },
        amber: {
            bg: 'bg-amber-500/15 dark:bg-amber-900/40',
            border: 'border-amber-500/30',
            text: 'text-amber-700 dark:text-amber-300',
        },
    };

    const colors = colorClasses[groupColor] || colorClasses.blue;

    return (
        <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
            <div
                className={cn(
                    'rounded-lg border',
                    colors.bg,
                    colors.border,
                    className
                )}
            >
                {/* Header. Rename is rendered INSTEAD of the trigger, not inside
                    it: a text input nested in a control cannot be typed into
                    reliably (every keystroke is also a trigger activation), and
                    the old stopPropagation only masked that for mouse clicks. */}
                <div className="flex items-center justify-between gap-1 px-2 py-2 sm:px-3">
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
                            aria-label={`Rename subgroup ${subgroup.name}`}
                            className="h-11 min-h-[44px] flex-1 text-base sm:text-sm font-semibold"
                        />
                    ) : (
                        <CollapsibleTrigger asChild>
                            <button
                                type="button"
                                aria-expanded={isExpanded}
                                className="flex flex-1 min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 min-h-[44px] text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                {isExpanded ? (
                                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                                ) : (
                                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                                )}

                                <span className={cn('font-bold text-sm tracking-tight truncate', colors.text)}>
                                    {subgroup.name}
                                </span>

                                <span className="shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                    ({subgroup.shifts.length} shifts)
                                </span>
                            </button>
                        </CollapsibleTrigger>
                    )}

                    <div className="flex shrink-0 items-center gap-0.5">
                        {onAddShift && (
                            <Button
                                variant="ghost"
                                onClick={onAddShift}
                                aria-label={`Add shift to ${subgroup.name}`}
                                className="h-11 w-11 min-h-[44px] min-w-[44px] p-0 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                            >
                                <Plus className="h-5 w-5" aria-hidden="true" />
                            </Button>
                        )}

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    aria-label={`Actions for subgroup ${subgroup.name}`}
                                    className="h-11 w-11 min-h-[44px] min-w-[44px] p-0 text-slate-700 dark:text-slate-300"
                                >
                                    <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {/* Seed from the current name, not whatever it was at
                                    mount — `editName` initialises once. */}
                                <DropdownMenuItem onClick={() => { setEditName(subgroup.name); setIsEditing(true); }}>
                                    <Edit2 className="h-4 w-4 mr-2" aria-hidden="true" />
                                    Rename
                                </DropdownMenuItem>
                                {onClone && (
                                    <DropdownMenuItem onClick={onClone}>
                                        <Copy className="h-4 w-4 mr-2" aria-hidden="true" />
                                        Duplicate
                                    </DropdownMenuItem>
                                )}
                                {onDelete && (
                                    <DropdownMenuItem
                                        onClick={onDelete}
                                        className="text-rose-600 dark:text-rose-400 focus:text-rose-600"
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
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
                            <div className="text-center py-4 text-slate-600 dark:text-slate-300 text-sm">
                                <p className="font-medium">No shifts yet</p>
                                {onAddShift && (
                                    <Button
                                        variant="outline"
                                        onClick={onAddShift}
                                        aria-label={`Add first shift to ${subgroup.name}`}
                                        className="mt-2 font-semibold border-slate-300 dark:border-slate-700 h-11 min-h-[44px] px-4"
                                    >
                                        <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
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
