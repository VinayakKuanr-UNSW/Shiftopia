import React, { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, isSameDay, isSameMonth, isWithinInterval, getDay, isMonday, startOfDay, addDays } from 'date-fns';
import { isSydneyToday, isPublicHoliday } from '@/modules/core/lib/date.utils';
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
    /** Minimum navigable date (optional) */
    minDate?: Date;
    /** Maximum navigable date (optional) */
    maxDate?: Date;
    /** Callback when a new range is selected */
    onRangeSelect: (startDate: Date) => void;
    /** Current display label */
    displayLabel: string;
}

export const CalendarRangePicker: React.FC<CalendarRangePickerProps> = ({
    selectedDate,
    viewType,
    minDate,
    maxDate,
    onRangeSelect,
    displayLabel,
}) => {
    const { isDark } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const [viewingMonth, setViewingMonth] = useState(selectedDate);

    // Sync viewingMonth when selectedDate or isOpen changes
    React.useEffect(() => {
        if (isOpen) {
            setViewingMonth(selectedDate);
        }
    }, [selectedDate, isOpen]);

    // Days of the week header — Australian style (Monday start)
    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Get all days in the viewing month
    const calendarDays = useMemo(() => {
        const start = startOfMonth(viewingMonth);
        const end = endOfMonth(viewingMonth);
        const days = eachDayOfInterval({ start, end });

        // Pad start with previous month's final days (Monday start)
        const startDayOfWeek = (getDay(start) + 6) % 7;
        const paddedDays: Date[] = [];
        for (let i = startDayOfWeek; i > 0; i--) {
            paddedDays.push(new Date(start.getFullYear(), start.getMonth(), 1 - i));
        }
        paddedDays.push(...days);

        // Pad end with next month's starting days to fill 6 weeks (42 cells)
        const remaining = 42 - paddedDays.length;
        for (let i = 1; i <= remaining; i++) {
            paddedDays.push(new Date(end.getFullYear(), end.getMonth(), end.getDate() + i));
        }

        return paddedDays;
    }, [viewingMonth]);

    // Calculate range end based on view type
    const getRangeEnd = (start: Date): Date => {
        const normalizedStart = startOfDay(start);
        switch (viewType) {
            case 'day':
                return normalizedStart;
            case '3day':
                return addDays(normalizedStart, 2);
            case 'week':
                return addDays(normalizedStart, 6);
            case 'month':
                return endOfMonth(normalizedStart);
            default:
                return normalizedStart;
        }
    };

    // Check if a day is within the current selection
    const isInSelectedRange = (day: Date): boolean => {
        const start = startOfDay(selectedDate);
        const end = startOfDay(getRangeEnd(start));
        const current = startOfDay(day);
        return isWithinInterval(current, { start, end });
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

        // WEEK VIEW: Allow selecting any day, snapping handled by parent
        if (viewType === 'week') {
            return true;
        }

        // For day and 3day views, check if there's enough room for the range relative to maxDate
        const requiredSize = getRequiredRangeSize();
        if (!maxDate) return true;

        const rangeEnd = addDays(day, requiredSize - 1);
        return startOfDay(rangeEnd) <= startOfDay(maxDate);
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
    // Can navigate to previous/next month?
    const canGoPrevious = !minDate || startOfMonth(viewingMonth) > startOfMonth(minDate);
    const canGoNext = !maxDate || endOfMonth(viewingMonth) < endOfMonth(maxDate);

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
                align="center"
                sideOffset={8}
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
                                value={selectedDate.getMonth()}
                                onChange={(e) => {
                                    const newMonth = parseInt(e.target.value);
                                    const year = selectedDate.getFullYear();
                                    const firstOfMonth = new Date(year, newMonth, 1);
                                    onRangeSelect(firstOfMonth);
                                    setIsOpen(false);
                                }}
                                className={cn(
                                    "flex-1 px-3 py-2 rounded-lg border text-sm cursor-pointer font-medium",
                                    isDark
                                        ? "bg-gray-800 border-gray-700 text-white"
                                        : "bg-white border-gray-300 text-gray-900"
                                )}
                            >
                                {Array.from({ length: 12 }, (_, i) => (
                                    <option key={i} value={i}>
                                        {format(new Date(2026, i, 1), 'MMMM')}
                                    </option>
                                ))}
                            </select>

                            {/* Year Dropdown */}
                            <select
                                value={selectedDate.getFullYear()}
                                onChange={(e) => {
                                    const newYear = parseInt(e.target.value);
                                    const month = selectedDate.getMonth();
                                    const firstOfMonth = new Date(newYear, month, 1);
                                    onRangeSelect(firstOfMonth);
                                    setIsOpen(false);
                                }}
                                className={cn(
                                    "w-28 px-3 py-2 rounded-lg border text-sm cursor-pointer font-medium",
                                    isDark
                                        ? "bg-gray-800 border-gray-700 text-white"
                                        : "bg-white border-gray-300 text-gray-900"
                                )}
                            >
                                {Array.from({ length: 5 }, (_, i) => {
                                    const year = 2024 + i;
                                    return (
                                        <option key={year} value={year}>
                                            {year}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>

                        <div className={cn(
                            "text-xs text-center font-medium",
                            isDark ? "text-white/40" : "text-gray-400"
                        )}>
                            Full month will be selected ({format(selectedDate, 'MMMM yyyy')})
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

                        <div className="grid grid-cols-7 gap-1">
                            {calendarDays.map((day, idx) => {
                                const isSelected = isInSelectedRange(day);
                                const canSelect = isSelectable(day);
                                const isToday = isSydneyToday(day);
                                const isCurrentViewingMonth = isSameMonth(day, viewingMonth);
                                const dayOfWeek = getDay(day); // Sunday - 0, Monday - 1, ..., Saturday - 6
                                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                                const isHoliday = isPublicHoliday(day);

                                return (
                                    <button
                                        key={day.toISOString()}
                                        onClick={() => handleDayClick(day)}
                                        disabled={!canSelect}
                                        className={cn(
                                            "h-9 w-9 rounded-full text-sm font-medium transition-all flex items-center justify-center",
                                            // Base styles
                                            !canSelect && "opacity-30 cursor-not-allowed",
                                            canSelect && "cursor-pointer hover:bg-emerald-500/10",
                                            // Selected range styles
                                            isSelected && "bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]",
                                            // Today indicator
                                            isToday && !isSelected && (isDark ? "text-blue-400" : "text-blue-600"),
                                            // Default text color
                                            !isSelected && isCurrentViewingMonth && !isWeekend && !isHoliday && (isDark ? "text-white" : "text-gray-900"),
                                            !isSelected && !isCurrentViewingMonth && (isDark ? "text-white/30" : "text-gray-400"),
                                            // Weekend styling (Text only)
                                            isWeekend && !isSelected && (isDark ? "text-rose-400" : "text-rose-600"),
                                            // Holiday styling (Text only)
                                            isHoliday && !isSelected && (isDark ? "text-yellow-400" : "text-yellow-600")
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
