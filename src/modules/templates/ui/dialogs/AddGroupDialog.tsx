// src/components/templates/AddGroupDialog.tsx
import React from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import {
  Clipboard,
  UtensilsCrossed,
  Users,
  Briefcase,
  Coffee,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

interface AddGroupDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  newGroup: {
    name: string;
    description?: string;
    color: string;
    icon?: string;
  };
  setNewGroup: React.Dispatch<
    React.SetStateAction<{
      name: string;
      description?: string;
      color: string;
      icon?: string;
    }>
  >;
  onAddGroup: () => void;
}

const COLORS = [
  { value: 'teal', label: 'Teal', class: 'bg-teal-500' },
  { value: 'orange', label: 'Orange', class: 'bg-orange-500' },
  { value: 'blue', label: 'Blue', class: 'bg-blue-500' },
  { value: 'purple', label: 'Purple', class: 'bg-purple-500' },
  { value: 'green', label: 'Green', class: 'bg-green-500' },
  { value: 'red', label: 'Red', class: 'bg-red-500' },
];

const ICONS = [
  { value: 'clipboard', label: 'Clipboard', icon: Clipboard },
  { value: 'utensils', label: 'Kitchen', icon: UtensilsCrossed },
  { value: 'users', label: 'Team', icon: Users },
  { value: 'briefcase', label: 'Business', icon: Briefcase },
  { value: 'coffee', label: 'Break', icon: Coffee },
];

const AddGroupDialog: React.FC<AddGroupDialogProps> = ({
  isOpen,
  onOpenChange,
  newGroup,
  setNewGroup,
  onAddGroup,
}) => {
  const handleSubmit = () => {
    if (newGroup.name.trim()) {
      onAddGroup();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1a2744] border-white/10 sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">
            Add New Group
          </DialogTitle>
          <DialogDescription className="text-white/50">
            Create a new group to organize roles and shifts in your template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Group Name */}
          <div className="space-y-2">
            <label
              htmlFor="groupName"
              className="text-sm font-medium text-white/70"
            >
              Group Name <span className="text-red-400">*</span>
            </label>
            <Input
              id="groupName"
              value={newGroup.name}
              onChange={(e) =>
                setNewGroup({ ...newGroup, name: e.target.value })
              }
              placeholder="e.g., Front of House, Kitchen Staff"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-emerald-500"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label
              htmlFor="groupDescription"
              className="text-sm font-medium text-white/70"
            >
              Description
            </label>
            <Textarea
              id="groupDescription"
              value={newGroup.description || ''}
              onChange={(e) =>
                setNewGroup({ ...newGroup, description: e.target.value })
              }
              placeholder="Brief description of this group's purpose"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-emerald-500 min-h-[80px]"
            />
          </div>

          {/* Icon Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/70">Icon</label>
            <div className="flex gap-2">
              {ICONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNewGroup({ ...newGroup, icon: value })}
                  className={cn(
                    'w-10 h-10 rounded-lg flex items-center justify-center transition-all',
                    newGroup.icon === value
                      ? 'bg-emerald-500/20 text-emerald-400 ring-2 ring-emerald-500'
                      : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70'
                  )}
                  title={label}
                >
                  <Icon className="h-5 w-5" />
                </button>
              ))}
            </div>
          </div>

          {/* Color Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/70">Color</label>
            <div className="flex gap-2">
              {COLORS.map(({ value, label, class: colorClass }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNewGroup({ ...newGroup, color: value })}
                  className={cn(
                    'w-8 h-8 rounded-full transition-all',
                    colorClass,
                    newGroup.color === value
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1a2744]'
                      : 'opacity-60 hover:opacity-100'
                  )}
                  title={label}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/70">Preview</label>
            <div
              className={cn(
                'rounded-lg p-4 border-l-4 flex items-center gap-3',
                `bg-${newGroup.color}-500/10`,
                `border-${newGroup.color}-500`
              )}
              style={{
                backgroundColor: `var(--${newGroup.color}-500, #14b8a6)10`,
                borderLeftColor: `var(--${newGroup.color}-500, #14b8a6)`,
              }}
            >
              <div
                className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center',
                  `bg-${newGroup.color}-500/20`,
                  `text-${newGroup.color}-400`
                )}
              >
                {(() => {
                  const IconComponent =
                    ICONS.find((i) => i.value === newGroup.icon)?.icon ||
                    Clipboard;
                  return <IconComponent className="h-5 w-5" />;
                })()}
              </div>
              <div>
                <h4 className="font-medium text-white">
                  {newGroup.name || 'Group Name'}
                </h4>
                <p className="text-sm text-white/50">
                  {newGroup.description || 'Group description'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="bg-white/5 border-white/20 text-white hover:bg-white/10"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!newGroup.name.trim()}
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            Add Group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddGroupDialog;
