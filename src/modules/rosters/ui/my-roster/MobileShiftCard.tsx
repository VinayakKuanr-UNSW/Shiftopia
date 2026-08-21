import React from 'react';
import { Clock, User, Coffee, Briefcase } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { Shift } from '@/modules/rosters';
import {
  formatTimeDisplay,
  calculateNetHours,
} from '@/modules/templates/model/templates.types';
import {
  TARGET_EMPLOYMENT_TYPE_LABELS,
  toTargetEmploymentType,
} from '@/modules/core/model/employment.types';
import { useAuth } from '@/platform/auth/useAuth';

interface MobileShiftCardProps {
  shiftData: {
    shift: Shift;
    groupName: string;
    groupColor: string;
    subGroupName?: string;
  };
  selectedDay?: Date;
  onClick?: () => void;
}

const colorClasses: Record<
  string,
  { bg: string; border: string; text: string; bgHover: string }
> = {
  blue: {
    bg: 'bg-blue-500/5 dark:bg-blue-500/10',
    bgHover: 'hover:bg-blue-500/10 dark:hover:bg-blue-500/20',
    border: 'border-blue-500/20 dark:border-blue-500/30',
    text: 'text-blue-600 dark:text-blue-400',
  },
  green: {
    bg: 'bg-emerald-500/5 dark:bg-emerald-500/10',
    bgHover: 'hover:bg-emerald-500/10 dark:hover:bg-emerald-500/20',
    border: 'border-emerald-500/20 dark:border-emerald-500/30',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  emerald: {
    bg: 'bg-emerald-500/5 dark:bg-emerald-500/10',
    bgHover: 'hover:bg-emerald-500/10 dark:hover:bg-emerald-500/20',
    border: 'border-emerald-500/20 dark:border-emerald-500/30',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  red: {
    bg: 'bg-red-500/5 dark:bg-red-500/10',
    bgHover: 'hover:bg-red-500/10 dark:hover:bg-red-500/20',
    border: 'border-red-500/20 dark:border-red-500/30',
    text: 'text-red-600 dark:text-red-400',
  },
  amber: {
    bg: 'bg-amber-500/5 dark:bg-amber-500/10',
    bgHover: 'hover:bg-amber-500/10 dark:hover:bg-amber-500/20',
    border: 'border-amber-500/20 dark:border-amber-500/30',
    text: 'text-amber-600 dark:text-amber-400',
  },
  purple: {
    bg: 'bg-purple-500/5 dark:bg-purple-500/10',
    bgHover: 'hover:bg-purple-500/10 dark:hover:bg-purple-500/20',
    border: 'border-purple-500/20 dark:border-purple-500/30',
    text: 'text-purple-600 dark:text-purple-400',
  },
};

function resolveColorKey(groupColor?: string, groupName?: string): string {
  const c = (groupColor || groupName || '').toLowerCase();
  if (c.includes('exhibition') || c.includes('green') || c.includes('emerald')) return 'green';
  if (c.includes('theatre') || c.includes('red') || c.includes('rose')) return 'red';
  if (c.includes('cutaway') || c.includes('amber') || c.includes('yellow')) return 'amber';
  if (c.includes('purple') || c.includes('violet')) return 'purple';
  return 'blue';
}

export const MobileShiftCard: React.FC<MobileShiftCardProps> = ({ shiftData, onClick }) => {
  const { shift, groupName, groupColor } = shiftData;
  const { user } = useAuth();

  const colorKey = resolveColorKey(groupColor, groupName);
  const colors = colorClasses[colorKey] || colorClasses.blue;

  const roleLabel =
    (shift as any).roleName ||
    shift.roles?.name ||
    (shift as any).role ||
    (shift as any).name ||
    'Unnamed Shift';

  const remunerationLabel =
    (shift as any).remunerationLevelName ||
    (shift as any).remuneration_level_name ||
    (shift.remuneration_level
      ? typeof shift.remuneration_level === 'number'
        ? `Level ${shift.remuneration_level}`
        : String(shift.remuneration_level).startsWith('Level')
          ? String(shift.remuneration_level)
          : `Level ${shift.remuneration_level}`
      : null) ||
    (shift as any).remunerationLevel ||
    (shift.remuneration_levels as any)?.name ||
    (shift.roles as any)?.level_name ||
    null;

  const startTime = shift.start_time || (shift as any).startTime || '00:00';
  const endTime = shift.end_time || (shift as any).endTime || '00:00';
  const paidBreak =
    (shift as any).paidBreakDuration ?? (shift as any).paid_break_minutes ?? 0;
  const unpaidBreak =
    (shift as any).unpaidBreakDuration ??
    (shift as any).unpaid_break_minutes ??
    shift.break_minutes ??
    0;
  const totalBreak = paidBreak + unpaidBreak;

  const netHours = calculateNetHours(
    startTime.slice(0, 5),
    endTime.slice(0, 5),
    unpaidBreak,
  );

  const rawTargetType =
    (shift as any).targetEmploymentType ||
    (shift as any).target_employment_type ||
    user?.employmentType;
  const targetType = rawTargetType ? toTargetEmploymentType(rawTargetType) : null;
  const targetRequiresFlexible = Boolean(
    (shift as any).targetRequiresFlexible ??
      (shift as any).target_requires_flexible,
  );

  const employmentTypeLabel = targetType
    ? targetType === 'PT' && targetRequiresFlexible
      ? 'Flexible Part-Time'
      : TARGET_EMPLOYMENT_TYPE_LABELS[targetType] || targetType
    : user?.employmentType
      ? TARGET_EMPLOYMENT_TYPE_LABELS[
          toTargetEmploymentType(user.employmentType) || 'FT'
        ] || user.employmentType
      : 'Full-Time';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        'group relative p-3 rounded-xl border transition-all duration-200 cursor-pointer active:scale-[0.98]',
        colors.bg,
        colors.bgHover,
        colors.border,
        'hover:border-opacity-60',
      )}
    >
      {/* Row 1: <Role> <Remuneration Level> */}
      <div className="flex items-start gap-2 mb-2">
        <div
          className={cn(
            'w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5',
            colors.bg,
          )}
        >
          <User className={cn('h-3.5 w-3.5', colors.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <h4 className="text-sm font-medium text-foreground truncate">
              {roleLabel}
            </h4>
            {remunerationLabel && (
              <span className="text-xs text-muted-foreground font-normal shrink-0">
                {remunerationLabel}
              </span>
            )}
          </div>
          {(shift as any).name && (shift as any).roleName && (shift as any).name !== (shift as any).roleName && (
            <p className="text-xs text-muted-foreground truncate">{(shift as any).name}</p>
          )}
        </div>
      </div>

      {/* Row 2: Timings Net */}
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="text-sm text-foreground/80">
          {formatTimeDisplay(startTime.slice(0, 5))} -{' '}
          {formatTimeDisplay(endTime.slice(0, 5))}
        </span>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 text-muted-foreground border-border"
        >
          {netHours}h net
        </Badge>
      </div>

      {/* Row 3: Breaks */}
      {totalBreak > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <Coffee className="h-3.5 w-3.5 text-muted-foreground/70" />
          <span className="text-xs text-muted-foreground">
            {paidBreak > 0 && (
              <span className="text-emerald-400/70">
                {paidBreak}m paid
              </span>
            )}
            {paidBreak > 0 && unpaidBreak > 0 && ' + '}
            {unpaidBreak > 0 && (
              <span>{unpaidBreak}m unpaid</span>
            )}
          </span>
        </div>
      )}

      {/* Row 4: <target employment type> */}
      <div className="flex items-center gap-2">
        <Briefcase className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="text-xs text-muted-foreground">
          {employmentTypeLabel}
        </span>
      </div>
    </div>
  );
};
