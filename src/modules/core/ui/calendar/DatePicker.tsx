import * as React from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import type { CaptionLayout, Matcher, ModifiersClassNames } from 'react-day-picker';

import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';

/**
 * DatePicker — the single-date popover picker.
 *
 * The one control for "pick a day". Every header, function bar and form field
 * that used to assemble its own Popover + Calendar + trigger button now renders
 * this, so the trigger label, the Monday-start grid, the focus behaviour and the
 * accessible name are identical everywhere.
 */
export interface DatePickerProps {
  value: Date | undefined;
  onChange: (date: Date) => void;

  /** Accessible name for the trigger, e.g. "Start date". Required — an
   *  icon-and-date trigger has no name a screen reader can use otherwise. */
  label: string;
  /** Show the label as visible text before the date. Default false. */
  showLabel?: boolean;

  /** `date-fns` format for the trigger. Default `d MMM yyyy` (Australian order). */
  displayFormat?: string;
  /** Trigger text when `value` is undefined. */
  placeholder?: string;

  disabled?: boolean;
  /** Days that cannot be picked. */
  disabledDates?: Matcher | Matcher[];
  fromDate?: Date;
  toDate?: Date;

  /**
   * Month/year dropdowns instead of prev/next arrows. Use with `fromYear`/
   * `toYear` when the user may need to jump far from the current month.
   */
  captionLayout?: CaptionLayout;
  fromYear?: number;
  toYear?: number;

  /**
   * Extra day flags, e.g. shading the whole week a single pick will imply.
   * Paired with `modifiersClassNames`.
   */
  modifiers?: Record<string, Matcher | Matcher[]>;
  modifiersClassNames?: ModifiersClassNames;

  /** Extra content below the grid, e.g. a "Today" shortcut. */
  footer?: React.ReactNode;

  className?: string;
  triggerClassName?: string;
  align?: 'start' | 'center' | 'end';
  /** Replaces the default trigger button entirely. Must accept a ref. */
  children?: React.ReactNode;
}

export function DatePicker({
  value,
  onChange,
  label,
  showLabel = false,
  displayFormat = 'd MMM yyyy',
  placeholder = 'Select date',
  disabled = false,
  disabledDates,
  fromDate,
  toDate,
  captionLayout,
  fromYear,
  toYear,
  modifiers,
  modifiersClassNames,
  footer,
  className,
  triggerClassName,
  align = 'start',
  children,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const handleSelect = (date: Date | undefined) => {
    if (!date) return;
    onChange(date);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={value ? `${label}: ${format(value, displayFormat)}` : label}
            className={cn('justify-start gap-2 font-medium', !value && 'text-muted-foreground', triggerClassName)}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
            {showLabel && <span className="text-muted-foreground">{label}</span>}
            <span>{value ? format(value, displayFormat) : placeholder}</span>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('w-auto p-0', className)} align={align}>
        <Calendar
          // Moves focus into the grid on open and back to the trigger on close
          // — Radix's Popover handles the return leg.
          initialFocus
          mode="single"
          selected={value}
          onSelect={handleSelect}
          defaultMonth={value}
          disabled={disabledDates}
          fromDate={fromDate}
          toDate={toDate}
          captionLayout={captionLayout}
          fromYear={fromYear}
          toYear={toYear}
          modifiers={modifiers}
          modifiersClassNames={modifiersClassNames}
          footer={footer}
        />
      </PopoverContent>
    </Popover>
  );
}
DatePicker.displayName = 'DatePicker';
