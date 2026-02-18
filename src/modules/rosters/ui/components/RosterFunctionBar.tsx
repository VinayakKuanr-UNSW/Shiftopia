import React, { useState } from 'react';
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
} from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
  useTemplates,
  useRostersLookup,
} from '@/modules/rosters/state/useRosterShifts';
import { ActivateRosterDialog } from '../dialogs/ActivateRosterDialog';
import { CalendarRangePicker } from './CalendarRangePicker';
import { RosterFilterPopover } from './RosterFilterPopover';
import { useRosterUI, RosterMode } from '@/modules/rosters/contexts/RosterUIContext';
import { ToggleGroup, ToggleGroupItem } from '@/modules/core/ui/primitives/toggle-group';
import { Separator } from '@/modules/core/ui/primitives/separator';

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

  onPublishRoster: () => void;

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
      ? 'bg-white/15 text-white'
      : 'text-white/60 hover:text-white hover:bg-white/10',
    success: isActive
      ? 'bg-emerald-500/20 text-emerald-300'
      : 'text-white/60 hover:text-emerald-300 hover:bg-emerald-500/10',
    warning: isActive
      ? 'bg-amber-500/20 text-amber-300'
      : 'text-white/60 hover:text-amber-300 hover:bg-amber-500/10',
    danger: isActive
      ? 'bg-red-500/20 text-red-300'
      : 'text-white/60 hover:text-red-300 hover:bg-red-500/10',
    ghost: 'text-white/40 hover:text-white hover:bg-white/5',
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
  onPublishRoster,
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
  } = useRosterUI();

  const { data: rosters = [] } = useRostersLookup(
    selectedOrganizationId || undefined,
    {
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    }
  );
  const { data: templates = [] } = useTemplates(selectedSubDepartmentId || undefined, selectedDepartmentId || undefined);

  const [isActivateDialogOpen, setIsActivateDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedRangeIndex, setSelectedRangeIndex] = useState<number>(0);

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

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  const activeRangeBounds = React.useMemo(() => {
    if (selectedTemplate?.start_date && selectedTemplate?.end_date) {
      return {
        monthStart: new Date(selectedTemplate.start_date),
        monthEnd: new Date(selectedTemplate.end_date)
      };
    }
    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    return { monthStart, monthEnd };
  }, [selectedTemplate, selectedDate]);

  React.useEffect(() => {
    if (onTemplateDatesChange) {
      onTemplateDatesChange(activeRangeBounds.monthStart, activeRangeBounds.monthEnd);
    }
  }, [activeRangeBounds, onTemplateDatesChange]);

  const rangeOptions: RangeOption[] = React.useMemo(() => {
    const { monthStart, monthEnd } = activeRangeBounds;
    const options: RangeOption[] = [];

    switch (viewType) {
      case 'day': {
        const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
        days.forEach(day => {
          options.push({ label: format(day, 'MMM d'), startDate: day, endDate: day });
        });
        break;
      }
      case '3day': {
        const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
        days.forEach(day => {
          let rangeEnd = addDays(day, 2);
          if (rangeEnd > monthEnd) rangeEnd = monthEnd;
          options.push({ label: `${format(day, 'MMM d')} – ${format(rangeEnd, 'd')}`, startDate: day, endDate: rangeEnd });
        });
        break;
      }
      case 'week': {
        const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
        days.forEach(day => {
          let rangeEnd = addDays(day, 6);
          if (rangeEnd > monthEnd) rangeEnd = monthEnd;
          options.push({ label: `${format(day, 'MMM d')} – ${format(rangeEnd, 'd')}`, startDate: day, endDate: rangeEnd });
        });
        break;
      }
      case 'month': {
        options.push({ label: format(monthStart, 'MMMM yyyy'), startDate: monthStart, endDate: monthEnd });
        break;
      }
    }
    return options;
  }, [viewType, activeRangeBounds]);

  React.useEffect(() => {
    const currentIdx = rangeOptions.findIndex(opt => isSameDay(opt.startDate, selectedDate));
    if (currentIdx !== -1 && currentIdx !== selectedRangeIndex) {
      setSelectedRangeIndex(currentIdx);
    }
  }, [selectedDate, rangeOptions]);

  // FIX: Navigation logic that actually works across months
  const handlePrevious = () => {
    if (viewType === 'month') {
      onDateChange(addMonths(selectedDate, -1));
    } else if (selectedRangeIndex > 0) {
      setSelectedRangeIndex(selectedRangeIndex - 1);
      onDateChange(rangeOptions[selectedRangeIndex - 1].startDate);
    } else {
      onDateChange(addMonths(selectedDate, -1));
    }
  };

  const handleNext = () => {
    if (viewType === 'month') {
      onDateChange(addMonths(selectedDate, 1));
    } else if (selectedRangeIndex < rangeOptions.length - 1) {
      setSelectedRangeIndex(selectedRangeIndex + 1);
      onDateChange(rangeOptions[selectedRangeIndex + 1].startDate);
    } else {
      onDateChange(addMonths(selectedDate, 1));
    }
  };

  return (
    <div className="w-full h-12 flex-shrink-0 z-20 bg-slate-950/40 backdrop-blur-2xl border-b border-white/10 px-3 flex items-center overflow-hidden">
      <div className="w-full flex items-center justify-between">

        {/* Left Section: Context & Modes */}
        <div className="flex items-center gap-2">
          {/* Template Selector */}
          <div className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 pr-2 pl-1.5 h-8">
            <Calendar className="h-3.5 w-3.5 text-indigo-400" />
            <Select
              value={selectedTemplateId || ''}
              onValueChange={(id) => {
                setSelectedTemplateId(id);
                onTemplateChange?.(id, undefined);
              }}
              disabled={templates.length === 0}
            >
              <SelectTrigger className="h-6 w-auto min-w-[100px] border-0 bg-transparent p-0 text-[11px] font-bold text-white/80 focus:ring-0">
                <SelectValue placeholder="Select Template" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10">
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ToggleGroup
            type="single"
            value={activeMode}
            onValueChange={(v) => v && setActiveMode(v as RosterMode)}
            className="bg-black/20 border border-white/5 rounded-lg p-0.5"
          >
            {[
              { id: 'group', icon: <Box className="h-3.5 w-3.5" />, label: 'Group' },
              { id: 'people', icon: <Users className="h-3.5 w-3.5" />, label: 'People' },
              { id: 'events', icon: <CalendarDays className="h-3.5 w-3.5" />, label: 'Events' },
              { id: 'roles', icon: <Briefcase className="h-3.5 w-3.5" />, label: 'Roles' },
            ].map((m) => (
              <ToggleGroupItem
                key={m.id}
                value={m.id}
                className="h-7 px-2.5 text-[11px] font-bold rounded-md data-[state=on]:bg-white/10 data-[state=on]:text-white text-white/40 hover:text-white/60 transition-all"
              >
                <div className="flex items-center gap-1.5">
                  {m.icon}
                  <span className="hidden xl:inline">{m.label}</span>
                </div>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* Center Section: Navigation & View */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-black/40 border border-white/10 rounded-lg p-0.5 h-8">
            {[
              { id: 'day', label: 'D' },
              { id: '3day', label: '3D' },
              { id: 'week', label: 'W' },
              { id: 'month', label: 'M' }
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => onViewTypeChange(v.id as ViewType)}
                className={cn(
                  'px-2.5 py-1 text-[10px] uppercase font-black rounded-md transition-all h-6 min-w-[24px]',
                  viewType === v.id
                    ? 'bg-blue-600 text-white'
                    : 'text-white/20 hover:text-white/40 hover:bg-white/5'
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-1 h-8">
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
              monthStart={activeRangeBounds.monthStart}
              monthEnd={activeRangeBounds.monthEnd}
              onRangeSelect={onDateChange}
              displayLabel={rangeOptions[selectedRangeIndex]?.label || 'Select Date'}
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
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-1 py-1 h-8">
            <IconButton icon={<RefreshCw className="h-3.5 w-3.5" />} tooltip="Reload" onClick={onRefresh} isLoading={isRefreshing} />
            <RosterFilterPopover />
            <Separator orientation="vertical" className="h-4 bg-white/10 mx-0.5" />
            <IconButton
              icon={<CalendarCheck className="h-3.5 w-3.5" />}
              tooltip="Avail"
              onClick={onAvailabilitiesToggle}
              isActive={showAvailabilities}
              variant="success"
            />
            <IconButton
              icon={<Zap className="h-3.5 w-3.5" />}
              tooltip="Activate"
              onClick={() => setIsActivateDialogOpen(true)}
              variant="success"
              disabled={!selectedDepartmentId}
            />
            <IconButton
              icon={<PanelRight className="h-3.5 w-3.5" />}
              tooltip="Unfilled"
              onClick={onUnfilledPanelToggle}
              isActive={showUnfilledPanel}
            />
            <Separator orientation="vertical" className="h-4 bg-white/10 mx-0.5" />
            {activeMode === 'group' && (
              <IconButton
                icon={<Box className="h-3.5 w-3.5" />}
                tooltip="Buckets"
                onClick={() => setIsBucketView(!isBucketView)}
                isActive={isBucketView}
              />
            )}
            <IconButton
              icon={<Layers className="h-3.5 w-3.5" />}
              tooltip="Bulk"
              onClick={onBulkModeToggle || (() => { })}
              isActive={isBulkMode}
            />
          </div>

          <IconButton
            icon={<Send className="h-3.5 w-3.5" />}
            tooltip="Publish Roster"
            onClick={onPublishRoster}
            disabled={!canEdit}
            className="h-8 w-8 bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-glow-blue/20"
          />
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
          startDate={activeRangeBounds.monthStart}
          endDate={activeRangeBounds.monthEnd}
        />
      )}
    </div>
  );
};

export default RosterFunctionBar;
