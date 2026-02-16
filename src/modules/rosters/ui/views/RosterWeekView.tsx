import React, { useState } from 'react';
import { Roster } from '@/types';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns';
import { Clock, ChevronDown, ChevronUp, Lock } from 'lucide-react';
import { ShiftChip } from '../ShiftChip';
import { cn } from '@/modules/core/lib/utils';

interface RosterWeekViewProps {
  roster: Roster | null;
  selectedDate: Date;
  readOnly?: boolean;
  onShiftClick?: (shiftId: string, groupId: number, subGroupId: number, date: Date) => void;
}

export const RosterWeekView: React.FC<RosterWeekViewProps> = ({
  roster,
  selectedDate,
  readOnly,
  onShiftClick
}) => {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  // Get the days of the current week
  const startDay = startOfWeek(selectedDate);
  const endDay = endOfWeek(selectedDate);
  const weekDays = eachDayOfInterval({ start: startDay, end: endDay });

  const countShiftsForDay = (roster: Roster | null, date: Date) => {
    if (!roster) return 0;

    // In a real app, we would check the date from the roster
    // For demonstration, we'll count all shifts in the roster for the selected date
    // and none for other dates
    if (isSameDay(date, selectedDate)) {
      let count = 0;
      roster.groups.forEach(group => {
        group.subGroups.forEach(subGroup => {
          count += subGroup.shifts.length;
        });
      });
      return count;
    }

    return 0;
  };

  const getGroupsCountForDay = (roster: Roster | null, date: Date) => {
    if (!roster || !isSameDay(date, selectedDate)) return 0;
    return roster.groups.length;
  };

  const toggleDay = (dateStr: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) {
        next.delete(dateStr);
      } else {
        next.add(dateStr);
      }
      return next;
    });
  };

  const getAllShiftsForDay = (roster: Roster | null, day: Date) => {
    if (!roster) return [];
    const shifts: Array<{
      shift: any;
      groupId: number;
      subGroupId: number;
      groupName: string;
      groupColor: string;
      subGroupName: string;
    }> = [];

    roster.groups.forEach(group => {
      group.subGroups.forEach(subGroup => {
        subGroup.shifts.forEach(shift => {
          shifts.push({
            shift,
            groupId: group.id,
            subGroupId: subGroup.id,
            groupName: group.name,
            groupColor: group.color,
            subGroupName: subGroup.name,
          });
        });
      });
    });

    return shifts;
  };

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-7 gap-3 min-w-[1200px]">
        {weekDays.map((day, index) => {
          const dateStr = day.toISOString();
          const isExpanded = expandedDays.has(dateStr);
          const isSelected = isSameDay(day, selectedDate);
          const isCurrentDay = isSameDay(day, new Date());
          const isPast = day < new Date(new Date().setHours(0, 0, 0, 0));
          const shifts = isSelected ? getAllShiftsForDay(roster, day) : [];
          const shiftCount = shifts.length;

          return (
            <div
              key={index}
              className={cn(
                'rounded-lg border transition-all relative',
                isCurrentDay
                  ? 'bg-purple-900/30 border-purple-500/50 ring-2 ring-purple-500/30'
                  : isSelected
                    ? 'bg-blue-900/20 border-blue-500/30'
                    : isPast
                      ? 'bg-black/30 border-white/5 opacity-60'
                      : 'bg-black/20 border-white/10'
              )}
            >
              {isPast && (
                <div className="absolute top-2 right-2">
                  <Lock className="h-3 w-3 text-white/30" />
                </div>
              )}
              <div className="p-3">
                <div className="text-center mb-2">
                  <div className={cn(
                    'font-bold text-sm',
                    isCurrentDay ? 'text-purple-300' : isSelected ? 'text-blue-300' : 'text-white'
                  )}>
                    {format(day, 'EEE')}
                  </div>
                  <div className="text-xs text-white/70">{format(day, 'MMM d')}</div>
                </div>

                <div className={cn(
                  'text-center p-2 rounded-lg mb-2',
                  isCurrentDay ? 'bg-purple-900/30' : isSelected ? 'bg-black/30' : 'bg-black/20'
                )}>
                  <div className="text-2xl font-bold">
                    {shiftCount}
                  </div>
                  <div className="text-xs text-white/60">shifts</div>
                </div>

                {isSelected && shiftCount > 0 && (
                  <button
                    onClick={() => toggleDay(dateStr)}
                    className="w-full py-1.5 px-2 rounded bg-blue-600/20 hover:bg-blue-600/30 transition-colors flex items-center justify-center gap-1 text-xs text-white/80"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-3 h-3" />
                        Hide
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3" />
                        Show
                      </>
                    )}
                  </button>
                )}
              </div>

              {isSelected && isExpanded && shifts.length > 0 && (
                <div className="px-2 pb-3 space-y-2 max-h-96 overflow-y-auto">
                  {shifts.map((item, idx) => (
                    <ShiftChip
                      key={idx}
                      shift={item.shift}
                      groupColor={item.groupColor}
                      size="sm"
                      onClick={() => onShiftClick?.(item.shift.id, item.groupId, item.subGroupId, day)}
                    />
                  ))}
                </div>
              )}

              {!isSelected && (
                <div className="px-2 pb-3">
                  <div className="text-center text-white/40 text-xs p-2">
                    Select day
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RosterWeekView;
