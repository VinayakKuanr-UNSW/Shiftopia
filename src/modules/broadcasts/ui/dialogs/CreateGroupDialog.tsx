import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/modules/core/ui/primitives/dialog';
import { BroadcastGroupFormFields } from './BroadcastGroupFormFields';

export interface CreateGroupDialogProps {
    isOpen: boolean;
    onClose: () => void;
    initialOrganizationId?: string | null;
    initialDepartmentId?: string | null;
    initialSubDepartmentId?: string | null;
    onCreate: (data: {
        name: string;
        description: string;
        icon: string;
        organizationId?: string | null;
        departmentId?: string | null;
        subDepartmentId?: string | null;
    }) => Promise<void>;
}

export const CreateGroupDialog: React.FC<CreateGroupDialogProps> = ({
    isOpen,
    onClose,
    onCreate,
    initialOrganizationId,
    initialDepartmentId,
    initialSubDepartmentId
}) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    const handleCreate = async () => {
        if (!name.trim()) return;
        setIsCreating(true);
        try {
            await onCreate({
                name: name.trim(),
                description,
                icon: 'megaphone',
                organizationId: initialOrganizationId,
                departmentId: initialDepartmentId,
                subDepartmentId: initialSubDepartmentId,
            });
            setName('');
            setDescription('');
            onClose();
        } catch (error) {
            // Error managed by hook
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Create New Broadcast Group</DialogTitle>
                    <DialogDescription>
                        This group will be created under your current scope. Change the global scope filter to create groups in a different area.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <BroadcastGroupFormFields
                        name={name}
                        onNameChange={setName}
                        description={description}
                        onDescriptionChange={setDescription}
                        disabled={isCreating}
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isCreating}>
                        Cancel
                    </Button>
                    <Button onClick={handleCreate} disabled={isCreating || !name.trim()}>
                        {isCreating ? "Creating..." : "Create Group"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
