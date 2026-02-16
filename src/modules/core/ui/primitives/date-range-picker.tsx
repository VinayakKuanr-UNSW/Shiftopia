
import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { DateRange } from "react-day-picker";
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';

interface DateRangePickerProps {
  value?: DateRange;
  onChange: (value: DateRange | undefined) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function DateRangePicker({ 
  value, 
  onChange, 
  className, 
  placeholder = "Pick a date range",
  disabled = false
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const formatDateRange = (range: DateRange | undefined) => {
    if (!range?.from) return placeholder;
    if (!range.to) return format(range.from, "MMM dd, yyyy");
    return `${format(range.from, "MMM dd")} - ${format(range.to, "MMM dd, yyyy")}`;
  };

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(undefined);
  };

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date-range"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start text-left font-normal h-11 px-4",
              "border-2 border-border/50 hover:border-border transition-all duration-200",
              "bg-background hover:bg-accent/5",
              !value?.from && "text-muted-foreground",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            <CalendarIcon className="mr-3 h-4 w-4 opacity-70" />
            <span className="flex-1">{formatDateRange(value)}</span>
            {value?.from && !disabled && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-1 hover:bg-destructive/10 hover:text-destructive ml-2"
                onClick={clearSelection}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent 
          className="w-auto p-0 bg-background border-2 shadow-xl" 
          align="start"
          sideOffset={8}
        >
          <div className="p-4">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={value?.from}
              selected={value}
              onSelect={(range) => {
                onChange(range);
                if (range?.from && range?.to) {
                  setIsOpen(false);
                }
              }}
              numberOfMonths={2}
              className="rounded-lg"
            />
            {value?.from && value?.to && (
              <div className="mt-4 p-3 bg-accent/10 rounded-lg border">
                <p className="text-sm font-medium text-center">
                  Selected range: {formatDateRange(value)}
                </p>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
