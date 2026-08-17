// src/modules/templates/ui/components/editor/TemplateGroupCard.tsx
// A card component representing a single template group (e.g., Convention Centre)

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/modules/core/ui/primitives/collapsible';
import { Group, SubGroup } from '../../../model/templates.types';
import { GROUP_CONFIG } from '../../constants';

interface TemplateGroupCardProps {
    group: Group;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    onAddSubgroup?: () => void;
    renderSubgroups?: (group: Group) => React.ReactNode;
    className?: string;
}

export function TemplateGroupCard({
    group,
    isExpanded = true,
    onToggleExpand,
    onAddSubgroup,
    renderSubgroups,
    className,
}: TemplateGroupCardProps) {
    const config = GROUP_CONFIG[group.name] || {
        gradient: 'from-gray-600/20 via-gray-500/10 to-transparent',
        border: 'border-gray-500/30',
        badge: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
        icon: null,
    };

    const shiftCount = group.subGroups.reduce(
        (sum, sg) => sum + sg.shifts.length,
        0
    );

    return (
        <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
            <div
                className={cn(
                    'rounded-xl border bg-gradient-to-r',
                    config.gradient,
                    config.border,
                    className
                )}
            >
                {/* Header.
                    The trigger used to be a `div role="button"` wrapping the whole
                    row — which meant (a) Space never toggled it, because a div
                    fires no synthetic click, and (b) the Add Subgroup button was
                    nested INSIDE a control, invalid HTML held together by
                    stopPropagation. Trigger and action are now siblings, and the
                    trigger is a real <button>. */}
                <div className="flex items-center gap-2 p-2 pl-3 sm:p-3 sm:pl-4">
                    <CollapsibleTrigger asChild>
                        <button
                            type="button"
                            aria-expanded={isExpanded}
                            className="flex flex-1 min-w-0 items-center gap-3 rounded-lg p-2 min-h-[44px] text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            {isExpanded ? (
                                <ChevronDown className="h-5 w-5 shrink-0 text-slate-600 dark:text-slate-300" aria-hidden="true" />
                            ) : (
                                <ChevronRight className="h-5 w-5 shrink-0 text-slate-600 dark:text-slate-300" aria-hidden="true" />
                            )}
                            <div className="p-2 rounded-lg bg-background/60 shadow-sm border border-slate-200/50 dark:border-slate-800/50 shrink-0">
                                {config.icon}
                            </div>
                            <div className="min-w-0">
                                <h3 className="font-bold text-base text-foreground tracking-tight truncate">{group.name}</h3>
                                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                    {group.subGroups.length} subgroups • {shiftCount} shifts
                                </p>
                            </div>
                        </button>
                    </CollapsibleTrigger>

                    {onAddSubgroup && (
                        <Button
                            variant="ghost"
                            onClick={onAddSubgroup}
                            aria-label={`Add subgroup to ${group.name}`}
                            className={cn('shrink-0 hover:bg-muted font-semibold h-11 min-h-[44px] px-3', config.badge)}
                        >
                            <Plus className="h-4 w-4 sm:mr-1" aria-hidden="true" />
                            <span className="hidden sm:inline">Subgroup</span>
                        </Button>
                    )}
                </div>

                {/* Content */}
                <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-3">
                        {group.subGroups.length === 0 ? (
                            <div className="text-center py-8 text-slate-600 dark:text-slate-300">
                                <p className="text-sm font-medium">No subgroups yet</p>
                                {onAddSubgroup && (
                                    <Button
                                        variant="outline"
                                        onClick={onAddSubgroup}
                                        aria-label={`Add first subgroup to ${group.name}`}
                                        className="mt-3 font-semibold h-11 min-h-[44px] px-4 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                                    >
                                        <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                                        Add first subgroup
                                    </Button>
                                )}
                            </div>
                        ) : (
                            renderSubgroups?.(group)
                        )}
                    </div>
                </CollapsibleContent>
            </div>
        </Collapsible>
    );
}
