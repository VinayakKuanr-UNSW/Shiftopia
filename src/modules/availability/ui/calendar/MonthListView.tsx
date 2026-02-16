
import React, { useState, useMemo } from 'react';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, isToday, isTomorrow, isYesterday, isBefore, startOfDay } from 'date-fns';
import { Plus, Calendar, CheckCircle, Ban } from 'lucide-react';

import { useAvailability } from '../../state/useAvailability';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Card } from '@/modules/core/ui/primitives/card';
import { cn } from '@/modules/core/lib/utils';

interface MonthListViewProps {
  onSelectDate: (date: Date) => void;
  isLocked?: boolean;
}

// Helper function to parse time string to minutes since midnight
const timeToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

// Helper function to get ALL time segments for a day, including unset gaps
type TimeSegment = { startTime: string; endTime: string; status: string };

const getAllTimeSegments = (timeSlots: TimeSegment[]): TimeSegment[] => {
  if (!timeSlots || timeSlots.length === 0) {
    return [{ startTime: '00:00', endTime: '23:59', status: 'Unset' }];
  }

  // Sort slots by start time
  const sortedSlots = [...timeSlots].sort((a, b) =>
    timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
  );

  const allSegments: TimeSegment[] = [];
  let currentMinute = 0;
  const endOfDay = 24 * 60 - 1;

  for (const slot of sortedSlots) {
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);

    if (slotStart > currentMinute) {
      allSegments.push({
        startTime: `${String(Math.floor(currentMinute / 60)).padStart(2, '0')}:${String(currentMinute % 60).padStart(2, '0')}`,
        endTime: slot.startTime,
        status: 'Unset'
      });
    }

    allSegments.push({
      startTime: slot.startTime,
      endTime: slot.endTime,
      status: slot.status || 'Available'
    });

    currentMinute = Math.max(currentMinute, slotEnd + 1);
  }

  if (currentMinute <= endOfDay) {
    allSegments.push({
      startTime: `${String(Math.floor(currentMinute / 60)).padStart(2, '0')}:${String(currentMinute % 60).padStart(2, '0')}`,
      endTime: '23:59',
      status: 'Unset'
    });
  }

  return allSegments;
};

const getStatusDotColor = (status: string) => {
  switch (status) {
    case 'Available': return 'bg-green-500';
    case 'Unavailable': return 'bg-red-500';
    case 'Mixed': return 'bg-yellow-500';
    case 'Unset': return 'bg-gray-400';
    default: return 'bg-gray-400';
  }
};

// Determine the overall status for a day based on its time slots
const determineDayStatus = (timeSlots: TimeSegment[]): 'Available' | 'Unavailable' | 'Mixed' | 'Not set' => {
  if (!timeSlots || timeSlots.length === 0) {
    return 'Not set';
  }

  // Check if full day coverage (00:00 to 23:59 or 24:00)
  const isFullDayCoverage = timeSlots.some(slot => {
    const start = timeToMinutes(slot.startTime);
    const end = timeToMinutes(slot.endTime);
    // Consider 23:59 or end=0 (meaning 24:00) as full day
    return start === 0 && (end >= 1439 || end === 0);
  });

  // If full day coverage with a single slot, return that status
  if (isFullDayCoverage && timeSlots.length === 1) {
    const status = timeSlots[0].status?.toLowerCase();
    if (status?.includes('unavailable')) return 'Unavailable';
    return 'Available';
  }

  // Check if all slots have the same status
  const allAvailable = timeSlots.every(s => !s.status?.toLowerCase().includes('unavailable'));
  const allUnavailable = timeSlots.every(s => s.status?.toLowerCase().includes('unavailable'));

  if (isFullDayCoverage && allAvailable) return 'Available';
  if (isFullDayCoverage && allUnavailable) return 'Unavailable';

  // Any partial coverage or mixed statuses = Mixed
  return 'Mixed';
};


export function MonthListView({ onSelectDate, isLocked = false }: MonthListViewProps) {
  const {
    selectedMonth,
    monthlyAvailabilities,
    getDayAvailability,
    getDayStatusColor,
    isDateLocked,
    applyPreset,
    availabilityPresets
  } = useAvailability();

  const { toast } = useToast();
  const [selectedPresets, setSelectedPresets] = useState<Record<string, string>>({});
  const [appliedPresets, setAppliedPresets] = useState<Record<string, boolean>>({});

  // Generate all days of the month
  const allDaysInMonth = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end = endOfMonth(selectedMonth);
    return eachDayOfInterval({ start, end });
  }, [selectedMonth]);

  const getRelativeDateLabel = (date: Date) => {
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    if (isYesterday(date)) return 'Yesterday';
    return null;
  };

  const handleAddAvailability = (date: Date) => {
    if (isLocked || isDateLocked(date)) {
      toast({
        title: "Cannot Modify",
        description: "This date is locked and cannot be modified.",
        variant: "destructive"
      });
      return;
    }
    onSelectDate(date);
  };

  const handleApplyPreset = async (date: Date, presetId: string) => {
    if (!presetId) return;

    if (isLocked || isDateLocked(date)) {
      toast({
        title: "Cannot Apply Preset",
        description: "This date is locked and cannot be modified.",
        variant: "destructive"
      });
      return;
    }

    const dateKey = format(date, 'yyyy-MM-dd');

    const success = await applyPreset({
      presetId,
      startDate: date,
      endDate: date
    });

    if (success) {
      toast({
        title: "Preset Applied",
        description: `Applied preset to ${format(date, 'MMMM dd, yyyy')}`,
      });

      // Show visual confirmation for 2 seconds
      setAppliedPresets(prev => ({ ...prev, [dateKey]: true }));
      setTimeout(() => {
        setAppliedPresets(prev => ({ ...prev, [dateKey]: false }));
      }, 2000);

      // Clear the selection after a brief delay
      setTimeout(() => {
        setSelectedPresets(prev => ({ ...prev, [dateKey]: '' }));
      }, 500);
    } else {
      toast({
        title: "Failed to Apply Preset",
        description: "There was an error applying the preset. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handlePresetChange = (date: Date, presetId: string) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    setSelectedPresets(prev => ({ ...prev, [dateKey]: presetId }));

    if (presetId) {
      handleApplyPreset(date, presetId);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          Availabilities for {format(selectedMonth, 'MMMM yyyy')}
        </h2>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span>{allDaysInMonth.length} days</span>
          {isLocked && (
            <Badge variant="destructive" className="ml-2">
              Locked
            </Badge>
          )}
        </div>
      </div>

      {/* Date Cards List */}
      <div className="space-y-3">
        {allDaysInMonth.map((date) => {
          const dateKey = format(date, 'yyyy-MM-dd');
          const existingAvailability = getDayAvailability(date);
          const today = startOfDay(new Date());
          const isPastDate = isBefore(startOfDay(date), today);
          const locked = isLocked || isDateLocked(date) || isPastDate;
          const relativeLabel = getRelativeDateLabel(date);
          const isPresetApplied = appliedPresets[dateKey];

          // Calculate actual day status from time slots
          const dayStatus = existingAvailability?.timeSlots
            ? determineDayStatus(existingAvailability.timeSlots)
            : 'Not set';

          return (
            <Card
              key={dateKey}
              className={cn(
                "p-4 transition-all duration-200",
                locked && "opacity-60 bg-gray-50 dark:bg-gray-800/50",
                isPastDate && "opacity-40 cursor-not-allowed",
                existingAvailability && "border-l-4",
                dayStatus === 'Available' && "border-l-green-500",
                dayStatus === 'Unavailable' && "border-l-red-500",
                dayStatus === 'Mixed' && "border-l-yellow-500",
                dayStatus === 'Not set' && existingAvailability && "border-l-gray-400",
                isPresetApplied && "bg-green-50 border-green-200"
              )}
            >


              <div className="flex items-center justify-between">
                {/* Date Information */}
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div>
                      <h4 className="font-medium text-base flex items-center gap-2">
                        {format(date, 'EEEE, MMMM d, yyyy')}
                        {isPresetApplied && (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        )}
                      </h4>
                      <div className="flex items-center gap-2 mt-1">
                        {relativeLabel && (
                          <Badge variant="secondary" className="text-xs">
                            {relativeLabel}
                          </Badge>
                        )}
                        {existingAvailability && (
                          <Badge className={cn(
                            "text-xs text-white",
                            dayStatus === 'Available' && "bg-green-500",
                            dayStatus === 'Unavailable' && "bg-red-500",
                            dayStatus === 'Mixed' && "bg-yellow-500",
                            dayStatus === 'Not set' && "bg-gray-400"
                          )}>
                            {dayStatus}
                          </Badge>
                        )}

                        {!existingAvailability && (
                          <Badge variant="outline" className="text-xs">
                            No availability set
                          </Badge>
                        )}
                        {isPastDate && (
                          <Badge variant="secondary" className="text-xs flex items-center gap-1">
                            <Ban className="h-3 w-3" />
                            Past Date
                          </Badge>
                        )}
                        {locked && !isPastDate && (
                          <Badge variant="destructive" className="text-xs">
                            Locked
                          </Badge>
                        )}

                      </div>
                    </div>
                  </div>

                  {/* Time Slots Preview with ALL segments including unset gaps */}
                  {existingAvailability?.timeSlots && existingAvailability.timeSlots.length > 0 && (() => {
                    const allSegments = getAllTimeSegments(existingAvailability.timeSlots);
                    return (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {allSegments.map((segment, i) => (
                          <span key={i} className="flex items-center gap-1 text-sm">
                            <div className={cn("w-2 h-2 rounded-full", getStatusDotColor(segment.status))} />
                            {segment.startTime}-{segment.endTime}
                            <span className="text-xs text-muted-foreground">({segment.status})</span>
                          </span>
                        ))}
                      </div>
                    );
                  })()}


                  {/* Notes Preview */}
                  {existingAvailability?.notes && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                      {existingAvailability.notes}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  {/* Preset Selector */}
                  <Select
                    value={selectedPresets[dateKey] || ''}
                    onValueChange={(value) => handlePresetChange(date, value)}
                    disabled={locked}
                  >
                    <SelectTrigger className={cn(
                      "w-40",
                      isPresetApplied && "border-green-500 bg-green-50"
                    )}>
                      <SelectValue placeholder="Apply preset" />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-white">
                      {availabilityPresets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Add/Edit Availability Button */}
                  <Button
                    onClick={() => handleAddAvailability(date)}
                    disabled={locked}
                    size="sm"
                    className="flex items-center gap-2"
                    variant={existingAvailability ? "outline" : "default"}
                  >
                    <Plus className="h-4 w-4" />
                    {existingAvailability ? 'Edit' : 'Add'} Availability
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {allDaysInMonth.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No days found for this month.
        </div>
      )}
    </div>
  );
}
