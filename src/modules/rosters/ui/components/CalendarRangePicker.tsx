import React, { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, isSameDay, isSameMonth, isWithinInterval, getDay, isMonday, startOfDay } from 'date-fns';
import { isSydneyToday } from '@/modules/core/lib/date.utils';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

export type ViewType = 'day' | '3day' | 'week' | 'month';

interface CalendarRangePickerProps {
    /** Currently selected start date */
    selectedDate: Date;
    /** View type determines the range size */
    viewType: ViewType;
    /** Month boundaries from template */
    monthStart: Date;
    monthEnd: Date;
    /** Callback when a new range is selected */
    onRangeSelect: (startDate: Date) => void;
    /** Current display label */
    displayLabel: string;
}

export const CalendarRangePicker: React.FC<CalendarRangePickerProps> = ({
    selectedDate,
    viewType,
    monthStart,
    monthEnd,
    onRangeSelect,
    displayLabel,
}) => {
    const { isDark } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const [viewingMonth, setViewingMonth] = useState(monthStart);

    // Days of the week header
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Get all days in the viewing month
    const calendarDays = useMemo(() => {
        const start = startOfMonth(viewingMonth);
        const end = endOfMonth(viewingMonth);
        const days = eachDayOfInterval({ start, end });

        // Pad start with empty slots for proper day alignment
        const startDayOfWeek = getDay(start);
        const paddedDays: (Date | null)[] = [];
        for (let i = 0; i < startDayOfWeek; i++) {
            paddedDays.push(null);
        }
        paddedDays.push(...days);

        return paddedDays;
    }, [viewingMonth]);

    // Calculate range end based on view type
    const getRangeEnd = (start: Date): Date => {
        switch (viewType) {
            case 'day':
                return start;
            case '3day':
                return new Date(Math.min(new Date(start).setDate(start.getDate() + 2), monthEnd.getTime()));
            case 'week':
                return new Date(Math.min(new Date(start).setDate(start.getDate() + 6), monthEnd.getTime()));
            case 'month':
                return monthEnd;
            default:
                return start;
        }
    };

    // Check if a day is within the current selection
    const isInSelectedRange = (day: Date): boolean => {
        const rangeEnd = getRangeEnd(selectedDate);
        return isWithinInterval(day, { start: selectedDate, end: rangeEnd });
    };

    // Get required days for the view type
    const getRequiredRangeSize = (): number => {
        switch (viewType) {
            case 'day': return 1;
            case '3day': return 3;
            case 'week': return 7;
            case 'month': return 1; // Month view always selects full month
            default: return 1;
        }
    };

    // Check if a day is selectable (resulting range must fit within template month)
    const isSelectable = (day: Date): boolean => {
        // Normalize dates for comparison (avoid time component issues)
        const normalizedDay = startOfDay(day);

        // Removed strict monthStart/monthEnd clamp to allow navigating any month

        // For month view, any day in month is fine
        if (viewType === 'month') {
            return true;
        }

        // WEEK VIEW: Only Mondays selectable - allow ALL Mondays (ghost cells handle overflow)
        if (viewType === 'week') {
            return isMonday(day); // All Mondays in template range are valid
        }

        // For day and 3day views, check if there's enough room for the range
        const requiredSize = getRequiredRangeSize();
        const dayOfMonth = day.getDate();
        const lastDayOfMonth = monthEnd.getDate();
        const remainingDays = lastDayOfMonth - dayOfMonth + 1;
        return remainingDays >= requiredSize;
    };

    // Handle day click
    const handleDayClick = (day: Date) => {
        if (!isSelectable(day)) return;
        onRangeSelect(day);
        setIsOpen(false);
    };

    // Navigate months
    const goToPreviousMonth = () => setViewingMonth(addMonths(viewingMonth, -1));
    const goToNextMonth = () => setViewingMonth(addMonths(viewingMonth, 1));

    // Can navigate to previous/next month?
    const canGoPrevious = startOfMonth(viewingMonth) > startOfMonth(monthStart);
    const canGoNext = endOfMonth(viewingMonth) < endOfMonth(monthEnd);

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className={cn(
                        "h-9 px-3 gap-2 font-medium text-sm",
                        isDark
                            ? "bg-white/5 border-white/10 text-white hover:bg-white/10"
                            : "bg-white border-gray-200 text-gray-900 hover:bg-gray-50"
                    )}
                >
                    <Calendar className="h-4 w-4" />
                    {displayLabel}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className={cn(
                    "w-[320px] p-4",
                    isDark
                        ? "bg-[#1a2744] border-white/10"
                        : "bg-white border-gray-200 shadow-lg"
                )}
                align="start"
            >
                {viewType === 'month' ? (
                    // MONTH VIEW: Show Month/Year Picker with custom dropdowns
                    <div className="space-y-4">
                        <div className={cn(
                            "text-lg font-semibold text-center",
                            isDark ? "text-white" : "text-gray-900"
                        )}>
                            Select Month
                        </div>

                        {/* Month and Year Dropdowns */}
                        <div className="flex gap-2">
                            {/* Month Dropdown */}
                            <select
                                value={monthStart.getMonth()}
                                onChange={(e) => {
                                    const newMonth = parseInt(e.target.value);
                                    const year = monthStart.getFullYear();
                                    const firstOfMonth = new Date(year, newMonth, 1);
                                    onRangeSelect(firstOfMonth);
                                    setIsOpen(false);
                                }}
                                className={cn(
                                    "flex-1 px-3 py-2 rounded-lg border text-sm cursor-pointer",
                                    isDark
                                        ? "bg-gray-800 border-gray-700 text-white"
                                        : "bg-white border-gray-300 text-gray-900"
                                )}
                            >
                                {Array.from({ length: 12 }, (_, i) => {
                                    const isTemplateMonth = i === monthStart.getMonth();
                                    return (
                                        <option
                                            key={i}
                                            value={i}
                                        >
                                            {format(new Date(2026, i, 1), 'MMMM')}
                                        </option>
                                    );
                                })}
                            </select>

                            {/* Year Dropdown */}
                            <select
                                value={monthStart.getFullYear()}
                                onChange={(e) => {
                                    const newYear = parseInt(e.target.value);
                                    const month = monthStart.getMonth();
                                    const firstOfMonth = new Date(newYear, month, 1);
                                    onRangeSelect(firstOfMonth);
                                    setIsOpen(false);
                                }}
                                className={cn(
                                    "w-24 px-3 py-2 rounded-lg border text-sm cursor-pointer",
                                    isDark
                                        ? "bg-gray-800 border-gray-700 text-white"
                                        : "bg-white border-gray-300 text-gray-900"
                                )}
                            >
                                {Array.from({ length: 5 }, (_, i) => {
                                    const year = 2024 + i;
                                    const isTemplateYear = year === monthStart.getFullYear();
                                    return (
                                        <option
                                            key={year}
                                            value={year}
                                        >
                                            {year}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>

                        <div className={cn(
                            "text-xs text-center",
                            isDark ? "text-white/40" : "text-gray-400"
                        )}>
                            Full month will be selected ({format(monthStart, 'MMMM yyyy')})
                        </div>
                    </div>
                ) : (
                    // DAY / 3-DAY / WEEK VIEW: Show Calendar Grid
                    <>
                        {/* Month Header */}
                        <div className="flex items-center justify-between mb-4">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={goToPreviousMonth}
                                disabled={!canGoPrevious}
                                className={cn(
                                    "h-8 w-8 p-0",
                                    isDark ? "text-white/60 hover:text-white" : "text-gray-600 hover:text-gray-900"
                                )}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className={cn(
                                "text-lg font-semibold",
                                isDark ? "text-white" : "text-gray-900"
                            )}>
                                {format(viewingMonth, 'MMMM yyyy')}
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={goToNextMonth}
                                disabled={!canGoNext}
                                className={cn(
                                    "h-8 w-8 p-0",
                                    isDark ? "text-white/60 hover:text-white" : "text-gray-600 hover:text-gray-900"
                                )}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Week Days Header */}
                        <div className="grid grid-cols-7 gap-1 mb-2">
                            {weekDays.map((day) => (
                                <div
                                    key={day}
                                    className={cn(
                                        "text-center text-xs font-medium py-1",
                                        isDark ? "text-white/40" : "text-gray-400",
                                        // Highlight Monday column for week view
                                        viewType === 'week' && day === 'Mon' && (isDark ? "text-emerald-400" : "text-emerald-600")
                                    )}
                                >
                                    {day}
                                </div>
                            ))}
                        </div>

                        {/* Calendar Grid */}
                        <div className="grid grid-cols-7 gap-1">
                            {calendarDays.map((day, idx) => {
                                if (day === null) {
                                    return <div key={`empty-${idx}`} className="h-9" />;
                                }

                                const isSelected = isSameDay(day, selectedDate);
                                const isInRange = isInSelectedRange(day);
                                const canSelect = isSelectable(day);
                                const isToday = isSydneyToday(day);
                                const inCurrentMonth = isSameMonth(day, viewingMonth);

                                return (
                                    <button
                                        key={day.toISOString()}
                                        onClick={() => handleDayClick(day)}
                                        disabled={!canSelect}
                                        className={cn(
                                            "h-9 w-full rounded-md text-sm font-medium transition-all",
                                            // Base styles
                                            !canSelect && "opacity-30 cursor-not-allowed",
                                            canSelect && "cursor-pointer hover:bg-emerald-500/20",
                                            // Selected range styles
                                            isInRange && "bg-emerald-500 text-white hover:bg-emerald-600",
                                            isSelected && "ring-2 ring-emerald-300",
                                            // Today indicator
                                            isToday && !isInRange && (isDark ? "text-purple-400" : "text-purple-600"),
                                            // Default text color
                                            !isInRange && inCurrentMonth && (isDark ? "text-white" : "text-gray-900"),
                                            !isInRange && !inCurrentMonth && (isDark ? "text-white/30" : "text-gray-400")
                                        )}
                                    >
                                        {format(day, 'd')}
                                    </button>
                                );
                            })}
                        </div>

                        {/* View Type Hint */}
                        <div className={cn(
                            "mt-4 pt-3 border-t text-xs text-center",
                            isDark ? "border-white/10 text-white/40" : "border-gray-200 text-gray-400"
                        )}>
                            {viewType === 'day' && 'Click any day to select'}
                            {viewType === '3day' && 'Click to select 3-day range'}
                            {viewType === 'week' && 'Click a Monday to select 7-day range'}
                        </div>
                    </>
                )}
            </PopoverContent>
        </Popover>
    );
};

export default CalendarRangePicker;
