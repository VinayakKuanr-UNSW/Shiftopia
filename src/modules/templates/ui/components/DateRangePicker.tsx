import React, { useState } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { cn } from '@/modules/core/lib/utils';

interface DateRange {
  start: Date | undefined;
  end: Date | undefined;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  value,
  onChange,
  placeholder = 'Select date range',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelectStart = (date: Date | undefined) => {
    onChange({
      start: date,
      end: value.end && date && date > value.end ? undefined : value.end,
    });
  };

  const handleSelectEnd = (date: Date | undefined) => {
    onChange({
      start: value.start,
      end: date,
    });
  };

  const formatDateRange = () => {
    if (value.start && value.end) {
      return `${format(value.start, 'MMM d, yyyy')} - ${format(value.end, 'MMM d, yyyy')}`;
    }
    if (value.start) {
      return `${format(value.start, 'MMM d, yyyy')} - ...`;
    }
    return placeholder;
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal bg-background border-border',
            !value.start && !value.end && 'text-muted-foreground'
          )}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {formatDateRange()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-card border-border backdrop-blur-xl" align="center">
        <div className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Start Date
            </label>
            <Calendar
              mode="single"
              selected={value.start}
              onSelect={handleSelectStart}
              disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
              className="rounded-md border border-border"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              End Date
            </label>
            <Calendar
              mode="single"
              selected={value.end}
              onSelect={handleSelectEnd}
              disabled={(date) => {
                const today = new Date(new Date().setHours(0, 0, 0, 0));
                return date < today || (value.start ? date < value.start : false);
              }}
              className="rounded-md border border-border"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onChange({ start: undefined, end: undefined });
                setIsOpen(false);
              }}
              className="bg-transparent border-border"
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => setIsOpen(false)}
              disabled={!value.start || !value.end}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
