// src/components/roster/AddSubGroupDialog.tsx
// Dialog for adding/editing sub-groups in roster groups

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Loader2, Building2 } from 'lucide-react';

/* ============================================================
   TYPES
   ============================================================ */

export interface SubGroupData {
  id?: string;
  name: string;
  description?: string;
}

interface AddSubGroupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: SubGroupData) => Promise<void>;
  groupId: string;
  groupName: string;
  existingSubGroup?: SubGroupData;
  isLoading?: boolean;
}

/* ============================================================
   COMPONENT
   ============================================================ */

export const AddSubGroupDialog: React.FC<AddSubGroupDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  groupId,
  groupName,
  existingSubGroup,
  isLoading = false,
}) => {
  const isEditMode = !!existingSubGroup?.id;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (existingSubGroup) {
        setName(existingSubGroup.name);
        setDescription(existingSubGroup.description || '');
      } else {
        setName('');
        setDescription('');
      }
      setError('');
    }
  }, [isOpen, existingSubGroup]);

  // Handle save
  const handleSave = async () => {
    if (!name.trim()) {
      setError('Sub-group name is required');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        id: existingSubGroup?.id,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save sub-group');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Sub-Group' : 'Add Sub-Group'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode 
              ? 'Update sub-group details.'
              : `Create a new sub-group in ${groupName}.`}
          </DialogDescription>
        </DialogHeader>

        {/* Context */}
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg text-sm">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="font-medium">{groupName}</span>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subgroupName">Sub-Group Name *</Label>
            <Input
              id="subgroupName"
              placeholder="e.g., Loading Dock, Stage Left, Kitchen"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              className={error ? 'border-destructive' : ''}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              placeholder="Brief description of this sub-group..."
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : isEditMode ? (
              'Update Sub-Group'
            ) : (
              'Create Sub-Group'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddSubGroupDialog;
