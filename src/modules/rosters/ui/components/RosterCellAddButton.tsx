import React from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

export interface RosterCellAddButtonProps {
  onClick?: (e: React.MouseEvent) => void;
  hasShifts?: boolean;
  holidayName?: string | null;
  title?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Standardized cell `+` (Add Shift) button used across all 4 Roster Planner modes:
 * - People Mode
 * - Group Mode
 * - Roles Mode
 * - Events Mode
 *
 * Implements the circular pill design from People Mode with smooth 90deg hover rotation,
 * subtle theme-aware tint/border, and public holiday detection.
 */
export const RosterCellAddButton: React.FC<RosterCellAddButtonProps> = ({
  onClick,
  hasShifts = false,
  holidayName,
  title,
  disabled = false,
  className,
}) => {
  const label = title || (holidayName ? `Add Shift (${holidayName})` : 'Add Shift');

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      title={label}
      aria-label={label}
      className={cn(
        'flex items-center justify-center rounded-full transition-[transform,background-color,opacity,box-shadow] duration-200 pointer-events-auto',
        holidayName
          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 active:scale-95 shadow-sm'
          : 'bg-primary/10 text-primary border border-primary/40 dark:border-primary/20 hover:bg-primary/20 active:scale-95 shadow-sm',
        hasShifts
          ? 'w-7 h-7 opacity-0 scale-75 group-hover/cell:opacity-100 group-hover/cell:scale-100'
          : 'w-9 h-9 opacity-80 dark:opacity-40 scale-90 group-hover/cell:opacity-100 hover:scale-100 hover:opacity-100',
        disabled && 'opacity-20 cursor-not-allowed pointer-events-none',
        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
        'group/add',
        className
      )}
    >
      <Plus
        className={cn(
          hasShifts ? 'h-4 w-4' : 'h-5 w-5',
          'transition-transform duration-200 group-hover/add:rotate-90',
          holidayName ? 'text-amber-700 dark:text-amber-300' : 'text-primary'
        )}
        aria-hidden="true"
      />
    </button>
  );
};

export default RosterCellAddButton;
