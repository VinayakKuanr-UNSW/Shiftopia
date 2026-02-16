import React from 'react';
import { Roster } from '@/types';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday
} from 'date-fns';

interface RosterMonthViewProps {
  roster: Roster | null;
  selectedDate: Date;
  readOnly?: boolean;
  onDateClick?: (date: Date) => void;
}

export const RosterMonthView: React.FC<RosterMonthViewProps> = ({
  roster,
  selectedDate,
  readOnly,
  onDateClick
}) => {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  
  const allDays = eachDayOfInterval({ 
    start: calendarStart, 
    end: calendarEnd 
  });
  
  // Group the days into weeks
  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];
  
  allDays.forEach(day => {
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(day);
  });
  
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }
  
  const getDayContent = (day: Date) => {
    const isCurrentMonth = isSameMonth(day, selectedDate);
    const isSelectedDay = isSameDay(day, selectedDate);
    const shiftsCount = isSelectedDay && roster ? countShifts(roster) : 0;
    
    return (
      <div className={`
        h-24 p-1 border ${
          isToday(day) 
            ? 'border-blue-500/50' 
            : isCurrentMonth 
              ? 'border-white/10' 
              : 'border-white/5'
        } ${
          isSelectedDay 
            ? 'bg-purple-900/20' 
            : isCurrentMonth 
              ? 'bg-black/20' 
              : 'bg-black/10'
        }
      `}>
        <div className="flex justify-between items-start">
          <span className={`
            text-xs px-1.5 py-0.5 rounded-full ${
              isToday(day) 
                ? 'bg-blue-500 text-white' 
                : isCurrentMonth 
                  ? 'text-white/80' 
                  : 'text-white/40'
            }
          `}>
            {format(day, 'd')}
          </span>
          
          {shiftsCount > 0 && (
            <span className="text-xs bg-purple-500/80 text-white px-1.5 py-0.5 rounded-full">
              {shiftsCount}
            </span>
          )}
        </div>
        
        {isSelectedDay && roster && (
          <div className="mt-1 space-y-1 overflow-hidden max-h-16">
            {roster.groups.slice(0, 2).map((group, index) => (
              <div 
                key={index}
                className="text-xxs p-1 truncate rounded"
                style={{ backgroundColor: `${group.color}20` }}
              >
                {group.name}
              </div>
            ))}
            
            {roster.groups.length > 2 && (
              <div className="text-xxs text-white/60 text-center">
                +{roster.groups.length - 2} more
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
  
  const countShifts = (roster: Roster) => {
    let count = 0;
    roster.groups.forEach(group => {
      group.subGroups.forEach(subGroup => {
        count += subGroup.shifts.length;
      });
    });
    return count;
  };
  
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px]">
        <div className="grid grid-cols-7 gap-0 mb-1 text-center">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="p-2 text-xs text-white/70 font-medium">
              {day}
            </div>
          ))}
        </div>
        
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 gap-0">
            {week.map((day, dayIndex) => (
              <div key={dayIndex}>
                {getDayContent(day)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default RosterMonthView;
