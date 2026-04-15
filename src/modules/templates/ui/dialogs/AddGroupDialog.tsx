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
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
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
    <ResponsiveDialog open={isOpen} onOpenChange={onOpenChange} dialogClassName="bg-card border-border sm:max-w-[500px]" drawerClassName="h-[85dvh]">
      <ResponsiveDialog.Header>
        <ResponsiveDialog.Title className="text-foreground text-xl">
          Add New Group
        </ResponsiveDialog.Title>
        <ResponsiveDialog.Description className="text-muted-foreground">
          Create a new group to organize roles and shifts in your template.
        </ResponsiveDialog.Description>
      </ResponsiveDialog.Header>

      <ResponsiveDialog.Body className="overflow-y-auto max-h-[70dvh]">
        <div className="space-y-5 py-4">
          {/* Group Name */}
          <div className="space-y-2">
            <label
              htmlFor="groupName"
              className="text-sm font-medium text-muted-foreground"
            >
              Group Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="groupName"
              value={newGroup.name}
              onChange={(e) =>
                setNewGroup({ ...newGroup, name: e.target.value })
              }
              placeholder="e.g., Front of House, Kitchen Staff"
              className="bg-transparent border-border text-foreground placeholder:text-muted-foreground/50 focus:border-primary"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label
              htmlFor="groupDescription"
              className="text-sm font-medium text-muted-foreground"
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
              className="bg-transparent border-border text-foreground placeholder:text-muted-foreground/50 focus:border-primary min-h-[80px]"
            />
          </div>

          {/* Icon Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Icon</label>
            <div className="flex gap-2">
              {ICONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNewGroup({ ...newGroup, icon: value })}
                  className={cn(
                    'w-10 h-10 rounded-lg flex items-center justify-center transition-all',
                    newGroup.icon === value
                      ? 'bg-primary/20 text-primary ring-2 ring-primary'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
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
            <label className="text-sm font-medium text-muted-foreground">Color</label>
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
                      ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                      : 'opacity-60 hover:opacity-100'
                  )}
                  title={label}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Preview</label>
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
                  `text-${newGroup.color}-600 dark:text-${newGroup.color}-400`
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
                <h4 className="font-medium text-foreground">
                  {newGroup.name || 'Group Name'}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {newGroup.description || 'Group description'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </ResponsiveDialog.Body>

      <ResponsiveDialog.Footer className="gap-2">
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          className="bg-transparent border-border text-foreground hover:bg-muted/50 min-h-[44px]"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!newGroup.name.trim()}
          className="bg-primary hover:bg-primary/90 text-primary-foreground min-h-[44px]"
        >
          Add Group
        </Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
};

export default AddGroupDialog;
