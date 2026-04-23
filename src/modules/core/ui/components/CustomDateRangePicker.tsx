import React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, RefreshCcw } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import { DateRange } from 'react-day-picker';

export interface CustomDateRangePickerProps {
    startDate: Date;
    endDate: Date;
    onDateChange: (start: Date, end: Date) => void;
    className?: string;
    disabled?: boolean;
}

export const CustomDateRangePicker: React.FC<CustomDateRangePickerProps> = ({
    startDate,
    endDate,
    onDateChange,
    className,
    disabled = false
}) => {
    const { isDark } = useTheme();

    const [isStartOpen, setIsStartOpen] = React.useState(false);
    const [isEndOpen, setIsEndOpen] = React.useState(false);

    const handleStartSelect = (date: Date | undefined) => {
        if (date) {
            let newEnd = endDate;
            if (date > newEnd) {
                newEnd = date;
            }
            onDateChange(date, newEnd);
            setIsStartOpen(false);
        }
    };

    const handleEndSelect = (date: Date | undefined) => {
        if (date) {
            let newStart = startDate;
            if (date < newStart) {
                newStart = date;
            }
            onDateChange(newStart, date);
            setIsEndOpen(false);
        }
    };

    const handleTodayClick = () => {
        const today = new Date();
        onDateChange(today, today);
    };

    const isTodaySelected = format(startDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') && 
                            format(endDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

    const buttonBaseCls = cn(
        "flex items-center gap-2 h-10 lg:h-11 px-2.5 lg:px-4 rounded-xl transition-all font-black tabular-nums text-[10px] lg:text-xs",
        isDark 
            ? "bg-[#1c2333] text-white hover:bg-[#252d40]" 
            : "bg-white/80 text-slate-900 border border-slate-200/50 shadow-sm hover:bg-white"
    );

    return (
        <div className={cn(
            "flex flex-wrap items-center gap-2 transition-all sm:w-auto w-full",
            className
        )}>
            {/* Start Date */}
            <Popover open={isStartOpen} onOpenChange={setIsStartOpen}>
                <PopoverTrigger asChild>
                    <button disabled={disabled} className={buttonBaseCls}>
                        <CalendarIcon className="w-3.5 h-3.5 opacity-50" />
                        <span>
                            <span className="hidden lg:inline">{format(startDate, 'EEEE ')}</span>
                            {format(startDate, 'dd-MM-yy')}
                        </span>
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                        initialFocus
                        mode="single"
                        selected={startDate}
                        onSelect={handleStartSelect}
                        defaultMonth={startDate}
                    />
                </PopoverContent>
            </Popover>

            <span className={cn("text-xs font-bold px-1", isDark ? "text-white/30" : "text-slate-400")}>|</span>

            {/* End Date */}
            <Popover open={isEndOpen} onOpenChange={setIsEndOpen}>
                <PopoverTrigger asChild>
                    <button disabled={disabled} className={buttonBaseCls}>
                        <CalendarIcon className="w-3.5 h-3.5 opacity-50" />
                        <span>
                            <span className="hidden lg:inline">{format(endDate, 'EEEE ')}</span>
                            {format(endDate, 'dd-MM-yy')}
                        </span>
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                        initialFocus
                        mode="single"
                        selected={endDate}
                        onSelect={handleEndSelect}
                        defaultMonth={endDate}
                    />
                </PopoverContent>
            </Popover>
            
            {/* Today Button */}
            <Button
                variant={isTodaySelected ? "default" : "ghost"}
                size="sm"
                onClick={handleTodayClick}
                disabled={disabled}
                className={cn(
                    "h-10 lg:h-11 px-3 lg:px-4 font-black uppercase text-[10px] tracking-wider rounded-xl transition-all sm:ml-0 ml-auto",
                    !isTodaySelected && (isDark ? "bg-[#1c2333] text-white/70 hover:text-white hover:bg-[#252d40]" : "bg-slate-100 text-slate-700 hover:bg-slate-200"),
                    isTodaySelected && "shadow-sm"
                )}
            >
                <div className="flex items-center gap-1.5">
                    <RefreshCcw className="w-3 h-3 opacity-50 lg:hidden" />
                    <span>Today</span>
                </div>
            </Button>
        </div>
    );
};
