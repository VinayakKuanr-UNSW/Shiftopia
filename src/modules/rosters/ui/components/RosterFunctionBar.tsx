import React, { useState, Suspense, lazy } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
  RefreshCw,
  CalendarPlus,
  Layers,
  Box,
  Users,
  CalendarDays,
  Briefcase,
  Wand2,
  Hand,
  FolderPlus,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { UnifiedRosterNavigator, type ViewType, computeRange, formatRangeLabel } from './UnifiedRosterNavigator';
export type { ViewType } from './UnifiedRosterNavigator';
import { RosterFilterPopover } from './RosterFilterPopover';
import { BadgeLegendPopover } from './BadgeLegendPopover';
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

/** Shown on every write control a view-only manager (delta, epsilon) sees disabled. */
const VIEW_ONLY_TIP = 'View-only access — you can see this roster but not change it';

export interface RosterFunctionBarProps {
  selectedOrganizationId: string | null;

  onTemplateDatesChange?: (startDate: Date | undefined, endDate: Date | undefined) => void;

  /**
   * The department / sub-department, ONLY when the scope names exactly one
   * (soleId). Templates and Add Subgroup act on one roster, so with several in
   * scope they must not pick the first one silently.
   */
  selectedDepartmentId?: string | null;
  selectedSubDepartmentId?: string | null;

  selectedDate: Date;
  viewType: ViewType;
  onDateChange: (date: Date) => void;
  onViewTypeChange: (viewType: ViewType) => void;

  isRefreshing?: boolean;

  onRefresh: () => void;

  canEdit?: boolean;

  isBulkMode?: boolean;
  onBulkModeToggle?: () => void;
  onAutoScheduleClick?: () => void;

  /**
   * One-click "Publish" action. When both callbacks are provided, a Publish
   * button is shown in the right-hand actions group. `loadPublishPlan` reads +
   * partitions the period on screen (assigned → offers, unassigned → bidding;
   * started, on-leave, view-only and similar drafts are skipped and listed);
   * `executePublishRoster` applies the confirmed plan. `canPublish` gates the
   * trigger (edit permission + org selected).
   */
  loadPublishPlan?: () => Promise<PublishRosterPlan>;
  executePublishRoster?: (plan: PublishRosterPlan) => Promise<PublishRosterResult>;
  canPublish?: boolean;

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

  // aria-disabled, not `disabled`: a natively disabled button leaves the tab
  // order and (in most browsers) gets no pointer events, so its tooltip — the
  // only place that says WHY it is off ("select a department first", view-only)
  // — could never be reached by keyboard. The click is swallowed instead.
  const inert = disabled || isLoading;
  return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={inert ? undefined : onClick}
            aria-disabled={inert || undefined}
            aria-label={tooltip}
            aria-pressed={isActive}
            className={cn(
              'h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] sm:h-9 sm:w-9 flex items-center justify-center rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              variantClasses[variant],
              disabled && 'opacity-40 cursor-not-allowed',
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
  );
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export const RosterFunctionBar: React.FC<RosterFunctionBarProps> = ({
  selectedOrganizationId,
  selectedDepartmentId,
  selectedSubDepartmentId,
  onTemplateDatesChange,
  selectedDate,
  viewType,
  onDateChange,
  onViewTypeChange,
  isRefreshing,
  onRefresh,
  canEdit = true,
  isBulkMode = false,
  onBulkModeToggle,
  onAutoScheduleClick,
  loadPublishPlan,
  executePublishRoster,
  canPublish = true,
  transparent = false,
  compactOnMobile = false,
}) => {
  const {
    activeMode,
    setActiveMode,
    selectedDepartmentIds,
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

  const [isTemplatesDialogOpen, setIsTemplatesDialogOpen] = useState(false);
  const [isAddSubGroupOpen, setIsAddSubGroupOpen] = useState(false);
  // Auto-Schedule works over the whole scope (queryFilters), so any department
  // will do; Templates / Add Subgroup need exactly one (selectedDepartmentId).
  const hasDepartmentInScope = selectedDepartmentIds.length > 0;

  // Templates applied to the selected day's roster — the blue badge. Only
  // meaningful for ONE roster, so it reads only when a single sub-department is
  // in scope (structures[0] of several was an arbitrary one).
  const { data: structures = [] } = useRosterStructure(
    selectedSubDepartmentId ? (selectedOrganizationId || undefined) : undefined,
    format(selectedDate, 'yyyy-MM-dd'),
    format(selectedDate, 'yyyy-MM-dd'),
    {
      departmentIds: selectedDepartmentId ? [selectedDepartmentId] : [],
      subDepartmentIds: selectedSubDepartmentId ? [selectedSubDepartmentId] : [],
    }
  );

  const appliedCount = structures[0]?.appliedTemplateIds?.length || 0;

  const activeRangeBounds = React.useMemo(() => {
    // Broaden bounds to allow navigation within a 2-year window
    const now = new Date();
    const monthStart = startOfMonth(addMonths(now, -12));
    const monthEnd = endOfMonth(addMonths(now, 12));
    return { monthStart, monthEnd };
  }, []);

  React.useEffect(() => {
    if (onTemplateDatesChange) {
      onTemplateDatesChange(activeRangeBounds.monthStart, activeRangeBounds.monthEnd);
    }
  }, [activeRangeBounds, onTemplateDatesChange]);


  return (
    <TooltipProvider delayDuration={200}>
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
            'w-full md:w-auto flex items-center bg-slate-100 dark:bg-black/20 border border-slate-300 dark:border-white/5 rounded-xl p-1 h-10 shadow-sm',
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
                    'flex-1 md:flex-none h-8 px-2.5 text-[11px] font-bold uppercase tracking-wider rounded-lg data-[state=on]:bg-white dark:data-[state=on]:bg-white/10 data-[state=on]:text-slate-900 dark:data-[state=on]:text-foreground data-[state=on]:shadow-sm text-slate-700 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground transition-all border-none shadow-none',
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
            showToday
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
                disabledReason={!canEdit
                  ? VIEW_ONLY_TIP
                  : !selectedOrganizationId ? 'Publish — select one organisation first' : undefined}
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
            'w-full md:w-auto flex items-center justify-between md:justify-start gap-1 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded-xl px-1.5 h-10 shadow-sm dark:shadow-none',
            'overflow-x-auto scrollbar-none [&>*]:shrink-0 md:overflow-x-visible',
            compactOnMobile && 'h-[34px] rounded-lg px-1 gap-0.5 md:h-10 md:rounded-xl md:px-1.5 md:gap-1',
          )}>

            {/* ── Data group: Refresh + Legend + Filter ───────────────────────── */}
            <IconButton icon={<RefreshCw className="h-4 w-4" />} tooltip="Reload data" onClick={onRefresh} isLoading={isRefreshing} />
            <BadgeLegendPopover />
            <RosterFilterPopover />

            <Separator orientation="vertical" className="h-5 bg-slate-300 dark:bg-white/10 mx-0.5" />

            {/* ── Planning group ─────────────────────────────────────── */}
            {activeMode === 'group' && (
              <IconButton
                icon={<FolderPlus className="h-4 w-4" />}
                tooltip={!canEdit
                  ? VIEW_ONLY_TIP
                  : selectedSubDepartmentId ? "Add Subgroup" : "Add Subgroup — select one sub-department first"}
                onClick={() => setIsAddSubGroupOpen(true)}
                variant="success"
                disabled={!selectedSubDepartmentId || !canEdit}
              />
            )}
            <IconButton
              icon={<Wand2 className="h-4 w-4" />}
              tooltip={!canEdit
                ? VIEW_ONLY_TIP
                : hasDepartmentInScope ? "Auto-Schedule" : "Auto-Schedule — select a department first"}
              onClick={() => onAutoScheduleClick?.()}
              variant="success"
              disabled={!hasDepartmentInScope || !canEdit}
            />
            <div className="relative">
              <IconButton
                icon={<CalendarPlus className="h-4 w-4" />}
                tooltip={!canEdit
                  ? VIEW_ONLY_TIP
                  : selectedDepartmentId
                    ? "Templates — apply one to a date range, or capture this roster as a new one"
                    : "Templates — select one department first"}
                onClick={() => setIsTemplatesDialogOpen(true)}
                variant="success"
                disabled={!selectedDepartmentId || !canEdit}
              />
              {appliedCount > 0 && (
                <div className="absolute -top-1 -right-1 h-4 w-4 bg-blue-500 rounded-full border border-slate-100 dark:border-slate-900 flex items-center justify-center pointer-events-none shadow-sm">
                  <span className="text-[9px] font-black text-white leading-none">{appliedCount}</span>
                </div>
              )}
            </div>
            <IconButton
              icon={<Hand className="h-4 w-4" />}
              tooltip={
                !canEdit
                  ? VIEW_ONLY_TIP
                  : activeMode === 'events'
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
              disabled={activeMode === 'events' || isBulkMode || !canEdit}
            />

            <Separator orientation="vertical" className="h-5 bg-slate-300 dark:bg-white/10 mx-0.5" />

            {/* ── View group ─────────────────────────────────────────── */}
            <IconButton
              icon={<Layers className="h-4 w-4" />}
              tooltip={
                !canEdit
                  ? VIEW_ONLY_TIP
                  : isDnDModeActive
                  ? "Bulk Selection — not available in DnD mode"
                  : isBulkMode
                    ? "Exit Bulk Selection (Esc)"
                    : "Bulk Selection mode"
              }
              onClick={onBulkModeToggle || (() => { })}
              isActive={isBulkMode}
              disabled={isDnDModeActive || !canEdit}
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
    </TooltipProvider>
  );
};

export default RosterFunctionBar;
