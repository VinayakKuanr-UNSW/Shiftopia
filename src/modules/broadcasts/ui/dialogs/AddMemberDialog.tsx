import React from 'react';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
import { EmployeeSelector } from '@/modules/core/ui/components/EmployeeSelector';
import { useToast } from '@/modules/core/hooks/use-toast';
import { BroadcastParticipantRole } from '../../model/broadcast.types';

export interface AddMemberDialogProps {
    isOpen: boolean;
    onClose: () => void;
    addParticipant: (employeeId: string, role?: BroadcastParticipantRole) => Promise<void>;
    groupName?: string;
    departmentId?: string;
    subDepartmentId?: string;
    onMemberAdded?: () => void;
}

export const AddMemberDialog: React.FC<AddMemberDialogProps> = ({
    isOpen,
    onClose,
    addParticipant,
    groupName,
    departmentId,
    subDepartmentId,
    onMemberAdded
}) => {
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
        <ResponsiveDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ResponsiveDialog.Header>
                <ResponsiveDialog.Title>Add Member to {groupName || 'Group'}</ResponsiveDialog.Title>
                <ResponsiveDialog.Description>
                    Search for an employee to add them to this broadcast group.
                </ResponsiveDialog.Description>
            </ResponsiveDialog.Header>
            <ResponsiveDialog.Body className="overflow-y-auto max-h-[70dvh]">
                <div className="space-y-4 py-4">
                    <EmployeeSelector
                        onSelect={(userId, isAdmin) => handleAddMember(userId, isAdmin || false)}
                        departmentId={departmentId}
                        subDepartmentId={subDepartmentId}
                    />
                </div>
            </ResponsiveDialog.Body>
        </ResponsiveDialog>
    );
};
