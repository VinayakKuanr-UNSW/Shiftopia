
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from '@/modules/core/lib/utils';
import { buttonVariants } from '@/modules/core/ui/primitives/button';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-4 pointer-events-auto", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center mb-2",
        caption_label: "text-sm font-semibold text-foreground",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-8 w-8 bg-transparent p-0 opacity-60 hover:opacity-100 hover:bg-accent transition-all duration-200 border-none"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex mb-1",
        head_cell:
          "text-muted-foreground rounded-lg w-10 h-10 font-medium text-[0.8rem] flex items-center justify-center",
        row: "flex w-full mt-1",
        cell: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
          "h-10 w-10 rounded-lg transition-all duration-200",
          "[&:has([aria-selected].day-range-end)]:rounded-r-lg [&:has([aria-selected].day-range-start)]:rounded-l-lg",
          "[&:has([aria-selected].day-outside)]:bg-accent/30",
          "[&:has([aria-selected])]:bg-accent/20",
          "first:[&:has([aria-selected])]:rounded-l-lg last:[&:has([aria-selected])]:rounded-r-lg"
        ),
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-10 w-10 p-0 font-normal aria-selected:opacity-100 rounded-lg transition-all duration-200",
          "hover:bg-accent hover:text-accent-foreground hover:scale-105",
          "focus:bg-accent focus:text-accent-foreground focus:scale-105"
        ),
        day_range_end: "day-range-end rounded-r-lg",
        day_range_start: "day-range-start rounded-l-lg",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground shadow-md scale-105",
        day_today: "bg-accent/50 text-accent-foreground font-semibold border border-accent",
        day_outside:
          "day-outside text-muted-foreground/40 opacity-50 aria-selected:bg-accent/30 aria-selected:text-muted-foreground aria-selected:opacity-60",
        day_disabled: "text-muted-foreground/30 opacity-30 cursor-not-allowed",
        day_range_middle:
          "aria-selected:bg-accent/40 aria-selected:text-accent-foreground rounded-none",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
