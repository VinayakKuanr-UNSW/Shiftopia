import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { Shift } from '@/modules/rosters';
import { ShiftRuleHeader } from '@/modules/rosters/ui/components/ShiftRuleHeader';
import { resolveGroupVariant } from '@/modules/rosters/domain/shift-ui';

interface ShiftPillProps {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
  onClick?: (e?: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
}

const ShiftPill: React.FC<ShiftPillProps> = ({
  shift,
  groupName,
  groupColor,
  subGroupName,
  onClick,
  className,
  style,
}) => {
  const groupVariant = React.useMemo(() => {
    return resolveGroupVariant(shift, groupColor || groupName, subGroupName);
  }, [shift, groupColor, groupName, subGroupName]);

  const theme = React.useMemo(() => {
    switch (groupVariant) {
      case 'convention':
        return {
          bg: 'bg-blue-500/10 hover:bg-blue-500/20',
          border: 'border-blue-500/40',
          accent: 'bg-blue-500',
          text: 'text-blue-700 dark:text-blue-300',
          time: 'text-blue-700 dark:text-blue-300'
        };
      case 'exhibition':
        return {
          bg: 'bg-emerald-500/10 hover:bg-emerald-500/20',
          border: 'border-emerald-500/40',
          accent: 'bg-emerald-500',
          text: 'text-emerald-700 dark:text-emerald-300',
          time: 'text-emerald-700 dark:text-emerald-300'
        };
      case 'theatre':
        return {
          bg: 'bg-rose-500/10 hover:bg-rose-500/20',
          border: 'border-rose-500/40',
          accent: 'bg-rose-500',
          text: 'text-rose-700 dark:text-rose-300',
          time: 'text-rose-700 dark:text-rose-300'
        };
      case 'cutaway':
        return {
          bg: 'bg-amber-500/10 hover:bg-amber-500/20',
          border: 'border-amber-500/40',
          accent: 'bg-amber-500',
          text: 'text-amber-700 dark:text-amber-300',
          time: 'text-amber-600/60 dark:text-amber-400/60'
        };
      default:
        return {
          bg: 'bg-slate-500/10 hover:bg-slate-500/20',
          border: 'border-slate-500/40',
          accent: 'bg-slate-500',
          text: 'text-slate-700 dark:text-slate-300',
          time: 'text-slate-700 dark:text-slate-300'
        };
    }
  }, [groupVariant]);

  const startTime = shift.start_time.slice(0, 5);
  const endTime = shift.end_time.slice(0, 5);

  // Check if we are in a tall container (Day/Week view) or short (Month view)
  // Day/Week views pass a style object with a numeric or string height.
  // Month view passes undefined style or no height.
  const isVertical = style?.height && parseInt(style.height as string) > 30;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      style={style}
      className={cn(
        "group relative w-full flex rounded-md border text-left transition-all duration-300 active:scale-[0.98] overflow-hidden",
        isVertical ? "flex-col p-2.5 h-full" : "items-center gap-2 px-2 h-6 py-0",
        theme.bg,
        theme.border,
        className
      )}
    >
      {/* Accent Bar */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-1",
        theme.accent
      )} />
      
      {isVertical ? (
        <div className="flex flex-col h-full min-w-0 w-full">
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className={cn("text-[11px] font-bold font-mono tabular-nums shrink-0", theme.time)}>
              {startTime} - {endTime}
            </span>
          </div>
          <span className={cn("text-[13px] font-bold leading-tight break-words uppercase tracking-tight", theme.text)}>
            {shift.roles?.name || 'Shift'}
          </span>

          {/* Only show more info if there is enough height */}
          {parseInt(style?.height as string) > 70 && (
            <div className="mt-auto pt-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 opacity-80">
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] truncate">
                  {groupName}
                </span>
              </div>
              {subGroupName && (
                // Was 9px at 30% opacity — nominally present, effectively
                // invisible, and nowhere near 4.5:1 in either theme.
                <span className="pl-3 text-[11px] font-medium text-muted-foreground truncate uppercase tracking-wide">
                  {subGroupName}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden w-full h-full">
          <span className={cn("text-[11px] font-bold font-mono tabular-nums shrink-0", theme.time)}>
            {startTime}
          </span>
          <span className={cn("text-[11px] font-bold truncate uppercase tracking-tight flex-1", theme.text)}>
            {shift.roles?.name || 'Shift'}
          </span>
        </div>
      )}


      
    </button>
  );
};

export default ShiftPill;
