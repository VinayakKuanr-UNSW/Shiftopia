import React from 'react';
import { Edit, Trash2, Users, MessageSquare } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/core/ui/primitives/card';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { BroadcastGroup } from '../../model/broadcast.types';

interface GroupsListProps {
    groups: BroadcastGroup[];
    selectedGroup: BroadcastGroup | null;
    isLoading: boolean;
    onSelectGroup: (group: BroadcastGroup) => void;
    onEditGroup: (group: BroadcastGroup) => void;
    onDeleteGroup: (groupId: string) => void;
    onCreateGroup: () => void;
}

export const GroupsList: React.FC<GroupsListProps> = ({
    groups,
    selectedGroup,
    isLoading,
    onSelectGroup,
    onEditGroup,
    onDeleteGroup,
    onCreateGroup
}) => {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Broadcast Groups
                </CardTitle>
                <Button size="sm" className="px-2" onClick={onCreateGroup}>
                    <Users className="mr-2 h-4 w-4" />
                    New Group
                </Button>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                    </div>
                ) : groups.length === 0 ? (
                    <div className="text-center py-8">
                        <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">No broadcast groups found.</p>
                        <p className="text-sm text-muted-foreground">Create one to get started.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {groups.map((group) => (
                            <div
                                key={group.id}
                                className={`flex items-center justify-between p-3 border rounded-md cursor-pointer hover:bg-muted transition-colors ${selectedGroup?.id === group.id ? 'bg-muted border-primary' : ''
                                    }`}
                                onClick={() => onSelectGroup(group)}
                            >
                                <div className="flex items-center gap-3">
                                    <Users className="h-4 w-4 text-primary" />
                                    <span className="font-medium">{group.name}</span>
                                </div>
                                <div className="flex space-x-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onEditGroup(group);
                                        }}
                                    >
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteGroup(group.id);
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

