import React, { useState, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Filter, PanelRight, Search, Users, Lock, Unlock } from 'lucide-react';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { Calendar as CalendarComponent } from '@/modules/core/ui/primitives/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { Button } from '@/modules/core/ui/primitives/button';
import { ToggleGroup, ToggleGroupItem } from '@/modules/core/ui/primitives/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { CalendarView } from '@/hooks/useRosterView';
import { useHotkeys } from 'react-hotkeys-hook';

interface RosterHeaderProps {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  onApplyTemplate: () => void;
  onSaveRoster: () => void;
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  navigatePrevious: () => void;
  navigateNext: () => void;
  isLocked?: boolean;
  onToggleLock?: () => void;
  hasUnsavedChanges?: boolean;
}

export const RosterHeader: React.FC<RosterHeaderProps> = ({
  sidebarOpen,
  toggleSidebar,
  selectedDate,
  onDateChange,
  onApplyTemplate,
  onSaveRoster,
  view,
  onViewChange,
  navigatePrevious,
  navigateNext,
  isLocked = false,
  onToggleLock,
  hasUnsavedChanges = false
}) => {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // Keyboard shortcuts
  useHotkeys('left', navigatePrevious, [navigatePrevious]);
  useHotkeys('right', navigateNext, [navigateNext]);
  useHotkeys('1', () => onViewChange('day'), [onViewChange]);
  useHotkeys('2', () => onViewChange('3day'), [onViewChange]);
  useHotkeys('3', () => onViewChange('week'), [onViewChange]);
  useHotkeys('4', () => onViewChange('month'), [onViewChange]);
  useHotkeys('t', onApplyTemplate, [onApplyTemplate]);
  useHotkeys('mod+s', (e) => {
    e.preventDefault();
    if (hasUnsavedChanges) {
      onSaveRoster();
    }
  }, [onSaveRoster, hasUnsavedChanges]);

  // Get date display based on view
  const getDateDisplay = () => {
    // Convert current selected date to Sydney time for correct "Day of Week" and math
    const zonedSelected = toZonedTime(selectedDate, SYDNEY_TZ);

    switch (view) {
      case 'day':
        return format(zonedSelected, 'EEEE, MMMM d, yyyy');
      case '3day': {
        const endDate = new Date(zonedSelected);
        endDate.setDate(zonedSelected.getDate() + 2);
        return `${format(zonedSelected, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`;
      }
      case 'week': {
        const weekStart = new Date(zonedSelected);
        const day = zonedSelected.getDay();
        const diff = zonedSelected.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        weekStart.setDate(diff);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
      }
      case 'month':
        return format(zonedSelected, 'MMMM yyyy');
      default:
        return format(zonedSelected, 'EEEE, MMMM d, yyyy');
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-2xl font-bold text-white flex items-center">
          <Users className="mr-2 text-purple-400" size={24} />
          Roster Management
        </h1>

        <div className="flex space-x-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 bg-white/5 border-white/10"
                  onClick={() => { }}
                >
                  <Search className="h-4 w-4 text-white/80 hover:text-white" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Search (Press / to focus)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 bg-white/5 border-white/10"
                  onClick={() => { }}
                >
                  <Filter className="h-4 w-4 text-white/80 hover:text-white" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Filter</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {onToggleLock && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 bg-white/5 border-white/10"
                    onClick={onToggleLock}
                  >
                    {isLocked ? (
                      <Unlock className="h-4 w-4 text-white/80 hover:text-white" />
                    ) : (
                      <Lock className="h-4 w-4 text-white/80 hover:text-white" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isLocked ? "Unlock roster" : "Lock roster to prevent edits"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className={`p-2 rounded-full transition-all duration-200 ${sidebarOpen ? 'bg-purple-500/20 text-purple-300' : 'bg-white/5 text-white/80 hover:bg-white/10 hover:text-white'
                    }`}
                  onClick={toggleSidebar}
                >
                  <PanelRight className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Toggle sidebar</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-center">
        <div className="flex items-center space-x-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={navigatePrevious}
                  className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-all duration-200"
                >
                  <ChevronLeft className="h-5 w-5 text-white/80 hover:text-white" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Previous {view === 'day' ? 'Day' : view === '3day' ? '3 Days' : view === 'week' ? 'Week' : 'Month'} (←)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
            <PopoverTrigger asChild>
              <Button className="flex items-center space-x-2 px-4 py-2 rounded-md bg-white/5 hover:bg-white/10 transition-all duration-200">
                <Calendar className="h-5 w-5 text-blue-400" />
                <span className="font-medium text-white">
                  {getDateDisplay()}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-black/80 backdrop-blur-md border border-white/10">
              <CalendarComponent
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    onDateChange(date);
                    setIsCalendarOpen(false);
                  }
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={navigateNext}
                  className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-all duration-200"
                >
                  <ChevronRight className="h-5 w-5 text-white/80 hover:text-white" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Next {view === 'day' ? 'Day' : view === '3day' ? '3 Days' : view === 'week' ? 'Week' : 'Month'} (→)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex mt-2 md:mt-0 space-x-2">
          <ToggleGroup type="single" value={view} onValueChange={(value) => value && onViewChange(value as CalendarView)}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value="day" aria-label="Day View">
                    Day
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Day View (1)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value="3day" aria-label="3-Day View">
                    3-Day
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>
                  <p>3-Day View (2)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value="week" aria-label="Week View">
                    Week
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Week View (3)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value="month" aria-label="Month View">
                    Month
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Month View (4)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </ToggleGroup>
        </div>

        <div className="flex mt-2 md:mt-0 space-x-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onApplyTemplate}
                  className="button-outline"
                  disabled={view !== 'day'}
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Apply Template
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Apply Template (T)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onSaveRoster}
                  className="button-blue"
                  disabled={!hasUnsavedChanges}
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Save Roster
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Save Roster (Ctrl+S / Cmd+S)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
};
