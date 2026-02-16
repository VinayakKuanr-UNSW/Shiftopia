
import React from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addDays, subDays, startOfWeek, endOfWeek } from 'date-fns';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { Button } from '@/modules/core/ui/primitives/button';

interface CalendarViewProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  view?: 'day' | 'week' | 'month';
  monthName?: string;
}

const CalendarView: React.FC<CalendarViewProps> = ({
  selectedDate,
  onDateChange,
  view = 'day',
  monthName
}) => {
  const handlePrevious = () => {
    switch (view) {
      case 'day':
        onDateChange(subDays(selectedDate, 1));
        break;
      case 'week':
        onDateChange(subDays(selectedDate, 7));
        break;
      case 'month':
        const prevMonth = new Date(selectedDate);
        prevMonth.setMonth(prevMonth.getMonth() - 1);
        onDateChange(prevMonth);
        break;
    }
  };

  const handleNext = () => {
    switch (view) {
      case 'day':
        onDateChange(addDays(selectedDate, 1));
        break;
      case 'week':
        onDateChange(addDays(selectedDate, 7));
        break;
      case 'month':
        const nextMonth = new Date(selectedDate);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        onDateChange(nextMonth);
        break;
    }
  };

  const getDateDisplay = () => {
    if (monthName) {
      return monthName;
    }
    
    switch (view) {
      case 'day':
        return format(selectedDate, 'EEEE, MMMM d, yyyy');
      case 'week':
        const start = startOfWeek(selectedDate);
        const end = endOfWeek(selectedDate);
        return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
      case 'month':
        return format(selectedDate, 'MMMM yyyy');
    }
  };

  return (
    <div className="flex items-center space-x-4">
      <Button 
        onClick={handlePrevious}
        variant="outline" 
        size="icon"
        className="bg-white/5 border-white/10"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      
      <Popover>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            className="min-w-[240px] justify-start text-left font-normal bg-white/5 border-white/10"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {getDateDisplay()}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 bg-gray-900/95 backdrop-blur-xl border-gray-800">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => date && onDateChange(date)}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      
      <Button 
        onClick={handleNext}
        variant="outline" 
        size="icon"
        className="bg-white/5 border-white/10"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default CalendarView;
