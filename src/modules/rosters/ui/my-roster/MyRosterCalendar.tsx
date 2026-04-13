import React from 'react';
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Mail,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import { CalendarView } from '@/modules/rosters/hooks/useRosterView';
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
  onViewChange: (view: CalendarView) => void;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  getShiftsForDate: (date: Date, options?: { includeContinuations?: boolean }) => ShiftWithDetails[];
  shifts: Shift[];
  pendingOfferCount: number;
  offerDates: Set<string>;
  onOffersClick: () => void;
}

const VIEW_OPTIONS: Array<{ value: CalendarView; label: string; short: string }> = [
  { value: 'day',   label: 'Day',   short: 'D'  },
  { value: '3day',  label: '3-Day', short: '3D' },
  { value: 'week',  label: 'Week',  short: 'W'  },
  { value: 'month', label: 'Month', short: 'M'  },
];

const MyRosterCalendar: React.FC<MyRosterCalendarProps> = ({
  view,
  onViewChange,
  selectedDate,
  onDateChange,
  getShiftsForDate,
  shifts: _shifts,
  pendingOfferCount,
  offerDates,
  onOffersClick,
}) => {
  const handlePrevious = () => {
    const d = new Date(selectedDate);
    if (view === 'day')   d.setDate(d.getDate() - 1);
    if (view === '3day')  d.setDate(d.getDate() - 3);
    if (view === 'week')  d.setDate(d.getDate() - 7);
    if (view === 'month') d.setMonth(d.getMonth() - 1);
    onDateChange(d);
  };

  const handleNext = () => {
    const d = new Date(selectedDate);
    if (view === 'day')   d.setDate(d.getDate() + 1);
    if (view === '3day')  d.setDate(d.getDate() + 3);
    if (view === 'week')  d.setDate(d.getDate() + 7);
    if (view === 'month') d.setMonth(d.getMonth() + 1);
    onDateChange(d);
  };

  const getDateRangeText = () => {
    switch (view) {
      case 'day':
        return format(selectedDate, 'EEE, MMM d, yyyy');
      case '3day': {
        const end = addDays(selectedDate, 2);
        return selectedDate.getMonth() === end.getMonth()
          ? `${format(selectedDate, 'MMM d')} – ${format(end, 'd, yyyy')}`
          : `${format(selectedDate, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
      }
      case 'week': {
        const s = startOfWeek(selectedDate);
        const e = endOfWeek(selectedDate);
        return s.getMonth() === e.getMonth()
          ? `${format(s, 'MMM d')} – ${format(e, 'd, yyyy')}`
          : `${format(s, 'MMM d')} – ${format(e, 'MMM d, yyyy')}`;
      }
      case 'month':
        return format(selectedDate, 'MMMM yyyy');
      default:
        return '';
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Unified toolbar ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 md:px-4 py-2 border-b border-border bg-card/70 backdrop-blur-xl">

        {/* Date navigation — left */}
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePrevious}
            className="h-8 w-8 rounded-lg flex-shrink-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-semibold text-foreground hover:bg-muted/60 transition-colors min-w-0 max-w-[220px] md:max-w-none truncate">
                <CalendarIcon className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <span className="truncate">{getDateRangeText()}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="px-3 py-2 border-b border-border">
                <p className="text-xs text-muted-foreground">
                  {view === 'day'   && 'Select a day'}
                  {view === '3day'  && 'Select starting day'}
                  {view === 'week'  && 'Select any day in the week'}
                  {view === 'month' && 'Select any day in the month'}
                </p>
              </div>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && onDateChange(d)}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleNext}
            className="h-8 w-8 rounded-lg flex-shrink-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onDateChange(new Date())}
            className="h-8 px-3 text-xs font-bold rounded-lg flex-shrink-0 hidden sm:flex"
          >
            Today
          </Button>
        </div>

        {/* View tabs — center (desktop: text labels, mobile: letter labels) */}
        <div className="flex items-center bg-muted/50 rounded-lg p-0.5 gap-0.5 flex-shrink-0">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onViewChange(opt.value)}
              className={cn(
                'px-2.5 py-1.5 rounded-md text-[11px] font-black uppercase tracking-widest transition-all',
                view === opt.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className="sm:hidden">{opt.short}</span>
              <span className="hidden sm:inline">{opt.label}</span>
            </button>
          ))}
        </div>

        {/* Today (mobile only — doesn't fit beside the date text) */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDateChange(new Date())}
          className="h-8 px-3 text-xs font-bold rounded-lg flex-shrink-0 sm:hidden"
        >
          Today
        </Button>

        {/* Offers button — desktop only (mobile uses FAB) */}
        <button
          onClick={onOffersClick}
          className={cn(
            'hidden md:flex items-center gap-2 h-8 pl-3 pr-3.5 rounded-lg text-xs font-bold flex-shrink-0',
            'border border-border bg-card hover:bg-muted/60 transition-colors relative',
            pendingOfferCount > 0 && 'border-amber-500/50 text-amber-600 dark:text-amber-400'
          )}
        >
          <Mail className="h-3.5 w-3.5" />
          <span>Offers</span>
          {pendingOfferCount > 0 && (
            <span className="min-w-[18px] h-4.5 bg-amber-500 text-black font-black text-[10px] flex items-center justify-center rounded-full px-1 leading-none">
              {pendingOfferCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Calendar view ───────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
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
          <MonthView
            date={selectedDate}
            getShiftsForDate={getShiftsForDate}
            pendingOfferCount={pendingOfferCount}
            offerDates={offerDates}
          />
        )}
      </div>
    </div>
  );
};

export default MyRosterCalendar;
