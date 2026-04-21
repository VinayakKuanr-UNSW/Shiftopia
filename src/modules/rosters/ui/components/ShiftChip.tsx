import React from 'react';
import { Shift } from '@/modules/core/types';
import { ShiftCardCompact } from './ShiftCardCompact';

interface ShiftChipProps {
  shift: Shift;
  groupColor?: string;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
  showEmployee?: boolean;
  employeeName?: string;
  isPast?: boolean;
  onToggleSelect?: () => void;
}

export const ShiftChip: React.FC<ShiftChipProps> = ({
  shift,
  groupColor = 'blue',
  onClick,
  employeeName,
  showEmployee = true, // Compact handles showing employee if name present or unassigned.
  isPast = false,
}) => {
  return (
    <ShiftCardCompact
      shift={{
        ...shift,
        groupColor: groupColor,
        employeeName: employeeName || shift.employeeName,
        // Map required BaseShift properties
        lifecycleStatus: (shift.lifecycleStatus === 'scheduled' || shift.lifecycleStatus === 'active') ? 'published' : (shift.lifecycleStatus as any),
        assignmentStatus: (employeeName || shift.employeeName || (shift as any).assigned_employee_id) ? 'assigned' : 'unassigned',
        role: shift.role || (shift as any).role_name || 'Shift',
      }}
      onClick={onClick}
      isPast={isPast}
      className="h-full w-full"
    />
  );
};
