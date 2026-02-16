import React, { useState, useEffect } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/modules/core/ui/primitives/dialog';

export interface EditGroupDialogProps {
    isOpen: boolean;
    onClose: () => void;
    group: any;
    onUpdate: (groupId: string, data: any) => Promise<void>;
}

export const EditGroupDialog: React.FC<EditGroupDialogProps> = ({
    isOpen,
    onClose,
    group,
    onUpdate
}) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);

    useEffect(() => {
        if (group) {
            setName(group.name || '');
            setDescription(group.description || '');
        }
    }, [group]);

    const handleSave = async () => {
        if (!name.trim() || !group) return;
        setIsUpdating(true);
        try {
            await onUpdate(group.id, { name: name.trim(), description });
            onClose();
        } catch (error) {
            // Error managed by hook
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit Broadcast Group</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <label htmlFor="edit-name">Group Name</label>
                        <Input
                            id="edit-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="edit-description">Description</label>
                        <Input
                            id="edit-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isUpdating}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={isUpdating || !name.trim()}>
                        {isUpdating ? "Saving..." : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
