// src/components/roster/RosterShiftModal.tsx
// Modal for Add/Edit Roster Shifts - Date is locked when adding from grid

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Loader2, Clock, Calendar, Building2, Users, X } from 'lucide-react';
import { format, parse } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';

/* ============================================================
   TYPES
   ============================================================ */

interface Role {
  id: string;
  name: string;
}

interface RemunerationLevel {
  id: string;
  level: string;
  hourlyRate: number;
}

export interface RosterShiftData {
  id?: string;
  name?: string;
  roleId?: string;
  roleName?: string;
  remunerationLevelId?: string;
  remunerationLevel?: string;
  startTime: string;
  endTime: string;
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
  requiredSkills: string[];
  requiredLicenses: string[];
  siteTags: string[];
  eventTags: string[];
  notes?: string;
}

interface RosterShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (shiftData: RosterShiftData) => Promise<void>;
  // Context from grid
  groupId: string;
  groupName: string;
  subGroupId: string;
  subGroupName: string;
  date: string; // YYYY-MM-DD format - LOCKED, cannot be changed
  // Existing shift data for edit mode
  existingShift?: RosterShiftData;
  // Reference data
  roles?: Role[];
  remunerationLevels?: RemunerationLevel[];
  isLoading?: boolean;
}

/* ============================================================
   COMPONENT
   ============================================================ */

export const RosterShiftModal: React.FC<RosterShiftModalProps> = ({
  isOpen,
  onClose,
  onSave,
  groupId,
  groupName,
  subGroupId,
  subGroupName,
  date,
  existingShift,
  roles = [],
  remunerationLevels = [],
  isLoading = false,
}) => {
  const isEditMode = !!existingShift?.id;

  // Form state
  const [formData, setFormData] = useState<RosterShiftData>({
    name: '',
    roleId: '',
    roleName: '',
    remunerationLevelId: '',
    remunerationLevel: '',
    startTime: '09:00',
    endTime: '17:00',
    paidBreakMinutes: 0,
    unpaidBreakMinutes: 30,
    requiredSkills: [],
    requiredLicenses: [],
    siteTags: [],
    eventTags: [],
    notes: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when modal opens or shift changes
  useEffect(() => {
    if (isOpen) {
      if (existingShift) {
        setFormData(existingShift);
      } else {
        setFormData({
          name: '',
          roleId: '',
          roleName: '',
          remunerationLevelId: '',
          remunerationLevel: '',
          startTime: '09:00',
          endTime: '17:00',
          paidBreakMinutes: 0,
          unpaidBreakMinutes: 30,
          requiredSkills: [],
          requiredLicenses: [],
          siteTags: [],
          eventTags: [],
          notes: '',
        });
      }
      setErrors({});
    }
  }, [isOpen, existingShift]);

  // Handle role selection
  const handleRoleChange = (roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    setFormData((prev) => ({
      ...prev,
      roleId,
      roleName: role?.name || '',
    }));
  };

  // Handle remuneration level selection
  const handleRemunerationChange = (levelId: string) => {
    const level = remunerationLevels.find((l) => l.id === levelId);
    setFormData((prev) => ({
      ...prev,
      remunerationLevelId: levelId,
      remunerationLevel: level?.level || '',
    }));
  };

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.startTime) {
      newErrors.startTime = 'Start time is required';
    }
    if (!formData.endTime) {
      newErrors.endTime = 'End time is required';
    }

    // Validate time format
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (formData.startTime && !timeRegex.test(formData.startTime)) {
      newErrors.startTime = 'Invalid time format (HH:MM)';
    }
    if (formData.endTime && !timeRegex.test(formData.endTime)) {
      newErrors.endTime = 'Invalid time format (HH:MM)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Calculate net hours
  const calculateNetHours = (): number => {
    const [startH, startM] = formData.startTime.split(':').map(Number);
    const [endH, endM] = formData.endTime.split(':').map(Number);

    if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) {
      return 0;
    }

    let startMins = startH * 60 + startM;
    let endMins = endH * 60 + endM;

    // Handle overnight
    if (endMins <= startMins) {
      endMins += 24 * 60;
    }

    const totalMins = endMins - startMins;
    const netMins = totalMins - (formData.unpaidBreakMinutes || 0);

    return Math.round((netMins / 60) * 100) / 100;
  };

  // Handle save
  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      await onSave(formData);
      onClose();
    } catch (error) {
      console.error('Error saving shift:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Format date for display
  const displayDate = date
    ? format(parse(date, 'yyyy-MM-dd', new Date()), 'EEEE, MMMM d, yyyy')
    : '';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Shift' : 'Add New Shift'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update shift details below.'
              : 'Create a new shift for the selected date and sub-group.'}
          </DialogDescription>
        </DialogHeader>

        {/* Context Info - Read Only */}
        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-primary" />
            <span className="font-medium">{displayDate}</span>
            <Badge variant="outline" className="ml-auto">
              Locked
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span>{groupName}</span>
            <span className="text-muted-foreground">→</span>
            <span>{subGroupName}</span>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Shift Name (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="name">Shift Name (Optional)</Label>
            <Input
              id="name"
              placeholder="e.g., Morning Shift, Setup Crew"
              value={formData.name || ''}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </div>

          {/* Role */}
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select
              value={formData.roleId || ''}
              onValueChange={handleRoleChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Remuneration Level */}
          <div className="space-y-2">
            <Label htmlFor="level">Remuneration Level</Label>
            <Select
              value={formData.remunerationLevelId || ''}
              onValueChange={handleRemunerationChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select level" />
              </SelectTrigger>
              <SelectContent>
                {remunerationLevels.map((level) => (
                  <SelectItem key={level.id} value={level.id}>
                    {level.level} - ${level.hourlyRate}/hr
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time</Label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="startTime"
                  type="time"
                  className={cn(
                    'pl-9',
                    errors.startTime && 'border-destructive'
                  )}
                  value={formData.startTime}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      startTime: e.target.value,
                    }))
                  }
                />
              </div>
              {errors.startTime && (
                <p className="text-xs text-destructive">{errors.startTime}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">End Time</Label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="endTime"
                  type="time"
                  className={cn('pl-9', errors.endTime && 'border-destructive')}
                  value={formData.endTime}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      endTime: e.target.value,
                    }))
                  }
                />
              </div>
              {errors.endTime && (
                <p className="text-xs text-destructive">{errors.endTime}</p>
              )}
            </div>
          </div>

          {/* Breaks */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="paidBreak">Paid Break (mins)</Label>
              <Input
                id="paidBreak"
                type="number"
                min={0}
                max={120}
                value={formData.paidBreakMinutes}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    paidBreakMinutes: parseInt(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unpaidBreak">Unpaid Break (mins)</Label>
              <Input
                id="unpaidBreak"
                type="number"
                min={0}
                max={120}
                value={formData.unpaidBreakMinutes}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    unpaidBreakMinutes: parseInt(e.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>

          {/* Net Hours Display */}
          <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg">
            <span className="text-sm font-medium">Net Hours</span>
            <span className="text-lg font-bold text-primary">
              {calculateNetHours()} hrs
            </span>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Any additional notes..."
              rows={2}
              value={formData.notes || ''}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, notes: e.target.value }))
              }
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
              'Update Shift'
            ) : (
              'Create Shift'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RosterShiftModal;
