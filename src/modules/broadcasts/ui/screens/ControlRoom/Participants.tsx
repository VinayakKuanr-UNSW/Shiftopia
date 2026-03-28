import React, { useState } from 'react';
import {
    Users,
    UserMinus,
    UserPlus,
    Shield,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { cn } from '@/modules/core/lib/utils';
import {
    BroadcastGroupFull,
    BroadcastParticipantRole,
    GroupParticipantWithDetails,
} from '../../../model/broadcast.types';
import { ParticipantItem } from '../../components/ParticipantItem';
import { AddMemberDialog } from '../../dialogs/AddMemberDialog';

interface ControlRoomParticipantsProps {
    group: BroadcastGroupFull; // Needs full details for participants
    isOpen: boolean;
    canManage: boolean;
    addParticipant: (employeeId: string, role?: BroadcastParticipantRole) => Promise<void>;
    onRemoveParticipant: (employeeId: string) => Promise<any>;
    onRefresh: () => void;
}

export const ControlRoomParticipants: React.FC<ControlRoomParticipantsProps> = ({
    group,
    isOpen,
    canManage,
    addParticipant,
    onRemoveParticipant,
    onRefresh,
}) => {
    const [showAddParticipant, setShowAddParticipant] = useState(false);
    const [showRemoveParticipant, setShowRemoveParticipant] = useState<GroupParticipantWithDetails | null>(null);
    const [isEditMode, setIsEditMode] = useState(false);

    const handleRemoveParticipant = async () => {
        if (!showRemoveParticipant) return;
        try {
            await onRemoveParticipant(showRemoveParticipant.employeeId);
            setShowRemoveParticipant(null);
        } catch (err) {
            // Error handled in parent/hook
        }
    };

    return (
        <div
            className={cn(
                "flex-1 flex flex-col h-full bg-card/10 overflow-hidden",
                !isOpen && "hidden"
            )}
        >
            <div className="p-5 border-b border-border min-w-[20rem]">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-muted-foreground" />
                        <h3 className="font-bold text-foreground">Participants</h3>
                        <Badge variant="outline">{group.participantCount}</Badge>
                    </div>
                </div>
                {canManage && (
                    <div className="space-y-2">
                        <Button
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                            onClick={() => setShowAddParticipant(true)}
                        >
                            <UserPlus className="h-4 w-4 mr-2" />
                            Add Participants
                        </Button>
                        <Button
                            variant="outline"
                            className={cn(
                                "w-full",
                                isEditMode && "bg-secondary text-secondary-foreground"
                            )}
                            onClick={() => setIsEditMode(!isEditMode)}
                        >
                            <UserMinus className="h-4 w-4 mr-2" />
                            {isEditMode ? 'Done Removing' : 'Remove Participants'}
                        </Button>
                    </div>
                )}
            </div>

            <ScrollArea className="flex-1 p-4 min-w-[20rem]">
                {(
                    ['admin', 'broadcaster', 'member'] as BroadcastParticipantRole[]
                ).map((role) => {
                    const roleParticipants =
                        group.participants?.filter((p) => p.role === role) || [];
                    if (roleParticipants.length === 0) return null;

                    return (
                        <div key={role} className="mb-4">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold px-3 mb-2 flex items-center gap-2">
                                <Shield className="h-3 w-3" />
                                {role === 'admin' ? 'Admins' : role === 'broadcaster' ? 'Broadcasters' : 'Members'} ({roleParticipants.length})
                            </p>
                            {roleParticipants.map((p) => (
                                <ParticipantItem
                                    key={p.id}
                                    participant={p}
                                    onRemove={() => setShowRemoveParticipant(p)}
                                    isEditMode={isEditMode}
                                />
                            ))}
                        </div>
                    );
                })}

                {(!group.participants || group.participants.length === 0) && (
                    <div className="text-center py-8">
                        <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                            No participants yet
                        </p>
                    </div>
                )}
            </ScrollArea>

            {/* Dialogs */}
            <AddMemberDialog
                isOpen={showAddParticipant}
                onClose={() => setShowAddParticipant(false)}
                addParticipant={addParticipant}
                groupName={group.name}
                departmentId={group.departmentId}
                subDepartmentId={group.subDepartmentId}
                onMemberAdded={onRefresh}
            />

            <AlertDialog
                open={!!showRemoveParticipant}
                onOpenChange={() => setShowRemoveParticipant(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove Participant?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to remove{' '}
                            <span className="font-bold">
                                {showRemoveParticipant?.employee?.name}
                            </span>{' '}
                            from this group?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleRemoveParticipant}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
