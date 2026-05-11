import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Plus, Edit, Trash, Copy, GripVertical } from 'lucide-react';
import { AddSubGroupDialog } from '../dialogs/AddSubGroupDialog';
import { EditGroupDialog, DepartmentColor } from '../dialogs/EditGroupDialog';
import { RosterSubGroup } from './RosterSubGroup';
import { Group } from '@/modules/templates/model/templates.types';

// Infer types if not exported, or define them to match usages
export type DepartmentName = string;

interface RosterGroupProps {
  group: Group;
  templateId?: string | number;
  onAddSubGroup?: (groupId: string | number, name: string) => void;
  onUpdateGroup?: (groupId: string | number, updates: Partial<Group>) => void;
  onDeleteGroup?: (groupId: string | number) => void;
  onCloneGroup?: (groupId: string | number) => void;
  readOnly?: boolean;
  dragHandleProps?: any;
}

const RosterGroup: React.FC<RosterGroupProps> = ({
  group,
  templateId,
  onAddSubGroup,
  onUpdateGroup,
  onDeleteGroup,
  onCloneGroup,
  readOnly = false,
  dragHandleProps
}) => {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddSubGroupDialogOpen, setIsAddSubGroupDialogOpen] = useState(false);

  const getGroupColorClass = (color: string) => {
    switch (color) {
      case 'blue':
        return 'bg-blue-900 border-blue-800 text-white';
      case 'green':
        return 'bg-green-900 border-green-800 text-white';
      case 'red':
        return 'bg-red-900 border-red-800 text-white';
      case 'purple':
        return 'bg-purple-900 border-purple-800 text-white';
      case 'sky':
        return 'bg-sky-900 border-sky-800 text-white';
      default:
        return 'bg-gray-900 border-gray-800 text-white';
    }
  };

  const handleEditGroup = (name: string, color: DepartmentColor) => {
    if (onUpdateGroup) {
      onUpdateGroup(group.id, {
        name,
        color
      });
    }
  };

  return (
    <Card className={`${getGroupColorClass(group.color)} border-2`}>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2" {...dragHandleProps}>
            <GripVertical className="h-5 w-5 cursor-grab" />
            <CardTitle className="text-xl">{group.name}</CardTitle>
          </div>
          {!readOnly && (
            <div className="flex space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditDialogOpen(true)}
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCloneGroup?.(group.id)}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-800"
                onClick={() => onDeleteGroup?.(group.id)}
              >
                <Trash className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {group.subGroups.length > 0 ? (
          <div className="space-y-4">
            {group.subGroups.map(subGroup => (
              <RosterSubGroup
                key={subGroup.id}
                templateId={templateId}
                groupId={group.id}
                groupColor={group.color}
                subGroup={subGroup}
                readOnly={readOnly}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-gray-200">
            No sub-groups defined
          </div>
        )}

        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-4 w-full bg-transparent hover:bg-white/10"
            onClick={() => setIsAddSubGroupDialogOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" /> Add Sub-Group
          </Button>
        )}
      </CardContent>

      <EditGroupDialog
        groupName={group.name}
        groupColor={group.color}
        onEditGroup={handleEditGroup}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
      />

      <AddSubGroupDialog
        groupId={group.id}
        groupName={group.name}
        onAddSubGroup={onAddSubGroup!}
        open={isAddSubGroupDialogOpen}
        onOpenChange={setIsAddSubGroupDialogOpen}
      />
    </Card>
  );
};

export default RosterGroup;
