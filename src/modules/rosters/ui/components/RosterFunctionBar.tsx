import React, { useState, Suspense, lazy } from 'react';
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
  CalendarPlus,
  Layers,
  Box,
  Calendar,
  Users,
  CalendarDays,
  Briefcase,
  Wand2,
  Hand,
  FolderPlus,
} from 'lucide-react';
import { format, addDays, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import {
  useTemplates,
  useRostersLookup,
} from '@/modules/rosters/state/useRosterShifts';
import { UnifiedRosterNavigator, type ViewType, computeRange, formatRangeLabel } from './UnifiedRosterNavigator';
export type { ViewType } from './UnifiedRosterNavigator';
import { RosterFilterPopover } from './RosterFilterPopover';
import { useRosterUI, RosterMode } from '@/modules/rosters/contexts/RosterUIContext';
import { ToggleGroup, ToggleGroupItem } from '@/modules/core/ui/primitives/toggle-group';
import { Separator } from '@/modules/core/ui/primitives/separator';
// Lazy: each of these dialogs ships its own queries (templates, history,
// rostersByDateRange) plus framer-motion. When eagerly imported they were
// firing those queries on every roster page load even with isOpen=false.
// One dialog, not three. `ApplyTemplateDialog` ("Inject Sequence") and
// `PlanRosterPeriodDialog` ("Plan Roster Period") overlapped almost entirely —
// the second called the first internally — and `SnapFromRosterDialog` ("Snap")
// was the inverse operation hidden behind an unrelated camera icon. Merged into
// one two-tab dialog on 2026-08-05.
const RosterTemplatesDialog = lazy(() =>
  import('@/modules/rosters/ui/dialogs/RosterTemplatesDialog').then((m) => ({
    default: m.RosterTemplatesDialog,
  })),
);
const CentralAddSubGroupDialog = lazy(() =>
  import('@/modules/rosters/ui/dialogs/CentralAddSubGroupDialog').then((m) => ({
    default: m.CentralAddSubGroupDialog,
  })),
);
import { useRosterStructure } from '../../state/useRosterStructure';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { useShallow } from 'zustand/react/shallow';
import { PublishRosterButton, type PublishRosterResult } from './PublishRosterButton';
import type { PublishRosterPlan } from '@/modules/rosters/domain/bulk-action-engine';

/* ============================================================
   TYPES
   ============================================================ */

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
  onAutoScheduleClick?: () => void;

  /**
   * One-click "Publish" action. When both callbacks are provided, a Publish
   * button is shown in the right-hand actions group. `loadPublishPlan` fetches
   * + partitions the current roster (assigned → offers, unassigned → bidding,
   * dead → delete); `executePublishRoster` applies the confirmed plan.
   * `canPublish` gates the trigger (edit permission + org selected).
   */
  loadPublishPlan?: () => Promise<PublishRosterPlan>;
  executePublishRoster?: (plan: PublishRosterPlan) => Promise<PublishRosterResult>;
  canPublish?: boolean;

  /** Number of active filters — shows an orange dot badge on the Filter button when > 0 */
  activeFilterCount?: number;
  transparent?: boolean;
  /** Tighten heights/padding below `md` so the bar fits a phone. */
  compactOnMobile?: boolean;
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
      ? 'bg-slate-200 dark:bg-white/20 text-slate-900 dark:text-white font-bold shadow-sm'
      : 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10',
    success: isActive
      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-500/30'
      : 'text-slate-700 dark:text-slate-200 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-500/10 dark:hover:bg-emerald-500/15',
    warning: isActive
      ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/30'
      : 'text-slate-700 dark:text-slate-200 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-500/10 dark:hover:bg-amber-500/15',
    danger: isActive
      ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 font-bold border border-rose-500/30'
      : 'text-slate-700 dark:text-slate-200 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-500/10 dark:hover:bg-rose-500/15',
    ghost: 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10',
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            disabled={disabled || isLoading}
            aria-label={tooltip}
            aria-pressed={isActive}
            className={cn(
              'h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] sm:h-9 sm:w-9 flex items-center justify-center rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
              variantClasses[variant],
              disabled && 'opacity-40 cursor-not-allowed',
              isLoading && 'animate-pulse',
              className
            )}
          >
            {isLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<any>, { 'aria-hidden': 'true' }) : icon
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="text-[10px] uppercase font-extrabold tracking-wider bg-slate-900 border border-slate-700 text-white shadow-xl px-2.5 py-1 rounded-md"
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
  onAutoScheduleClick,
  loadPublishPlan,
  executePublishRoster,
  canPublish = true,
  activeFilterCount = 0,
  transparent = false,
  compactOnMobile = false,
}) => {
  const {
    activeMode,
    setActiveMode,
    selectedDepartmentIds,
    selectedSubDepartmentIds,
    navigateNext,
    navigatePrevious,
  } = useRosterUI();

  const {
    isDnDModeActive,
    setIsDnDModeActive,
    setShowUnfilledPanel,
  } = useRosterStore(
    useShallow((s) => ({
      isDnDModeActive: s.isDnDModeActive,
      setIsDnDModeActive: s.setIsDnDModeActive,
      setShowUnfilledPanel: s.setShowUnfilledPanel,
    })),
  );

  const queryClient = useQueryClient();

  const { data: rosters = [] } = useRostersLookup(
    selectedOrganizationId || undefined,
    {
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    }
  );
  const { data: templates = [] } = useTemplates(selectedSubDepartmentId || undefined, selectedDepartmentId || undefined);

  const [isTemplatesDialogOpen, setIsTemplatesDialogOpen] = useState(false);
  const [isAddSubGroupOpen, setIsAddSubGroupOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // `subDepartmentName` + its scopeTree walk lived here only to feed the Snap
  // dialog's default template name. RosterTemplatesDialog derives it from
  // useSubDepartments instead, so the whole lookup went with the merge.

  // Auto-select template
  React.useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      const baseTemplate = (templates as TemplateData[]).find((t: TemplateData) =>
        t.name.includes('Base Template')
      ) || (templates as TemplateData[])[0];
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


  return (
    <div className={cn(
      "w-full min-h-16 md:h-16 flex-shrink-0 z-50 px-4 py-2 md:py-0 flex items-center relative transition-all",
      compactOnMobile && 'min-h-0 px-0 py-0 md:h-16 md:px-4',
      !transparent
        ? "bg-white/90 dark:bg-slate-950/40 backdrop-blur-2xl border-b border-slate-200 dark:border-white/10 shadow-sm dark:shadow-2xl"
        : "bg-transparent border-none shadow-none"
    )}>
      {/* Subtle top highlight for premium feel */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* Wraps below md: the three sections cannot sit side by side on a phone. */}
      <div className={cn(
        'w-full flex flex-wrap md:flex-nowrap items-center justify-center md:justify-between gap-2',
        compactOnMobile && 'gap-1.5 md:gap-2',
      )}>

        {/* Left Section: Context & Modes */}
        <div className="w-full md:w-auto flex-shrink-0 flex items-center justify-start">
          <div className={cn(
            'w-full md:w-auto flex items-center bg-slate-100/50 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-xl p-1 h-10 shadow-sm',
            compactOnMobile && 'h-[34px] rounded-lg p-0.5 md:h-10 md:rounded-xl md:p-1',
          )}>
            <ToggleGroup
              type="single"
              value={activeMode}
              onValueChange={(v) => v && setActiveMode(v as RosterMode)}
              className="flex items-center gap-0.5 w-full md:w-auto"
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
                  // The label is hidden below 2xl, so without this the control
                  // announces as an unnamed toggle on every phone.
                  aria-label={`${m.label} roster mode`}
                  className={cn(
                    'flex-1 md:flex-none h-8 px-2.5 text-[10px] font-black uppercase tracking-wider rounded-lg data-[state=on]:bg-white dark:data-[state=on]:bg-white/10 data-[state=on]:text-slate-900 dark:data-[state=on]:text-white text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white/60 transition-all border-none shadow-none',
                    compactOnMobile && 'h-[30px] px-2 md:h-8 md:px-2.5',
                  )}
                >
                  <div className="flex items-center justify-center gap-2">
                    {m.icon}
                    <span className="hidden 2xl:inline">{m.label}</span>
                  </div>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        {/* Center Section: Navigation & View */}
        <div className="w-full md:w-auto flex-shrink-0 flex items-center justify-center">
          <UnifiedRosterNavigator
            variant="full"
            date={selectedDate}
            viewType={viewType}
            onChange={(date) => onDateChange(date)}
            onViewTypeChange={onViewTypeChange}
            minDate={activeRangeBounds.monthStart}
            maxDate={activeRangeBounds.monthEnd}
          />
        </div>

        {/* Right Section: Actions */}
        <div className="w-full md:w-auto flex-shrink-0 flex items-center justify-end gap-2">

          {/* ── One-click Publish (offers + bidding + dead-shift cleanup) ── */}
          {loadPublishPlan && executePublishRoster && (() => {
            const range = computeRange(selectedDate, viewType);
            const rangeLabel = formatRangeLabel(range, viewType);
            const viewTypeLabel = {
              day: 'Day',
              '3day': '3-Day',
              week: 'Week',
              month: 'Month',
            }[viewType] || 'Week';

            return (
              <PublishRosterButton
                disabled={!canPublish}
                loadPlan={loadPublishPlan}
                execute={executePublishRoster}
                selectedViewType={viewTypeLabel}
                selectedViewRange={rangeLabel}
              />
            );
          })()}

          {/* Scrolls horizontally below md. Nine tools plus two separators do
              not fit a phone, and without this the last two — DnD mode and Bulk
              Selection — were simply unreachable: no scroll, and `flex` does not
              wrap by default, so they were pushed outside the row entirely.
              Children get shrink-0 so they keep their tap target rather than
              being squeezed to nothing. */}
          <div className={cn(
            'w-full md:w-auto flex items-center justify-between md:justify-start gap-1 bg-white/50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-1.5 h-10 shadow-sm dark:shadow-none',
            'overflow-x-auto scrollbar-none [&>*]:shrink-0 md:overflow-x-visible',
            compactOnMobile && 'h-[34px] rounded-lg px-1 gap-0.5 md:h-10 md:rounded-xl md:px-1.5 md:gap-1',
          )}>

            {/* ── Data group: Refresh + Filter ───────────────────────── */}
            <IconButton icon={<RefreshCw className="h-4 w-4" />} tooltip="Reload data" onClick={onRefresh} isLoading={isRefreshing} />
            <div className="relative">
              <RosterFilterPopover />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 h-3.5 w-3.5 bg-orange-500 rounded-full border border-slate-100 dark:border-slate-900 flex items-center justify-center pointer-events-none">
                  <span className="text-[8px] font-black text-white leading-none">{activeFilterCount > 9 ? '9+' : activeFilterCount}</span>
                </span>
              )}
            </div>

            <Separator orientation="vertical" className="h-5 bg-slate-200 dark:bg-white/10 mx-0.5" />

            {/* ── Planning group ─────────────────────────────────────── */}
            {activeMode === 'group' && (
              <IconButton
                icon={<FolderPlus className="h-4 w-4" />}
                tooltip={selectedDepartmentId ? "Add Subgroup" : "Add Subgroup — select a department first"}
                onClick={() => setIsAddSubGroupOpen(true)}
                variant="success"
                disabled={!selectedDepartmentId || !canEdit}
              />
            )}
            <IconButton
              icon={<Wand2 className="h-4 w-4" />}
              tooltip={selectedDepartmentId ? "Auto-Schedule" : "Auto-Schedule — select a department first"}
              onClick={() => onAutoScheduleClick?.()}
              variant="success"
              disabled={!selectedDepartmentId}
            />
            <div className="relative">
              <IconButton
                icon={<CalendarPlus className="h-4 w-4" />}
                tooltip={selectedDepartmentId
                  ? "Templates — apply one to a date range, or capture this roster as a new one"
                  : "Templates — select a department first"}
                onClick={() => setIsTemplatesDialogOpen(true)}
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
              icon={<Hand className="h-4 w-4" />}
              tooltip={
                activeMode === 'events'
                  ? 'DnD Mode — not available in Events mode'
                  : isBulkMode
                    ? 'DnD Mode — not available in Bulk selection mode'
                    : isDnDModeActive
                      ? 'Deactivate DnD Mode'
                      : 'Activate DnD Mode'
              }
              onClick={() => {
                const nextActive = !isDnDModeActive;
                setIsDnDModeActive(nextActive);
                if (nextActive) {
                  setShowUnfilledPanel(true);
                } else {
                  setShowUnfilledPanel(false);
                }
              }}
              isActive={isDnDModeActive}
              variant={isDnDModeActive ? 'warning' : 'default'}
              disabled={activeMode === 'events' || isBulkMode}
            />

            <Separator orientation="vertical" className="h-5 bg-slate-200 dark:bg-white/10 mx-0.5" />

            {/* ── View group ─────────────────────────────────────────── */}
            <IconButton
              icon={<Layers className="h-4 w-4" />}
              tooltip={
                isDnDModeActive
                  ? "Bulk Selection — not available in DnD mode"
                  : isBulkMode
                    ? "Exit Bulk Selection (Esc)"
                    : "Bulk Selection mode"
              }
              onClick={onBulkModeToggle || (() => { })}
              isActive={isBulkMode}
              disabled={isDnDModeActive}
            />
          </div>

        </div>
      </div>

      {/* Templates (apply ⇄ capture) — code-split + open-gated so its template and
          roster queries only fire on first user open. */}
      {isTemplatesDialogOpen && selectedOrganizationId && selectedDepartmentId && (
        <Suspense fallback={null}>
          <RosterTemplatesDialog
            isOpen={isTemplatesDialogOpen}
            onOpenChange={setIsTemplatesDialogOpen}
            organizationId={selectedOrganizationId ?? null}
            departmentId={selectedDepartmentId ?? null}
            subDepartmentId={selectedSubDepartmentId ?? null}
            selectedDate={selectedDate}
          />
        </Suspense>
      )}

      {/* Centralized Add Subgroup Dialog */}
      {isAddSubGroupOpen && selectedOrganizationId && selectedDepartmentId && (
        <Suspense fallback={null}>
          <CentralAddSubGroupDialog
            open={isAddSubGroupOpen}
            onOpenChange={setIsAddSubGroupOpen}
            organizationId={selectedOrganizationId}
            departmentId={selectedDepartmentId}
            subDepartmentId={selectedSubDepartmentId || null}
            selectedDate={selectedDate}
          />
        </Suspense>
      )}

    </div>
  );
};

export default RosterFunctionBar;
