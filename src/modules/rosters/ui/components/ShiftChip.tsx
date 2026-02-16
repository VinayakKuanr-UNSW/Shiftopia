import React from 'react';
import { Shift } from '@/types';
import { ShiftCardCompact } from './ShiftCardCompact';

interface ShiftChipProps {
  shift: Shift;
  groupColor?: string;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
  showEmployee?: boolean;
  employeeName?: string;
}

export const ShiftChip: React.FC<ShiftChipProps> = ({
  shift,
  groupColor = 'blue',
  onClick,
  employeeName,
  showEmployee = true, // Compact handles showing employee if name present or unassigned.
}) => {
  return (
    <ShiftCardCompact
      shift={{
        ...shift,
        groupColor: groupColor,
        employeeName: employeeName || shift.employeeName,
      }}
      onClick={onClick}
      className="h-full w-full"
    />
  );
};
