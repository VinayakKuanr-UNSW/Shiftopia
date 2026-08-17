import * as React from 'react';
import { format, isAfter } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import type { DateRange, Matcher } from 'react-day-picker';

import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { Separator } from '@/modules/core/ui/primitives/separator';

/**
 * DateRangePicker — the single range picker.
 *
 * Replaces four separate implementations: `core/ui/primitives/date-range-picker`
 * (dead), `core/ui/components/CustomDateRangePicker` (two independent
 * single-date popovers, so the range was never shown as a range),
 * `templates/ui/components/DateRangePicker` (two stacked calendars) and
 * `rosters/ui/components/CalendarRangePicker` (a hand-rolled 42-cell grid).
 *
 * One popover, one `mode="range"` grid, so dragging or clicking start→end
 * highlights the whole span — which none of the four previously did.
 */

export type { DateRange };

export interface DateRangePreset {
  label: string;
  /** Resolved when the preset is clicked, so "this week" is always current. */
  getRange: () => DateRange;
}

export interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;

  /** Accessible name for the trigger, e.g. "Reporting period". */
  label: string;
  /** Show the label as visible text before the range. Default false. */
  showLabel?: boolean;

  /** `date-fns` format for each end of the range. Default `d MMM yyyy`. */
  displayFormat?: string;
  placeholder?: string;

  /** Shortcut buttons rendered beside the grid (This week, This month…). */
  presets?: DateRangePreset[];

  /** How many months to show side by side. Default 2 on `sm` and up, 1 below. */
  numberOfMonths?: 1 | 2;

  disabled?: boolean;
  disabledDates?: Matcher | Matcher[];
  fromDate?: Date;
  toDate?: Date;

  /** Offer a Clear button. Default true. */
  clearable?: boolean;

  className?: string;
  triggerClassName?: string;
  align?: 'start' | 'center' | 'end';
}

function formatRange(range: DateRange | undefined, fmt: string, placeholder: string): string {
  if (!range?.from) return placeholder;
  if (!range.to) return `${format(range.from, fmt)} – …`;
  return `${format(range.from, fmt)} – ${format(range.to, fmt)}`;
}

export function DateRangePicker({
  value,
  onChange,
  label,
  showLabel = false,
  displayFormat = 'd MMM yyyy',
  placeholder = 'Select date range',
  presets,
  numberOfMonths,
  disabled = false,
  disabledDates,
  fromDate,
  toDate,
  clearable = true,
  className,
  triggerClassName,
  align = 'start',
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);

  // Two months is the useful default on desktop, but it overflows a phone.
  const isNarrow = useIsNarrowViewport();
  const months = numberOfMonths ?? (isNarrow ? 1 : 2);

  const summary = formatRange(value, displayFormat, placeholder);

  const handleSelect = (next: DateRange | undefined) => {
    onChange(next);
    // Close once a complete range exists, so the common case is one gesture.
    if (next?.from && next.to && !isAfter(next.from, next.to)) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={value?.from ? `${label}: ${summary}` : label}
          className={cn('justify-start gap-2 font-medium', !value?.from && 'text-muted-foreground', triggerClassName)}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
          {showLabel && <span className="text-muted-foreground">{label}</span>}
          <span className="truncate">{summary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-auto p-0', className)} align={align}>
        <div className="flex flex-col sm:flex-row">
          {presets && presets.length > 0 && (
            <>
              <div
                className="flex flex-row gap-1 overflow-x-auto p-2 sm:flex-col sm:overflow-visible sm:p-3"
                role="group"
                aria-label={`${label} presets`}
              >
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-start whitespace-nowrap text-xs font-medium"
                    onClick={() => {
                      onChange(preset.getRange());
                      setOpen(false);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <Separator orientation="vertical" className="hidden sm:block" />
            </>
          )}

          <div>
            <Calendar
              initialFocus
              mode="range"
              selected={value}
              onSelect={handleSelect}
              defaultMonth={value?.from}
              numberOfMonths={months}
              disabled={disabledDates}
              fromDate={fromDate}
              toDate={toDate}
            />
            {clearable && (
              <div className="flex justify-end border-t border-border p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!value?.from}
                  onClick={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
DateRangePicker.displayName = 'DateRangePicker';

/** `sm` breakpoint — one month fits, two do not. */
function useIsNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );

  React.useEffect(() => {
    const mql = window.matchMedia('(max-width: 639px)');
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener('change', onChange);
    setIsNarrow(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isNarrow;
}
