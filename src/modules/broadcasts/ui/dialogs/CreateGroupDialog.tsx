import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
import { BroadcastGroupFormFields } from './BroadcastGroupFormFields';

export interface CreateGroupDialogProps {
    isOpen: boolean;
    onClose: () => void;
    initialOrganizationId?: string | null;
    initialDepartmentId?: string | null;
    initialSubDepartmentId?: string | null;
    onCreate: (data: {
        name: string;
        description?: string;
        icon?: string;
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
        <ResponsiveDialog open={isOpen} onOpenChange={(open) => !open && onClose()} dialogClassName="sm:max-w-[500px]">
            <ResponsiveDialog.Header>
                <ResponsiveDialog.Title>Create New Broadcast Group</ResponsiveDialog.Title>
                <ResponsiveDialog.Description>
                    This group will be created under your current scope. Change the global scope filter to create groups in a different area.
                </ResponsiveDialog.Description>
            </ResponsiveDialog.Header>
            <ResponsiveDialog.Body className="overflow-y-auto max-h-[70dvh]">
                <div className="space-y-4 py-4">
                    <BroadcastGroupFormFields
                        name={name}
                        onNameChange={setName}
                        description={description}
                        onDescriptionChange={setDescription}
                        disabled={isCreating}
                    />
                </div>
            </ResponsiveDialog.Body>
            <ResponsiveDialog.Footer>
                <Button variant="outline" onClick={onClose} disabled={isCreating}>
                    Cancel
                </Button>
                <Button onClick={handleCreate} disabled={isCreating || !name.trim()}>
                    {isCreating ? "Creating..." : "Create Group"}
                </Button>
            </ResponsiveDialog.Footer>
        </ResponsiveDialog>
    );
};
