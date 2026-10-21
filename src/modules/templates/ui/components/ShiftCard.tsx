import React from 'react';
import { Edit2, Trash2, Copy, MoreVertical } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/modules/core/ui/primitives/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import {
  TemplateShift,
  formatTimeDisplay,
  calculateNetHours,
} from '@/modules/templates/model/templates.types';
import {
  TARGET_EMPLOYMENT_TYPE_LABELS,
  toTargetEmploymentType,
} from '@/modules/core/model/employment.types';
import { useSkills, useLicenses } from '@/modules/rosters/state/useRosterShifts';

interface ShiftCardProps {
  shift: TemplateShift;
  isReadOnly: boolean;
  groupColor: string;
  onEdit: () => void;
  onDelete: () => void;
  onClone?: () => void;
}

const ShiftCard: React.FC<ShiftCardProps> = React.memo(({
  shift,
  isReadOnly,
  onEdit,
  onDelete,
  onClone,
}) => {
  const { data: skillsLookup } = useSkills();
  const { data: licensesLookup } = useLicenses();

  const roleLabel = shift.roleName || shift.name || 'Unnamed Shift';
  const remunerationLabel =
    shift.remunerationLevelName ||
    (shift.remunerationLevel ? `Level ${shift.remunerationLevel}` : null);

  const netHours = calculateNetHours(
    shift.startTime,
    shift.endTime,
    shift.unpaidBreakDuration
  );
  const totalBreak =
    (shift.paidBreakDuration || 0) + (shift.unpaidBreakDuration || 0);

  const targetType = shift.targetEmploymentType
    ? toTargetEmploymentType(shift.targetEmploymentType)
    : null;

  const employmentTypeLabel = targetType
    ? (targetType === 'PT' && shift.targetRequiresFlexible
        ? 'Flexible Part-Time'
        : TARGET_EMPLOYMENT_TYPE_LABELS[targetType] || targetType)
    : null;

  // Template shifts are draft blueprints — yellow pill consistent with draft lifecycle status
  const badgeColor = 'bg-amber-400 shadow-sm shadow-amber-400/20';

  const baseRole = shift.roleName || shift.name || 'Unnamed Shift';
  const roleDisplay = React.useMemo(() => {
    if (baseRole.includes('·')) return baseRole;
    if (baseRole.startsWith('Event Setup ') && baseRole.length > 'Event Setup '.length) {
      return `Event Setup · ${baseRole.substring('Event Setup '.length)}`;
    }
    return baseRole;
  }, [baseRole]);

  return (
    <div
      className={cn(
        'group relative flex items-center justify-between gap-2.5 px-3 py-2.5 min-h-[40px] w-full text-xs transition-colors duration-150 select-none hover:bg-white/[0.04] cursor-pointer'
      )}
      onClick={onEdit}
    >
      {/* 1. Badge + Role */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className={cn('w-1.5 h-5 rounded-full shrink-0', badgeColor)} />
        <span
          className="font-medium text-slate-100 dark:text-slate-100 truncate text-xs sm:text-[13px]"
          title={`${roleDisplay}${remunerationLabel ? ` (${remunerationLabel})` : ''}`}
        >
          {roleDisplay}
        </span>
        {remunerationLabel && (
          <span className="sr-only">
            {remunerationLabel}
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="h-4 w-px bg-slate-300/40 dark:bg-white/10 shrink-0 mx-2 select-none" aria-hidden="true" />

      {/* 2. Timings */}
      <div
        className="flex items-center gap-1.5 shrink-0 font-medium text-slate-300 dark:text-slate-300 text-xs sm:text-[13px] tabular-nums"
        title={`${formatTimeDisplay(shift.startTime)} – ${formatTimeDisplay(shift.endTime)} (${netHours}h net)`}
      >
        <span>
          {formatTimeDisplay(shift.startTime)} - {formatTimeDisplay(shift.endTime)}
        </span>
        <span className="sr-only">
          {netHours}h net
        </span>
      </div>

      {/* Accessible break duration text for screen readers & tests */}
      {totalBreak > 0 && (
        <span className="sr-only">
          {shift.paidBreakDuration > 0 && `${shift.paidBreakDuration}m paid`}
          {shift.paidBreakDuration > 0 && shift.unpaidBreakDuration > 0 && ' + '}
          {shift.unpaidBreakDuration > 0 && `${shift.unpaidBreakDuration}m unpaid`}
        </span>
      )}

      {/* Divider */}
      <div className="h-4 w-px bg-slate-300/40 dark:bg-white/10 shrink-0 mx-2 select-none" aria-hidden="true" />

      {/* 3. Assignment */}
      <div className="flex items-center min-w-0 max-w-[180px] flex-1">
        {shift.assignedEmployeeName ? (
          <span
            className="text-slate-200 dark:text-slate-200 truncate font-normal text-xs sm:text-[13px]"
            title={shift.assignedEmployeeName}
          >
            {shift.assignedEmployeeName}
          </span>
        ) : employmentTypeLabel ? (
          <span className="text-slate-300 dark:text-slate-300 truncate font-medium text-xs sm:text-[13px]">
            {employmentTypeLabel}
          </span>
        ) : (
          <span className="text-amber-400 font-medium text-xs sm:text-[13px] truncate">
            Employment type not set
          </span>
        )}
      </div>

      {/* 4. Three Dots Menu */}
      {!isReadOnly && (
        <div
          className="relative z-30 shrink-0 flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <TooltipProvider>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for ${roleLabel}`}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-white/10 rounded-full"
                    >
                      <MoreVertical className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit();
                    }}
                    className="cursor-pointer"
                  >
                    <Edit2 className="h-4 w-4 mr-2" aria-hidden="true" />
                    Edit Shift
                  </DropdownMenuItem>

                  {onClone && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onClone();
                      }}
                      className="cursor-pointer"
                    >
                      <Copy className="h-4 w-4 mr-2" aria-hidden="true" />
                      Clone Shift
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="text-destructive focus:text-destructive cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                    Delete Shift
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <TooltipContent>More actions</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
});

export default ShiftCard;
