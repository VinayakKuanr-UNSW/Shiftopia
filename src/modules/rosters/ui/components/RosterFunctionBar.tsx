import React, { useState, Suspense, lazy } from 'react';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
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
  Filter,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { UnifiedRosterNavigator, type ViewType, computeRange, formatRangeLabel } from './UnifiedRosterNavigator';
export type { ViewType } from './UnifiedRosterNavigator';
import { BadgeLegendPopover } from './BadgeLegendPopover';
import { useRosterUI, RosterMode } from '@/modules/rosters/contexts/RosterUIContext';
import {
  ToolbarRow,
  ToolbarSegmented,
  ToolbarIconButton,
  toolbar,
  type ToolbarSegmentedOption,
} from '@/modules/core/ui/components/Toolbar';
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

const ROSTER_MODES: ReadonlyArray<ToolbarSegmentedOption<RosterMode>> = [
  { id: 'group', icon: <Box className="h-3.5 w-3.5" />, label: 'Group' },
  { id: 'people', icon: <Users className="h-3.5 w-3.5" />, label: 'People' },
  { id: 'events', icon: <CalendarDays className="h-3.5 w-3.5" />, label: 'Events' },
  { id: 'roles', icon: <Briefcase className="h-3.5 w-3.5" />, label: 'Roles' },
];

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
    isFilterBarOpen,
    setIsFilterBarOpen,
    advancedFilters,
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

  const committedActiveFilterCount = React.useMemo(() => [
    advancedFilters.stateId,
    advancedFilters.lifecycleStatus !== 'all',
    advancedFilters.assignmentStatus !== 'all',
    advancedFilters.assignmentOutcome !== 'all',
    advancedFilters.biddingStatus !== 'all',
    advancedFilters.tradingStatus !== 'all',
    advancedFilters.roleId,
    advancedFilters.skillIds.length > 0,
    advancedFilters.complianceStatus !== 'all',
    advancedFilters.searchQuery.trim() !== '',
  ].filter(Boolean).length, [advancedFilters]);

  return (
    <TooltipProvider delayDuration={200}>
      <ToolbarRow
        compactOnMobile={compactOnMobile}
        className={!transparent ? toolbar.standalone : undefined}
        views={
          <ToolbarSegmented
            value={activeMode}
            onValueChange={setActiveMode}
            options={ROSTER_MODES}
            // The label is hidden below 2xl, so without this the control
            // announces as an unnamed toggle on every phone.
            itemAriaLabel={(label) => `${label} roster mode`}
            labelFrom="2xl"
          />
        }
        modes={
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
        }
        actions={<>

            {/* ── Data group: Refresh + Legend + Filter ───────────────────────── */}
            <ToolbarIconButton icon={<RefreshCw className="h-5 w-5" />} tooltip="Reload data" onClick={onRefresh} isLoading={isRefreshing} variant="blue" />
            <BadgeLegendPopover />
            <ToolbarIconButton
              icon={<Filter className="h-5 w-5" />}
              tooltip={
                isFilterBarOpen
                  ? 'Close filters'
                  : (committedActiveFilterCount > 0
                      ? `Roster filters (${committedActiveFilterCount} active)`
                      : 'Roster filters')
              }
              onClick={() => setIsFilterBarOpen(!isFilterBarOpen)}
              variant="amber"
              isActive={isFilterBarOpen || committedActiveFilterCount > 0}
              badge={committedActiveFilterCount}
              badgeClassName="bg-orange-500 text-white"
            />

            {/* ── Planning group ─────────────────────────────────────── */}
            {activeMode === 'group' && (
              <ToolbarIconButton
                icon={<FolderPlus className="h-5 w-5" />}
                tooltip={!canEdit
                  ? VIEW_ONLY_TIP
                  : selectedSubDepartmentId ? "Add Subgroup" : "Add Subgroup — select one sub-department first"}
                onClick={() => setIsAddSubGroupOpen(true)}
                variant="emerald"
                disabled={!selectedSubDepartmentId || !canEdit}
              />
            )}
            <ToolbarIconButton
              icon={<Wand2 className="h-5 w-5" />}
              tooltip={!canEdit
                ? VIEW_ONLY_TIP
                : hasDepartmentInScope ? "Auto-Schedule" : "Auto-Schedule — select a department first"}
              onClick={() => onAutoScheduleClick?.()}
              variant="purple"
              disabled={!hasDepartmentInScope || !canEdit}
            />
            <ToolbarIconButton
              icon={<CalendarPlus className="h-5 w-5" />}
              tooltip={!canEdit
                ? VIEW_ONLY_TIP
                : selectedDepartmentId
                  ? "Templates — apply one to a date range, or capture this roster as a new one"
                  : "Templates — select one department first"}
              onClick={() => setIsTemplatesDialogOpen(true)}
              variant="indigo"
              disabled={!selectedDepartmentId || !canEdit}
              badge={appliedCount}
              badgeClassName="bg-blue-500 text-white"
            />
            <ToolbarIconButton
              icon={<Hand className="h-5 w-5" />}
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
              variant="amber"
              disabled={activeMode === 'events' || isBulkMode || !canEdit}
            />

            {/* ── View group ─────────────────────────────────────────── */}
            <ToolbarIconButton
              icon={<Layers className="h-5 w-5" />}
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
              variant="indigo"
              disabled={isDnDModeActive || !canEdit}
            />

            {/* ── Publish group ───────────────────────────────────────── */}
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
        </>}
      />

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
    </TooltipProvider>
  );
};

export default RosterFunctionBar;
