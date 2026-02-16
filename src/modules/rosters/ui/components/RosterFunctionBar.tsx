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
  ChevronRight as ChevronSeparator,
  RefreshCw,
  Filter,
  Lock,
  Unlock,
  PanelRight,
  Plus,
  Send,
  CalendarCheck,
  Building2,
  Layers,
  Box,
  GitBranch,
  Calendar,
} from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO, min as minDate, max as maxDate } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useAuth } from '@/platform/auth/useAuth';
import {
  useTemplates,
  useRostersLookup,
} from '@/modules/rosters/state/useRosterShifts';
import { CalendarRangePicker } from './CalendarRangePicker';
import { RosterFilterPopover } from './RosterFilterPopover';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';

/* ============================================================
   TYPES
   ============================================================ */
export type ViewType = 'day' | '3day' | 'week' | 'month';

interface OrganizationData {
  id: string;
  name: string;
}

interface DepartmentData {
  id: string;
  name: string;
}

interface SubDepartmentData {
  id: string;
  name: string;
}

// Helper to determine lock state
// Helper to determine lock state

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
  published_month?: string; // e.g., '2026-01'
  start_date?: string; // ISO date string e.g., '2026-02-01'
  end_date?: string; // ISO date string e.g., '2026-02-28'
}

interface RangeOption {
  label: string;
  startDate: Date;
  endDate: Date;
}

export interface RosterFunctionBarProps {
  selectedOrganizationId: string | null;
  selectedRosterId: string | null;

  // Context callbacks
  onRosterChange: (id: string | null) => void;
  onTemplateChange?: (id: string | null, groups?: any[]) => void;
  // Ghost Cell Navigation - pass template date bounds to parent
  onTemplateDatesChange?: (startDate: Date | undefined, endDate: Date | undefined) => void;

  // Date & View state
  selectedDate: Date;
  viewType: ViewType;
  onDateChange: (date: Date) => void;
  onViewTypeChange: (viewType: ViewType) => void;

  // Toggle states
  isLocked: boolean;
  showAvailabilities: boolean;
  showUnfilledPanel: boolean;
  isRefreshing?: boolean;

  // Toggle callbacks
  onLockToggle: () => void;
  onAvailabilitiesToggle: () => void;
  onUnfilledPanelToggle: () => void;
  onRefresh: () => void;
  onFiltersClick: () => void;

  // Action callbacks
  onAddShift: () => void;
  onPublishRoster: () => void;

  // Permissions
  canEdit?: boolean;

  // Bulk Mode
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
  variant?: 'default' | 'success' | 'warning' | 'danger';
}> = ({ icon, tooltip, onClick, isActive, isLoading, disabled, variant = 'default' }) => {
  const { isDark } = useTheme();

  const variantClasses = {
    default: isActive
      ? (isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900')
      : (isDark ? 'text-white/60 hover:text-white hover:bg-white/5' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'),
    success: isActive
      ? (isDark ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700')
      : (isDark ? 'text-white/60 hover:text-emerald-300 hover:bg-emerald-500/10' : 'text-gray-500 hover:text-emerald-700 hover:bg-emerald-50'),
    warning: isActive
      ? (isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700')
      : (isDark ? 'text-white/60 hover:text-amber-300 hover:bg-amber-500/10' : 'text-gray-500 hover:text-amber-700 hover:bg-amber-50'),
    danger: isActive
      ? (isDark ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700')
      : (isDark ? 'text-white/60 hover:text-red-300 hover:bg-red-500/10' : 'text-gray-500 hover:text-red-700 hover:bg-red-50'),
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            disabled={disabled || isLoading}
            className={cn(
              'h-8 w-8 flex items-center justify-center rounded-md transition-all duration-200', // Smaller, no border by default
              variantClasses[variant],
              disabled && 'opacity-50 cursor-not-allowed',
              isLoading && 'animate-pulse'
            )}
          >
            {isLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              icon
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className={cn(
            "text-xs",
            isDark ? "bg-[#1a2744] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900 shadow-sm"
          )}
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/* ============================================================
   VIEW MODE SELECTOR COMPONENT
   ============================================================ */
const ViewModeSelector: React.FC<{
  value: ViewType;
  onChange: (value: ViewType) => void;
}> = ({ value, onChange }) => {
  const { isDark } = useTheme();

  return (
    <div className={cn(
      "flex items-center rounded-lg p-0.5 border",
      isDark ? "bg-white/5 border-white/10" : "bg-gray-100 border-gray-200"
    )}>
      {['day', '3day', 'week', 'month'].map((optionValue) => {
        const option = { value: optionValue as ViewType, label: optionValue === '3day' ? '3-Day' : optionValue.charAt(0).toUpperCase() + optionValue.slice(1) };
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200',
              value === option.value
                ? 'bg-blue-600 text-white shadow-sm'
                : (isDark ? 'text-white/60 hover:text-white hover:bg-white/5' : 'text-gray-600 hover:text-gray-900 hover:bg-white')
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
  onOrganizationChange,
  onDepartmentChange,
  onSubDepartmentChange,
  onRosterChange,
  onTemplateChange,
  onTemplateDatesChange, // Ghost Cell Navigation callback
  selectedDate,
  viewType,
  onDateChange,
  onViewTypeChange,
  isLocked,
  showAvailabilities,
  showUnfilledPanel,
  isRefreshing,
  onLockToggle,
  onAvailabilitiesToggle,
  onUnfilledPanelToggle,
  onRefresh,
  onFiltersClick,
  onAddShift,
  onPublishRoster,
  canEdit = true,
  isBulkMode = false,
  onBulkModeToggle,
}) => {
  // TanStack Query hooks replace manual useEffect + useState chains
  // Roster fetching
  const {
    selectedDepartmentIds,
    selectedSubDepartmentIds,
  } = useRosterUI();

  const { data: rosters = [], isLoading: isLoadingRosters } = useRostersLookup(
    selectedOrganizationId || undefined,
    {
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    }
  );
  const { data: templates = [] } = useTemplates(undefined, undefined); // Will be driven by global scope if needed, or refined

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedRangeIndex, setSelectedRangeIndex] = useState<number>(0);

  // Auto-select active roster when data arrives
  React.useEffect(() => {
    if (rosters.length > 0 && !selectedRosterId && selectedOrganizationId) {
      const today = new Date();
      const activeRoster = rosters.find((r: RosterData) => {
        const start = new Date(r.start_date);
        const end = new Date(r.end_date);
        return today >= start && today <= end;
      });
      onRosterChange(activeRoster?.id || rosters[0].id);
    }
  }, [rosters, selectedRosterId, selectedOrganizationId, onRosterChange]);

  // Auto-select template when data arrives
  React.useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      const baseTemplate = templates.find((t: TemplateData) =>
        t.name.includes('Base Template')
      ) || templates[0];
      setSelectedTemplateId(baseTemplate.id);
      onTemplateChange?.(baseTemplate.id, undefined);
    } else if (templates.length === 0) {
      setSelectedTemplateId(null);
    }
  }, [templates, selectedTemplateId, onTemplateChange]);

  // Get selected template's date boundaries (use actual start_date/end_date)
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const templateMonth = React.useMemo(() => {
    // Use actual start_date and end_date from the published template
    if (selectedTemplate?.start_date && selectedTemplate?.end_date) {
      const monthStart = new Date(selectedTemplate.start_date);
      const monthEnd = new Date(selectedTemplate.end_date);
      return { monthStart, monthEnd };
    }
    // Fallback: use published_month to derive dates
    if (selectedTemplate?.published_month) {
      const [year, month] = selectedTemplate.published_month.split('-').map(Number);
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = endOfMonth(monthStart);
      return { monthStart, monthEnd };
    }
    // Default to current month if no template selected
    const now = new Date();
    return { monthStart: startOfMonth(now), monthEnd: endOfMonth(now) };
  }, [selectedTemplate?.start_date, selectedTemplate?.end_date, selectedTemplate?.published_month]);

  // Notify parent of template date changes (for Ghost Cell navigation)
  React.useEffect(() => {
    if (onTemplateDatesChange) {
      onTemplateDatesChange(templateMonth.monthStart, templateMonth.monthEnd);
    }
  }, [templateMonth, onTemplateDatesChange]);

  // Generate range options based on view type and template dates
  // For 3-day and week views, allow selecting ANY start date (not just fixed segments)
  const rangeOptions: RangeOption[] = React.useMemo(() => {
    const { monthStart, monthEnd } = templateMonth;
    const options: RangeOption[] = [];

    switch (viewType) {
      case 'day': {
        // Each day of the template range
        const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
        days.forEach(day => {
          options.push({
            label: format(day, 'MMM d'),
            startDate: day,
            endDate: day,
          });
        });
        break;
      }
      case '3day': {
        // Allow ANY start date within the template range
        // Generate an option for each possible starting day
        const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
        days.forEach(day => {
          // Calculate end date (2 days after start)
          let rangeEnd = addDays(day, 2);
          // Clamp to template end date
          if (rangeEnd > monthEnd) {
            rangeEnd = monthEnd;
          }
          options.push({
            label: `${format(day, 'MMM d')} – ${format(rangeEnd, 'd')}`,
            startDate: day,
            endDate: rangeEnd,
          });
        });
        break;
      }
      case 'week': {
        // Allow ANY start date within the template range
        // Generate an option for each possible starting day
        const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
        days.forEach(day => {
          // Calculate end date (6 days after start)
          let rangeEnd = addDays(day, 6);
          // Clamp to template end date
          if (rangeEnd > monthEnd) {
            rangeEnd = monthEnd;
          }
          options.push({
            label: `${format(day, 'MMM d')} – ${format(rangeEnd, 'd')}`,
            startDate: day,
            endDate: rangeEnd,
          });
        });
        break;
      }
      case 'month': {
        // Single option for full template range (start to end date)
        options.push({
          label: format(monthStart, 'MMMM yyyy'),
          startDate: monthStart,
          endDate: monthEnd,
        });
        break;
      }
    }
    return options;
  }, [viewType, templateMonth]);

  // Update parent date when range changes
  React.useEffect(() => {
    if (rangeOptions.length > 0 && selectedRangeIndex >= 0) {
      const clampedIndex = Math.min(selectedRangeIndex, rangeOptions.length - 1);
      if (clampedIndex !== selectedRangeIndex) {
        setSelectedRangeIndex(clampedIndex);
      }
      const selectedRange = rangeOptions[clampedIndex];
      if (selectedRange && !isSameDay(selectedDate, selectedRange.startDate)) {
        onDateChange(selectedRange.startDate);
      }
    }
  }, [rangeOptions, selectedRangeIndex]);

  // Reset range when viewType or template changes
  React.useEffect(() => {
    setSelectedRangeIndex(0);
  }, [viewType, selectedTemplateId]);

  // Navigation handlers

  // Date navigation
  const navigatePrevious = () => {
    onDateChange((() => {
      switch (viewType) {
        case 'day': return addDays(selectedDate, -1);
        case '3day': return addDays(selectedDate, -3);
        case 'week': return addDays(selectedDate, -7);
        case 'month': return new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1);
        default: return selectedDate;
      }
    })());
  };

  const navigateNext = () => {
    onDateChange((() => {
      switch (viewType) {
        case 'day': return addDays(selectedDate, 1);
        case '3day': return addDays(selectedDate, 3);
        case 'week': return addDays(selectedDate, 7);
        case 'month': return new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);
        default: return selectedDate;
      }
    })());
  };

  const getDateDisplay = () => {
    switch (viewType) {
      case 'day':
        return format(selectedDate, 'EEE, MMM d, yyyy');
      case '3day': {
        const end = addDays(selectedDate, 2);
        return `${format(selectedDate, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
      }
      case 'week': {
        const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
        const end = endOfWeek(selectedDate, { weekStartsOn: 1 });
        return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
      }
      case 'month':
        return format(selectedDate, 'MMMM yyyy');
      default:
        return '';
    }
  };

  const selectedRoster = rosters.find(r => r.id === selectedRosterId);

  const { isDark } = useTheme();
  const { activeMode, isBucketView, setIsBucketView } = useRosterUI();

  const containerClass = "bg-white/5 border border-white/10 hover:bg-white/10 transition-colors";

  const selectTriggerClass = "h-7 w-auto min-w-[80px] max-w-[140px] border-0 bg-transparent text-foreground text-xs font-medium p-0 px-2 focus:ring-0 focus:ring-offset-0 hover:bg-white/5 rounded-md transition-colors";

  const selectContentClass = "bg-popover border-white/10 backdrop-blur-xl";

  const selectItemClass = "text-xs focus:bg-white/10";

  const templateContainerClass = "bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors";



  // ... (inside component)
  const {
    isDeptLocked,
    isSubDeptLocked,
    selectDepartment: selectGlobalDepartment,
    selectSubDepartment: selectGlobalSubDepartment
  } = useOrgSelection();

  // We keep isOrgLocked true as per design to force Context Header usage for Org switching
  // or derive it if we want to support multi-org switching here (but context implies locked org)
  const isOrgLocked = true;


  return (
    <div className="w-full flex-shrink-0 z-20 bg-background/50 backdrop-blur-md border-b border-white/5">
      {/* Row 1: Context + Template + Date + Actions */}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">

        {/* Template Selector */}
        <div className={cn("flex items-center gap-1 rounded-lg px-1.5 py-1 border text-xs", templateContainerClass)}>
          <Calendar className="h-3 w-3 text-purple-400" />
          <Select
            value={selectedTemplateId || ''}
            onValueChange={(id) => {
              setSelectedTemplateId(id);
              onTemplateChange?.(id, undefined);
            }}
            disabled={templates.length === 0}
          >
            <SelectTrigger className={cn(selectTriggerClass, "h-6 min-w-[120px] max-w-[160px]")}>
              <SelectValue placeholder="Template" />
            </SelectTrigger>
            <SelectContent className={selectContentClass}>
              {templates.length === 0 ? (
                <SelectItem value="__none__" disabled className="text-xs text-white/40">
                  No templates
                </SelectItem>
              ) : (
                templates.map((template) => (
                  <SelectItem key={template.id} value={template.id} className={selectItemClass}>
                    {template.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* View Mode */}
        <div className="flex items-center rounded-lg p-1 bg-black/20 border border-white/5">
          {['day', '3day', 'week', 'month'].map((v) => (
            <button
              key={v}
              onClick={() => onViewTypeChange(v as ViewType)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                viewType === v
                  ? 'bg-primary text-primary-foreground shadow-glow/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              )}
            >
              {v === '3day' ? '3D' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {/* Date Range */}
        <div className={cn("flex items-center gap-1 rounded-lg px-2 py-1", containerClass)}>
          <CalendarRangePicker
            selectedDate={selectedDate}
            viewType={viewType}
            monthStart={templateMonth.monthStart}
            monthEnd={templateMonth.monthEnd}
            onRangeSelect={(startDate) => {
              const idx = rangeOptions.findIndex(opt => isSameDay(opt.startDate, startDate));
              if (idx >= 0) setSelectedRangeIndex(idx);
              else onDateChange(startDate);
            }}
            displayLabel={rangeOptions[selectedRangeIndex]?.label || 'Date'}
          />
          <div className="flex items-center border-l border-white/10 pl-1 ml-1 space-x-0.5">
            <button
              onClick={() => setSelectedRangeIndex(Math.max(0, selectedRangeIndex - 1))}
              disabled={selectedRangeIndex === 0}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-white/10 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button
              onClick={() => setSelectedRangeIndex(Math.min(rangeOptions.length - 1, selectedRangeIndex + 1))}
              disabled={selectedRangeIndex >= rangeOptions.length - 1}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-white/10 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action Icons */}
        <div className="flex items-center gap-2 mr-4">
          <IconButton icon={<RefreshCw className="h-4 w-4" />} tooltip="Refresh" onClick={onRefresh} isLoading={isRefreshing} />
          <RosterFilterPopover />
          <div className="w-px h-4 bg-white/10" />
          <IconButton icon={<CalendarCheck className="h-4 w-4" />} tooltip="Availabilities" onClick={onAvailabilitiesToggle} isActive={showAvailabilities} variant="success" />
          <IconButton icon={isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />} tooltip={isLocked ? 'Unlock' : 'Lock'} onClick={onLockToggle} isActive={isLocked} variant={isLocked ? 'warning' : 'default'} />
          <IconButton icon={<PanelRight className="h-4 w-4" />} tooltip="Unfilled Shifts" onClick={onUnfilledPanelToggle} isActive={showUnfilledPanel} />

          <div className="w-px h-4 bg-white/10" />

          {/* Bucket View Toggle - only in Group mode */}
          {activeMode === 'group' && (
            <IconButton
              icon={<Box className="h-4 w-4" />}
              tooltip={isBucketView ? 'Exit Bucket View' : 'Bucket View'}
              onClick={() => setIsBucketView(!isBucketView)}
              isActive={isBucketView}
              variant={isBucketView ? 'success' : 'default'}
            />
          )}

          {/* Bulk Mode Toggle */}
          <IconButton
            icon={<Layers className="h-4 w-4" />}
            tooltip={isBulkMode ? 'Exit Bulk Mode' : 'Bulk Mode'}
            onClick={onBulkModeToggle || (() => { })}
            isActive={isBulkMode}
            variant={isBulkMode ? 'success' : 'default'}
          />
        </div>

        {/* Primary Actions */}
        <div className="flex items-center gap-2 border-l border-white/10 pl-2 ml-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={onAddShift}
                  disabled={!canEdit}
                  className="h-8 w-8 bg-emerald-600 hover:bg-emerald-500 text-white shadow-glow hover:shadow-glow/50 border-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add Global Shift</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={onPublishRoster}
                  disabled={!canEdit}
                  className="h-8 w-8 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 border-0"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Publish Roster</TooltipContent>
            </Tooltip>
          </TooltipProvider>

        </div>
      </div>

      {/* Lock Banner */}
      {
        isLocked && (
          <div className="px-3 py-1 bg-amber-500/10 border-t border-amber-500/20">
            <div className="flex items-center justify-center gap-2 text-[10px] text-amber-300">
              <Lock className="h-3 w-3" />
              <span>Roster locked</span>
            </div>
          </div>
        )
      }
    </div >
  );
};

export default RosterFunctionBar;
