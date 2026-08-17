import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { Megaphone, Trash2, Edit, MoreVertical, Settings, Users, MessageSquare } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { BroadcastGroupWithStats } from '../../model/broadcast.types';
import { cn } from '@/modules/core/lib/utils';
import { PageState } from '@/modules/core/ui/components/PageState';
import { formatDistanceToNow } from 'date-fns';

interface BroadcastGroupsViewProps {
    groups: BroadcastGroupWithStats[];
    isLoading: boolean;
    onGroupClick: (id: string) => void;
    onDeleteGroup: (id: string) => Promise<void>;
    onEditGroup: (group: BroadcastGroupWithStats) => void;
}

export const BroadcastGroupsView: React.FC<BroadcastGroupsViewProps> = ({
    groups,
    isLoading,
    onGroupClick,
    onDeleteGroup,
    onEditGroup,
}) => {
    if (isLoading) {
        return (
            <PageState
                state="loading"
                scope="section"
                title="Loading broadcast groups"
                skeleton={
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2" aria-hidden="true">
                        {[1, 2, 3, 4].map((i) => (
                            <Skeleton key={i} className="h-48 w-full rounded-xl" />
                        ))}
                    </div>
                }
            />
        );
    }

    if (groups.length === 0) {
        return (
            <Card className="border-dashed">
                <PageState
                    state="empty"
                    scope="section"
                    title="No broadcast groups"
                    description="Create your first group to start sending broadcasts to your team."
                    icon={Megaphone}
                />
            </Card>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {groups.map((group) => (
                <Card
                    key={group.id}
                    className="group hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden border-l-4 border-l-primary"
                    onClick={() => onGroupClick(group.id)}
                >
                    <CardHeader className="pb-3">
                        <div className="flex justify-between items-start">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                                    <Megaphone className="h-5 w-5" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                                        {group.name}
                                    </CardTitle>
                                    <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                                        {group.description || 'No description'}
                                    </p>
                                </div>
                            </div>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2">
                                        <MoreVertical className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation();
                                        onEditGroup(group);
                                    }}>
                                        <Edit className="h-4 w-4 mr-2" />
                                        Edit Group
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteGroup(group.id);
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete Group
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </CardHeader>
                    <CardContent className="pb-3">
                        <div className="flex gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                                <Users className="h-4 w-4" />
                                <span>{group.participantCount || 0} Members</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <MessageSquare className="h-4 w-4" />
                                <span>{group.activeBroadcastCount || 0} Active</span>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="pt-3 border-t bg-muted/20 text-xs text-muted-foreground flex justify-between">
                        <span>Updated {formatDistanceToNow(new Date(group.updatedAt || group.createdAt), { addSuffix: true })}</span>
                    </CardFooter>
                </Card>
            ))}
        </div>
    );
};
