import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/modules/core/ui/primitives/dialog';
import { OrgDeptSelector } from '@/modules/core/ui/components/OrgDeptSelector';

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

    // Hierarchy State
    const [orgId, setOrgId] = useState<string | null>(initialOrganizationId || null);
    const [deptId, setDeptId] = useState<string | null>(initialDepartmentId || null);
    const [subDeptId, setSubDeptId] = useState<string | null>(initialSubDepartmentId || null);

    // Sync with props when opened
    React.useEffect(() => {
        if (isOpen) {
            setOrgId(initialOrganizationId || null);
            setDeptId(initialDepartmentId || null);
            setSubDeptId(initialSubDepartmentId || null);
        }
    }, [isOpen, initialOrganizationId, initialDepartmentId, initialSubDepartmentId]);

    const handleCreate = async () => {
        if (!name.trim()) return;
        setIsCreating(true);
        try {
            await onCreate({
                name: name.trim(),
                description,
                icon: 'megaphone',
                departmentId: deptId,
                subDepartmentId: subDeptId
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
                        Fill in the details below to create a new broadcast group.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Organization Hierarchy</label>
                        <OrgDeptSelector
                            selectedOrganizationId={orgId}
                            selectedDepartmentId={deptId}
                            selectedSubDepartmentId={subDeptId}
                            onOrganizationChange={setOrgId}
                            onDepartmentChange={setDeptId}
                            onSubDepartmentChange={setSubDeptId}
                            className="bg-muted p-3 rounded-lg flex-col items-stretch gap-3"
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="name" className="text-sm font-medium">Group Name</label>
                        <Input
                            id="name"
                            placeholder="Enter group name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="description" className="text-sm font-medium">Description (optional)</label>
                        <Input
                            id="description"
                            placeholder="Enter description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>
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
