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
                {/* Header */}
                <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors rounded-t-xl">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-background/50">
                                {config.icon}
                            </div>
                            <div>
                                <h3 className="font-semibold text-foreground">{group.name}</h3>
                                <p className="text-xs text-muted-foreground">
                                    {group.subGroups.length} subgroups • {shiftCount} shifts
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {onAddSubgroup && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onAddSubgroup();
                                    }}
                                    className={cn('hover:bg-muted', config.badge)}
                                >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Subgroup
                                </Button>
                            )}
                            {isExpanded ? (
                                <ChevronDown className="h-5 w-5 text-muted-foreground" />
                            ) : (
                                <ChevronRight className="h-5 w-5 text-muted-foreground" />
                            )}
                        </div>
                    </div>
                </CollapsibleTrigger>

                {/* Content */}
                <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-3">
                        {group.subGroups.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                <p className="text-sm">No subgroups yet</p>
                                {onAddSubgroup && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={onAddSubgroup}
                                        className="mt-2"
                                    >
                                        <Plus className="h-4 w-4 mr-1" />
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
