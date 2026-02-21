import React from 'react';
import { useBroadcastGroup } from '../../state/useBroadcasts';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/modules/core/ui/primitives/dialog';
import { EmployeeSelector } from '../components/EmployeeSelector';
import { useToast } from '@/modules/core/hooks/use-toast';

export interface AddMemberDialogProps {
    isOpen: boolean;
    onClose: () => void;
    groupId: string;
    onMemberAdded?: () => void;
}

export const AddMemberDialog: React.FC<AddMemberDialogProps> = ({
    isOpen,
    onClose,
    groupId,
    onMemberAdded
}) => {
    const { group, addParticipant } = useBroadcastGroup(groupId);
    const { toast } = useToast();

    const handleAddMember = async (userId: string, isAdmin: boolean) => {
        try {
            await addParticipant(userId, isAdmin ? 'admin' : 'member');
            onMemberAdded?.();
            onClose();
        } catch (error: any) {
            if (error?.status === 409 || error?.code === '23505') { // Postgres unique violation code
                toast({
                    title: "Already a member",
                    description: "This user is already a member of the group.",
                    variant: "default"
                });
            } else {
                toast({
                    title: "Error",
                    description: "Failed to add member to group.",
                    variant: "destructive"
                });
            }
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add Member to {group?.name || 'Group'}</DialogTitle>
                    <DialogDescription>
                        Search for an employee to add them to this broadcast group.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <EmployeeSelector
                        onSelect={(userId, isAdmin) => handleAddMember(userId, isAdmin || false)}
                        departmentId={group?.departmentId}
                        subDepartmentId={group?.subDepartmentId}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
};
