import React from 'react';
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  startOfMonth,
  endOfMonth,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import { CalendarView } from '@/hooks/useRosterView';
import { cn } from '@/modules/core/lib/utils';
import DayView from './DayView';
import ThreeDayView from './ThreeDayView';
import WeekView from './WeekView';
import MonthView from './MonthView';
import { Shift } from '@/modules/rosters';

interface ShiftWithDetails {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
}

interface MyRosterCalendarProps {
  view: CalendarView;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  getShiftsForDate: (date: Date) => ShiftWithDetails[];
  shifts: Shift[];
}

const MyRosterCalendar: React.FC<MyRosterCalendarProps> = ({
  view,
  selectedDate,
  onDateChange,
  getShiftsForDate,
  shifts,
}) => {
  // Navigation handlers
  const handlePrevious = () => {
    const newDate = new Date(selectedDate);
    switch (view) {
      case 'day':
        newDate.setDate(newDate.getDate() - 1);
        break;
      case '3day':
        newDate.setDate(newDate.getDate() - 3);
        break;
      case 'week':
        newDate.setDate(newDate.getDate() - 7);
        break;
      case 'month':
        newDate.setMonth(newDate.getMonth() - 1);
        break;
    }
    onDateChange(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(selectedDate);
    switch (view) {
      case 'day':
        newDate.setDate(newDate.getDate() + 1);
        break;
      case '3day':
        newDate.setDate(newDate.getDate() + 3);
        break;
      case 'week':
        newDate.setDate(newDate.getDate() + 7);
        break;
      case 'month':
        newDate.setMonth(newDate.getMonth() + 1);
        break;
    }
    onDateChange(newDate);
  };

  const handleToday = () => {
    onDateChange(new Date());
  };

  // Get date range text based on view mode
  const getDateRangeText = () => {
    switch (view) {
      case 'day':
        return format(selectedDate, 'EEEE, MMMM d, yyyy');
      case '3day': {
        const endDate = addDays(selectedDate, 2);
        if (selectedDate.getMonth() === endDate.getMonth()) {
          return `${format(selectedDate, 'MMM d')} – ${format(
            endDate,
            'd, yyyy'
          )}`;
        }
        return `${format(selectedDate, 'MMM d')} – ${format(
          endDate,
          'MMM d, yyyy'
        )}`;
      }
      case 'week': {
        const start = startOfWeek(selectedDate);
        const end = endOfWeek(selectedDate);
        if (start.getMonth() === end.getMonth()) {
          return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`;
        }
        return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
      }
      case 'month':
        return format(selectedDate, 'MMMM yyyy');
      default:
        return '';
    }
  };

  return (
    <div className="h-full flex flex-col p-2 md:p-4">
      {/* Navigation Header */}
      <div className="flex-shrink-0 flex items-center justify-between mb-3 gap-2">
        {/* Previous Button */}
        <Button
          onClick={handlePrevious}
          variant="outline"
          size="icon"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* Center: Date Display + Today Button */}
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="min-w-[180px] md:min-w-[260px] justify-center font-medium"
              >
                <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                <span className="truncate">{getDateRangeText()}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-0"
              align="center"
            >
              <div className="p-3 border-b border-border">
                <p className="text-xs text-muted-foreground">
                  {view === 'day' && 'Select a day'}
                  {view === '3day' && 'Select starting day'}
                  {view === 'week' && 'Select any day in the week'}
                  {view === 'month' && 'Select any day in the month'}
                </p>
              </div>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && onDateChange(date)}
                initialFocus
                className="rounded-lg"
              />
            </PopoverContent>
          </Popover>

          {/* Today Button */}
          <Button
            onClick={handleToday}
            variant="default"
            size="sm"
          >
            Today
          </Button>
        </div>

        {/* Next Button */}
        <Button
          onClick={handleNext}
          variant="outline"
          size="icon"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Calendar Views */}
      <div className="flex-1 min-h-0">
        {view === 'day' && (
          <DayView
            date={selectedDate}
            shifts={getShiftsForDate(selectedDate)}
          />
        )}

        {view === '3day' && (
          <ThreeDayView
            startDate={selectedDate}
            getShiftsForDate={getShiftsForDate}
          />
        )}

        {view === 'week' && (
          <WeekView date={selectedDate} getShiftsForDate={getShiftsForDate} />
        )}

        {view === 'month' && (
          <MonthView date={selectedDate} getShiftsForDate={getShiftsForDate} />
        )}
      </div>
    </div>
  );
};

export default MyRosterCalendar;
