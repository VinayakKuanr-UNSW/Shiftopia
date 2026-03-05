import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  PanelRight,
  Send,
  CalendarCheck,
  Zap,
  Layers,
  Box,
  Calendar,
  Users,
  CalendarDays,
  Briefcase,
  CopyPlus,
  Wand2,
  Activity,
} from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, isSameMonth } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
  useTemplates,
  useRostersLookup,
} from '@/modules/rosters/state/useRosterShifts';
import { ActivateRosterDialog } from '../dialogs/ActivateRosterDialog';
import { AutoScheduleModal } from '@/modules/rosters/ui/dialogs/AutoScheduleModal';
import { CalendarRangePicker } from './CalendarRangePicker';
import { RosterFilterPopover } from './RosterFilterPopover';
import { useRosterUI, RosterMode } from '@/modules/rosters/contexts/RosterUIContext';
import { ToggleGroup, ToggleGroupItem } from '@/modules/core/ui/primitives/toggle-group';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { ApplyTemplateDialog } from '@/modules/rosters/ui/dialogs/ApplyTemplateDialog';
import { useRosterStructure } from '../../state/useRosterStructure';

/* ============================================================
   TYPES
   ============================================================ */
export type ViewType = 'day' | '3day' | 'week' | 'month';

interface RosterData {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

interface TemplateData {
  id: string;
  name: string;
  description?: string;
  department_id: string;
  sub_department_id: string;
  status: string;
  published_month?: string;
  start_date?: string;
  end_date?: string;
}

interface RangeOption {
  label: string;
  startDate: Date;
  endDate: Date;
}

export interface RosterFunctionBarProps {
  selectedOrganizationId: string | null;
  selectedRosterId: string | null;

  onRosterChange: (id: string | null) => void;
  onTemplateChange?: (id: string | null, groups?: any[]) => void;
  onTemplateDatesChange?: (startDate: Date | undefined, endDate: Date | undefined) => void;

  selectedDepartmentId?: string | null;
  selectedSubDepartmentId?: string | null;

  selectedDate: Date;
  viewType: ViewType;
  onDateChange: (date: Date) => void;
  onViewTypeChange: (viewType: ViewType) => void;

  showAvailabilities: boolean;
  showUnfilledPanel: boolean;
  isRefreshing?: boolean;

  onAvailabilitiesToggle: () => void;
  onUnfilledPanelToggle: () => void;
  onRefresh: () => void;
  onFiltersClick: () => void;

  canEdit?: boolean;

  isBulkMode?: boolean;
  onBulkModeToggle?: () => void;
}

/* ============================================================
   ICON BUTTON COMPONENT
   ============================================================ */
const IconButton: React.FC<{
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  isActive?: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'ghost';
  className?: string;
}> = ({ icon, tooltip, onClick, isActive, isLoading, disabled, variant = 'default', className }) => {
  const variantClasses = {
    default: isActive
      ? 'bg-slate-200 dark:bg-white/15 text-slate-800 dark:text-white'
      : 'text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10',
    success: isActive
      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
      : 'text-slate-500 dark:text-white/60 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
    warning: isActive
      ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
      : 'text-slate-500 dark:text-white/60 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10',
    danger: isActive
      ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300'
      : 'text-slate-500 dark:text-white/60 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10',
    ghost: 'text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5',
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            disabled={disabled || isLoading}
            className={cn(
              'h-8 w-8 flex items-center justify-center rounded-lg transition-all',
              variantClasses[variant],
              disabled && 'opacity-30 cursor-not-allowed',
              isLoading && 'animate-pulse',
              className
            )}
          >
            {isLoading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              icon
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="text-[10px] uppercase font-bold bg-slate-900 border-white/10 text-white backdrop-blur-md"
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export const RosterFunctionBar: React.FC<RosterFunctionBarProps> = ({
  selectedOrganizationId,
  selectedDepartmentId,
  selectedSubDepartmentId,
  selectedRosterId,
  onRosterChange,
  onTemplateChange,
  onTemplateDatesChange,
  selectedDate,
  viewType,
  onDateChange,
  onViewTypeChange,
  showAvailabilities,
  showUnfilledPanel,
  isRefreshing,
  onAvailabilitiesToggle,
  onUnfilledPanelToggle,
  onRefresh,
  canEdit = true,
  isBulkMode = false,
  onBulkModeToggle,
}) => {
  const {
    activeMode,
    setActiveMode,
    isBucketView,
    setIsBucketView,
    selectedDepartmentIds,
    selectedSubDepartmentIds,
    navigateNext,
    navigatePrevious,
  } = useRosterUI();

  const queryClient = useQueryClient();

  const { data: rosters = [] } = useRostersLookup(
    selectedOrganizationId || undefined,
    {
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    }
  );
  const { data: templates = [] } = useTemplates(selectedSubDepartmentId || undefined, selectedDepartmentId || undefined);

  const [isActivateDialogOpen, setIsActivateDialogOpen] = useState(false);
  const [isApplyTemplateDialogOpen, setIsApplyTemplateDialogOpen] = useState(false);
  const [isAutoScheduleOpen, setIsAutoScheduleOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Auto-select template
  React.useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      const baseTemplate = templates.find((t: TemplateData) =>
        t.name.includes('Base Template')
      ) || templates[0];
      setSelectedTemplateId(baseTemplate.id);
      onTemplateChange?.(baseTemplate.id, undefined);
    }
  }, [templates, selectedTemplateId, onTemplateChange]);

  // Fetch structure for the selected date to know applied templates
  const { data: structures = [] } = useRosterStructure(
    selectedOrganizationId || undefined,
    format(selectedDate, 'yyyy-MM-dd'),
    format(selectedDate, 'yyyy-MM-dd'),
    {
      departmentIds: selectedDepartmentId ? [selectedDepartmentId] : [],
      subDepartmentIds: selectedSubDepartmentId ? [selectedSubDepartmentId] : (selectedDepartmentId ? [] : undefined)
    }
  );

  const currentRosterStructure = structures[0];
  const appliedCount = currentRosterStructure?.appliedTemplateIds?.length || 0;

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  const activeRangeBounds = React.useMemo(() => {
    // Broaden bounds to allow navigation within a 2-year window
    const now = new Date();
    const monthStart = startOfMonth(addMonths(now, -12));
    const monthEnd = endOfMonth(addMonths(now, 12));
    return { monthStart, monthEnd };
  }, []);

  // Compute the date range matching the currently viewed period for AutoScheduler
  const autoScheduleRange = React.useMemo(() => {
    switch (viewType) {
      case 'day':
        return { start: selectedDate, end: selectedDate };
      case '3day':
        return { start: selectedDate, end: addDays(selectedDate, 2) };
      case 'week':
        return { start: selectedDate, end: addDays(selectedDate, 6) };
      case 'month':
      default:
        return { start: startOfMonth(selectedDate), end: endOfMonth(selectedDate) };
    }
  }, [selectedDate, viewType]);

  React.useEffect(() => {
    if (onTemplateDatesChange) {
      onTemplateDatesChange(activeRangeBounds.monthStart, activeRangeBounds.monthEnd);
    }
  }, [activeRangeBounds, onTemplateDatesChange]);

  const displayLabel = React.useMemo(() => {
    switch (viewType) {
      case 'day': return format(selectedDate, 'MMM d, yyyy');
      case '3day': {
        const end = addDays(selectedDate, 2);
        return `${format(selectedDate, 'MMM d')} – ${format(end, isSameMonth(selectedDate, end) ? 'd' : 'MMM d')}`;
      }
      case 'week': {
        // Assume selectedDate is start of week
        const end = addDays(selectedDate, 6);
        return `${format(selectedDate, 'MMM d')} – ${format(end, isSameMonth(selectedDate, end) ? 'd' : 'MMM d')}`;
      }
      case 'month': return format(selectedDate, 'MMMM yyyy');
      default: return 'Select Date';
    }
  }, [viewType, selectedDate]);

  // Navigation use store actions now for consistency
  const handlePrevious = () => navigatePrevious();
  const handleNext = () => navigateNext();

  return (
    <div className="w-full h-16 flex-shrink-0 z-50 bg-white/90 dark:bg-slate-950/40 backdrop-blur-2xl border-b border-slate-200 dark:border-white/10 px-8 flex items-center shadow-sm dark:shadow-2xl relative">
      {/* Subtle top highlight for premium feel */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="w-full flex items-center justify-between">

        {/* Left Section: Context & Modes */}
        <div className="flex items-center gap-2">

          <ToggleGroup
            type="single"
            value={activeMode}
            onValueChange={(v) => v && setActiveMode(v as RosterMode)}
            className="bg-slate-100 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-xl p-1"
          >
            {[
              { id: 'group', icon: <Box className="h-4 w-4" />, label: 'Group' },
              { id: 'people', icon: <Users className="h-4 w-4" />, label: 'People' },
              { id: 'events', icon: <CalendarDays className="h-4 w-4" />, label: 'Events' },
              { id: 'roles', icon: <Briefcase className="h-4 w-4" />, label: 'Roles' },
            ].map((m) => (
              <ToggleGroupItem
                key={m.id}
                value={m.id}
                className="h-8 px-4 text-[11px] font-black uppercase tracking-wider rounded-lg data-[state=on]:bg-white dark:data-[state=on]:bg-white/10 data-[state=on]:text-slate-900 dark:data-[state=on]:text-white text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white/60 transition-all"
              >
                <div className="flex items-center gap-2">
                  {m.icon}
                  <span className="hidden xl:inline">{m.label}</span>
                </div>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* Center Section: Navigation & View */}
        <div className="flex items-center gap-6">
          <ToggleGroup
            type="single"
            value={viewType}
            onValueChange={(v) => v && onViewTypeChange(v as ViewType)}
            className="bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg p-0.5 h-9"
          >
            {[
              { id: 'day', label: 'D' },
              { id: '3day', label: '3D' },
              { id: 'week', label: 'W' },
              { id: 'month', label: 'M' }
            ].map((v) => (
              <ToggleGroupItem
                key={v.id}
                value={v.id}
                className={cn(
                  'px-2.5 py-1 text-[10px] uppercase font-black rounded-md transition-all h-7 grow min-w-[32px] data-[state=on]:bg-blue-600 data-[state=on]:text-white text-slate-300 dark:text-white/20 hover:text-slate-500 dark:hover:text-white/40',
                )}
              >
                {v.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-1 h-8">
            <IconButton
              icon={<ChevronLeft className="h-4 w-4" />}
              tooltip="Prev"
              onClick={handlePrevious}
              variant="ghost"
              className="h-6 w-6"
            />

            <CalendarRangePicker
              selectedDate={selectedDate}
              viewType={viewType}
              minDate={activeRangeBounds.monthStart}
              maxDate={activeRangeBounds.monthEnd}
              onRangeSelect={(date) => {
                if (viewType === 'week') {
                  onDateChange(startOfWeek(date, { weekStartsOn: 1 }));
                } else if (viewType === 'month') {
                  onDateChange(startOfMonth(date));
                } else {
                  onDateChange(date);
                }
              }}
              displayLabel={displayLabel}
            />

            <IconButton
              icon={<ChevronRight className="h-4 w-4" />}
              tooltip="Next"
              onClick={handleNext}
              variant="ghost"
              className="h-6 w-6"
            />
          </div>
        </div>

        {/* Right Section: Actions */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-2 py-1 h-10">
            <IconButton icon={<RefreshCw className="h-4 w-4" />} tooltip="Reload" onClick={onRefresh} isLoading={isRefreshing} />
            <RosterFilterPopover />
            <Separator orientation="vertical" className="h-5 bg-slate-200 dark:bg-white/10 mx-1" />
            <IconButton
              icon={<CalendarCheck className="h-4 w-4" />}
              tooltip={activeMode === 'people' ? "Availabilities" : "Availabilities (People Mode Only)"}
              onClick={onAvailabilitiesToggle}
              isActive={showAvailabilities}
              variant="success"
              disabled={activeMode !== 'people'}
            />
            <IconButton
              icon={<Activity className="h-4 w-4" />}
              tooltip={activeMode === 'people' ? "Fatigue Score Placeholder" : "Fatigue Score (People Mode Only)"}
              onClick={() => { }}
              isActive={false}
              variant="success"
              disabled={activeMode !== 'people'}
            />
            <IconButton
              icon={<Zap className="h-4 w-4" />}
              tooltip="Activate"
              onClick={() => setIsActivateDialogOpen(true)}
              variant="success"
              disabled={!selectedDepartmentId}
            />
            <IconButton
              icon={<Wand2 className="h-4 w-4" />}
              tooltip="AutoSchedule"
              onClick={() => setIsAutoScheduleOpen(true)}
              variant="success"
              disabled={!selectedDepartmentId}
            />
            <div className="relative">
              <IconButton
                icon={<CopyPlus className="h-4 w-4" />}
                tooltip="Apply Template"
                onClick={() => setIsApplyTemplateDialogOpen(true)}
                variant="success"
                disabled={!selectedDepartmentId}
              />
              {appliedCount > 0 && (
                <div className="absolute -top-1 -right-1 h-4 w-4 bg-blue-500 rounded-full border border-slate-100 dark:border-slate-900 flex items-center justify-center pointer-events-none shadow-lg">
                  <span className="text-[9px] font-black text-white leading-none">{appliedCount}</span>
                </div>
              )}
            </div>
            <IconButton
              icon={<PanelRight className="h-4 w-4" />}
              tooltip={activeMode === 'events' ? 'Panel not available in Events mode' : (activeMode === 'group' || activeMode === 'roles' ? 'Contracted Staff' : 'Unfilled Shifts')}
              onClick={onUnfilledPanelToggle}
              isActive={showUnfilledPanel}
              disabled={activeMode === 'events'}
            />
            <Separator orientation="vertical" className="h-5 bg-slate-200 dark:bg-white/10 mx-1" />
            {activeMode === 'group' && (
              <IconButton
                icon={<Box className="h-4 w-4" />}
                tooltip="Buckets"
                onClick={() => setIsBucketView(!isBucketView)}
                isActive={isBucketView}
              />
            )}
            <IconButton
              icon={<Layers className="h-4 w-4" />}
              tooltip="Bulk"
              onClick={onBulkModeToggle || (() => { })}
              isActive={isBulkMode}
            />
          </div>

        </div>
      </div>

      {/* Roster Initialization Dialog */}
      {selectedOrganizationId && selectedDepartmentId && (
        <ActivateRosterDialog
          open={isActivateDialogOpen}
          onOpenChange={setIsActivateDialogOpen}
          organizationId={selectedOrganizationId}
          departmentId={selectedDepartmentId}
          subDepartmentId={selectedSubDepartmentId}
          startDate={startOfMonth(selectedDate)}
          endDate={endOfMonth(selectedDate)}
        />
      )}

      {/* Apply Template Dialog */}
      {selectedOrganizationId && selectedDepartmentId && (
        <ApplyTemplateDialog
          isOpen={isApplyTemplateDialogOpen}
          onOpenChange={setIsApplyTemplateDialogOpen}
          organizationId={selectedOrganizationId}
          departmentId={selectedDepartmentId}
          subDepartmentId={selectedSubDepartmentId}
          selectedDate={selectedDate}
          appliedTemplateIds={currentRosterStructure?.appliedTemplateIds || []}
          rosterId={currentRosterStructure?.rosterId || null}
        />
      )}

      {/* AutoSchedule Modal */}
      <AutoScheduleModal
        isOpen={isAutoScheduleOpen}
        onOpenChange={setIsAutoScheduleOpen}
        context={{
          organizationId: selectedOrganizationId,
          departmentId: selectedDepartmentId,
          subDepartmentId: selectedSubDepartmentId,
          dateStart: format(autoScheduleRange.start, 'yyyy-MM-dd'),
          dateEnd: format(autoScheduleRange.end, 'yyyy-MM-dd')
        }}
        onAssignmentsApplied={() => {
          queryClient.invalidateQueries({ queryKey: ['shifts'] });
          onRefresh();
        }}
      />
    </div>
  );
};

export default RosterFunctionBar;
