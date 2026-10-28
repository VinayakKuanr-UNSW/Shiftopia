import React, { useState, useEffect, useMemo, useRef, useCallback, startTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { getSydneyNow, isSydneyPast, isSydneyStarted, parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import {
  Plus,
  Check,
  Loader2,
  MoreHorizontal,
  MoreVertical,
  Edit2,
  Trash2,
  Gavel,
  Send,
  Undo2,
  Ban,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Zap,
  Lock,
  Wand2,
  Users,
  CopyPlus,
  Maximize2,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { getPublicHolidayName } from '@/modules/core/lib/holidays';
import { Button } from '@/modules/core/ui/primitives/button';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { format, addDays, isToday, isBefore, startOfDay, parseISO, isSameDay, differenceInHours, differenceInMinutes, parse } from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';
import { useDrag, useDrop } from 'react-dnd';
import {
  ShiftContext,
} from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import { useShiftFormNav } from '@/modules/rosters/hooks/useShiftFormNav';
import { useAllTemplates } from '@/modules/templates/hooks/queries/useTemplateQueries';

import {
  RenameSubGroupDialog,
  CloneSubGroupDialog,
  DeleteSubGroupDialog
} from '@/modules/rosters/ui/dialogs/SubGroupActionsDialogs';
import {
  describeSubgroupClone,
  describeSubgroupDeletion,
  describeSubgroupRename,
  formatRange,
} from '@/modules/rosters/ui/dialogs/rosterChangeCopy';
import {
  cloneRosterSubgroup,
  deleteRosterSubgroup,
  renameRosterSubgroup,
  type SubgroupScope,
} from '@/modules/rosters/api/rosterSubgroups.api';
import { hasFixedSubgroup } from '@/modules/rosters/domain/subgroupRules';
import { SmartShiftCard, type ComplianceInfo } from '@/modules/rosters/ui/components/SmartShiftCard';
// Named import, not `import * as`: react-refresh cannot reliably re-bind a
// React.memo() const through a namespace object, so on hot update the member
// read back as undefined and React threw "type is invalid ... got: undefined"
// at the call site below.
import { GroupSummaryCell } from '@/modules/rosters/ui/components/GroupSummaryCell';
import { RosterCellAddButton } from '@/modules/rosters/ui/components/RosterCellAddButton';
import { GroupStatsSummary } from '@/modules/rosters/ui/components/GroupStatsSummary';
import { ShiftCardLegend } from '@/modules/rosters/ui/components/ShiftCardLegend';
import { RosterEmptyState } from '@/modules/rosters/ui/components/RosterEmptyState';
import {
  Shift,
  TemplateGroupType,
} from '@/modules/rosters/api/shifts.api';
import { useRosterStructure } from '@/modules/rosters/state/useRosterStructure';
import { RosterStructure, RosterGroupStructure, RosterSubGroupStructure } from '@/modules/rosters/model/roster.types';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
  useDeleteShift,
  useUpdateShift,
  useBulkDeleteShifts,
  useBulkPublishShifts,
  useBulkUnpublishShifts,
  usePublishShift,
  useUnpublishShift,
  useCreateShift,
  useEmployees,
  snapshotLists,
  rollbackLists,
  patchLists,
} from '@/modules/rosters/state/useRosterShifts';
import {
  useAddSubGroup,
  useAddSubGroupRange,
  useDeleteSubGroup,
  useRenameSubGroup,
  useCloneSubGroup
} from '@/modules/rosters/state/useRosterMutations';
import { computeShiftUrgency, computeBiddingUrgency, isOnBidding } from '../../domain/bidding-urgency';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { startOfMonth, endOfMonth, endOfWeek } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { executeAssignShift } from '@/modules/rosters/domain/commands/assignShift.command';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { shiftsCommands } from '@/modules/rosters/api/shifts.commands';
import {
  PeopleModeEmployee,
  PeopleModeShift,
  DND_SHIFT_TYPE,
  DND_EMPLOYEE_TYPE,
  EmployeeDragItem,
  ShiftDragItem,
} from './people-mode.types';
import { DndAssignModal } from '@/modules/rosters/ui/dialogs/DndAssignModal';
import { determineShiftState } from '@/modules/rosters/domain/shift-state.utils';
import { applyAdvancedFilters } from '@/modules/rosters/domain/projections/utils/filters';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
// complianceService and calculateMinutesBetweenTimes removed — handleShiftDrop now
// routes through executeAssignShift which encapsulates all compliance logic.

import { canDragShift, canDropOnTarget } from '@/modules/rosters/utils/dnd.utils';
import { ToastAction } from '@/modules/core/ui/primitives/toast';
import type { GroupProjection } from '@/modules/rosters/domain/projections/types';
import { ALL_GROUP_TYPES } from '@/modules/rosters/domain/projections/constants';
import { CopyShiftFlow, type CopyShiftSource } from '@/modules/office/ui/components/CopyShiftFlow';
import { ShiftExpandDialog } from '@/modules/rosters/ui/dialogs/ShiftExpandDialog';
import { ShiftAuditDialog } from '@/modules/rosters/ui/dialogs/ShiftAuditDialog';
import type { CoverageHealth } from '@/modules/rosters/domain/projections/utils/coverage';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';

// ============================================================================
// DRAG & DROP TYPE
// ============================================================================

// ============================================================================

type DragItem = ShiftDragItem;

// ============================================================================
// DRAGGABLE SHIFT CARD WRAPPER
// ============================================================================

interface DraggableShiftCardProps {
  shift: ShiftDisplay;
  groupType: TemplateGroupType | 'unassigned';
  subGroupName: string;
  children: React.ReactNode;
  disabled?: boolean;
  /** When false, no useDrag is registered — the card renders inert. Gated on
   *  DnD mode so populated grids don't pay per-card drag registration. */
  active?: boolean;
}

const DraggableShiftCardActive: React.FC<DraggableShiftCardProps> = React.memo(({
  shift,
  groupType,
  subGroupName,
  children,
  disabled,
}) => {
  // canDrag reads isDnDModeActive imperatively — see PeopleModeGrid for why.
  const [{ isDragging }, drag] = useDrag(() => ({
    type: DND_SHIFT_TYPE,
    item: {
      shiftId: shift.id,
      sourceGroupType: groupType,
      sourceSubGroup: subGroupName,
      shiftDate: shift.rawShift.shift_date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      lifecycle_status: shift.status === 'Published' ? 'Published' : 'Draft',
      is_cancelled: shift.isCancelled,
    } as DragItem,
    canDrag: () => canDragShift(shift, useRosterStore.getState().isDnDModeActive) && !disabled,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [shift.id, groupType, subGroupName, disabled, shift.status, shift.isCancelled]);

  return (
    <div
      ref={drag}
      className={cn(
        !disabled && isDragging && 'opacity-50 cursor-grabbing scale-105 rotate-1 shadow-2xl transition-transform'
      )}
    >
      {children}
    </div>
  );
});

DraggableShiftCardActive.displayName = 'DraggableShiftCardActive';

// Gate: only register useDrag when `active` (DnD mode on). Otherwise render the
// card inert in a plain div, so populated grids don't mount a useDrag per card.
const DraggableShiftCard: React.FC<DraggableShiftCardProps> = ({ active = true, ...props }) => {
  if (!active) {
    return <div>{props.children}</div>;
  }
  return <DraggableShiftCardActive {...props} />;
};

// ============================================================================
// DROPPABLE CELL WRAPPER
// ============================================================================

interface DroppableCellProps {
  groupType: TemplateGroupType | 'unassigned';
  subGroupName: string;
  groupId: string;
  subGroupId: string;
  date: string;
  onDrop: (item: DragItem, targetGroupType: TemplateGroupType | 'unassigned', targetSubGroup: string, targetDate: string, targetGroupId: string, targetSubGroupId: string) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  /** When false, no react-dnd drop target is registered (renders a plain div).
   *  The grid mounts hundreds of cells in week/month views; registering a
   *  useDrop per cell when DnD mode is off dominated INP (~253ms processing on
   *  an empty month grid). Gate registration on the DnD toggle. */
  active?: boolean;
}

const DroppableCellActive: React.FC<DroppableCellProps> = ({
  groupType,
  subGroupName,
  groupId,
  subGroupId,
  date,
  onDrop,
  children,
  className,
  disabled,
}) => {
  // Pre-computed per cell. react-dnd evaluates canDrop on every mousemove
  // for every registered target — running the date parse + isSydneyPast on
  // each call across ~1.4k cells was a big contributor to drag latency.
  const isPastDate = React.useMemo(
    () => isSydneyPast(parse(date, 'yyyy-MM-dd', new Date())),
    [date],
  );

  // canDrop reads isDnDModeActive imperatively — see DraggableShiftCard.
  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: DND_SHIFT_TYPE,
    drop: (item: DragItem) => {
      if (disabled) return;
      const movingGroup = item.sourceGroupType !== groupType || item.sourceSubGroup !== subGroupName;
      const movingDate = item.shiftDate !== date;
      if (movingGroup || movingDate) {
        onDrop(item, groupType, subGroupName, date, groupId, subGroupId);
      }
    },
    canDrop: (item: DragItem) => {
      return canDropOnTarget(
        useRosterStore.getState().isDnDModeActive,
        {
          lifecycle_status: item.lifecycle_status,
          is_cancelled: item.is_cancelled,
        },
        {
          isLocked: disabled,
          isPast: isPastDate,
          targetDate: date,
          startTime: item.startTime,
        }
      );
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [groupType, subGroupName, groupId, subGroupId, date, onDrop, disabled, isPastDate]);

  return (
    <div
      ref={drop}
      className={cn(
        className,
        !disabled && isOver && canDrop && 'ring-2 ring-emerald-400 ring-inset bg-emerald-500/10',
        !disabled && isOver && !canDrop && 'ring-2 ring-red-400 ring-inset bg-red-500/10'
      )}
    >
      {children}
    </div>
  );
};

// Gate: only mount the react-dnd drop target when `active` (DnD mode on).
// Default view (DnD off) renders a plain div, so week/month grids don't pay
// for hundreds of useDrop registrations. Swapping component types on toggle
// remounts the cell — acceptable for an explicit mode switch.
const DroppableCell: React.FC<DroppableCellProps> = ({ active = true, ...props }) => {
  if (!active) {
    return <div className={props.className}>{props.children}</div>;
  }
  return <DroppableCellActive {...props} />;
};

// ============================================================================
// DROPPABLE SHIFT ASSIGN WRAPPER (Group Mode — employee-to-shift DnD)
// ============================================================================

interface DroppableShiftAssignProps {
  shiftId: string;
  /** Role name of the shift — used for lightweight UI role-match hint */
  shiftRole: string;
  canAccept: boolean;
  onAssign: (shiftId: string, dragItem: EmployeeDragItem) => void;
  children: React.ReactNode;
}

const DroppableShiftAssign: React.FC<DroppableShiftAssignProps> = ({
  shiftId,
  shiftRole,
  canAccept,
  onAssign,
  children,
}) => {
  const [{ isOver, canDrop }, drop] = useDrop<EmployeeDragItem, void, { isOver: boolean; canDrop: boolean }>(
    () => ({
      accept: DND_EMPLOYEE_TYPE,
      // Role match: allow if employee has no role OR role name matches shift role.
      // Backend compliance engine is the definitive gate; this is a UX hint only.
      canDrop: (item: EmployeeDragItem) =>
        canAccept && (!item.roleName || item.roleName === shiftRole),
      drop: (item: EmployeeDragItem) => {
        onAssign(shiftId, item);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [shiftId, shiftRole, canAccept, onAssign],
  );

  return (
    <div
      ref={drop}
      className={cn(
        isOver && canDrop && 'ring-2 ring-emerald-400 ring-inset rounded-lg bg-emerald-500/5',
        isOver && !canDrop && 'ring-2 ring-red-400 ring-inset rounded-lg opacity-60',
      )}
    >
      {children}
    </div>
  );
};

// ============================================================================
// COLLAPSIBLE STATE HOOK (localStorage-persisted)
// ============================================================================

function useCollapsedGroups(): [Set<string>, (groupId: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem('roster_collapsed_groups');
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set();
  });

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      localStorage.setItem('roster_collapsed_groups', JSON.stringify([...next]));
      return next;
    });
  }, []);

  return [collapsed, toggleGroup];
}

/* ============================================================
   INTERFACES
   ============================================================ */
interface GroupModeViewProps {
  selectedDate: Date;
  viewType: 'day' | '3day' | 'week' | 'month';
  canEdit: boolean;
  organizationId?: string;
  organizationName?: string;
  rosterId?: string;
  departmentId?: string;
  departmentName?: string;
  subDepartmentId?: string;
  subDepartmentName?: string;
  /** Phase-2: typed projection snapshot from useRosterProjections */
  projection?: import('@/modules/rosters/domain/projections/types').GroupProjection;
  // Ghost Cell Navigation - template date bounds
  templateStartDate?: Date;
  templateEndDate?: Date;
  onNavigateToMonth?: (date: Date) => void;
  onAddShift?: (
    groupName: string,
    subGroupName: string,
    groupColor: string,
    date?: Date,
    rosterId?: string
  ) => void;
  // Bulk Mode
  isBulkMode: boolean;
  onBulkModeToggle: (enabled: boolean) => void;
  /** Shifts data from parent useRosterShifts hook. Required for presentational mode. */
  shifts: Shift[];
  /** Loading state from parent */
  isShiftsLoading?: boolean;
  /** Compliance data map for SmartShiftCard rendering */
  complianceMap?: Record<string, ComplianceInfo>;
  /** Show the shift card legend panel */
  showLegend?: boolean;
  /** Zoom level for Day Timeline View (1h fixed) */
  dayZoom?: 60;
  selectedV8ShiftIds?: string[];
  onToggleShiftSelection?: (shiftId: string) => void;
  onSelectShiftIds?: (ids: string[]) => void;
  onDeselectShiftIds?: (ids: string[]) => void;
  /** Centralized employee-to-shift assignment handler (from RostersPlannerPage) */
  onAssignShift?: (shiftId: string, employeeId: string, employeeName: string) => void;
  /** Phase-3: pre-aggregated server-side summary map for month view */
  summaryData?: Map<string, import('@/modules/rosters/api/rosterSummary.queries').RosterSummaryCellDTO>;
  /** Callback to open drill-down panel */
  onDrillDown?: (date: string, groupType: string, subGroupName?: string) => void;
  footerStats?: {
    totalShifts: number;
    assignedShifts: number;
    unfilledShifts: number;
    estimatedCost: number;
    budget: number;
    remainingBudget: number;
    /** Roster as planned — all live shifts in view, filled or not. */
    scheduledCost: number;
    /** What was actually worked. */
    actualCost: number;
    scheduledNetMinutes: number;
    actualNetMinutes: number;
    costedShifts: number;
    /** Live shifts with no resolvable rate — they silently contribute $0. */
    uncostedShifts: number;
    /** Live shifts actually worked — denominator for actualCost. */
    actualShifts: number;
  };
  /**
   * Show the Budget / Remaining stat blocks in the footer. Defaults to false:
   * budget hidden until a real budget source (e.g. planning_periods) is wired —
   * the current budget is a hardcoded placeholder that yields a fake negative
   * "Remaining". Est. Cost is always shown regardless of this flag.
   */
  showBudget?: boolean;
}

interface VisualGroup {
  id: string;
  name: string;
  type: TemplateGroupType | 'unassigned';
  color: string;
  subGroups: VisualSubGroup[];
  /** Phase-2: staffing coverage from projection (used by CoverageSignalBar) */
  coverage?: CoverageHealth;
  /** Phase-2: total scheduled hours across all subgroups */
  totalHours?: number;
}

interface VisualSubGroup {
  id: string;
  name: string;
  shifts: Record<string, ShiftDisplay[]>;
}

interface ShiftDisplay {
  id: string;
  role: string;
  startTime: string;
  endTime: string;
  employeeName?: string;
  status: 'Open' | 'Assigned' | 'Completed' | 'Draft' | 'Published';
  isPublished: boolean;
  isDraft: boolean;
  isOnBidding: boolean;
  isTrading: boolean;
  isCancelled: boolean;
  groupColor: string; // For shift card coloring
  subGroup?: string; // Added for card display
  assignedEmployeeId?: string | null;
  rawShift: Shift;
  isUrgent: boolean;
  isLocked?: boolean;
  assignmentOutcome?: string;
  detailedCost?: import('@/modules/rosters/domain/projections/utils/cost/types').ShiftCostBreakdown;
}

/* ============================================================
   GROUP COLOR CONFIG - Used for shift cards
   ============================================================ */
const GROUP_COLORS: Record<TemplateGroupType, {
  card: string;
  cardBorder: string;
  badge: string;
  accent: string;
}> = {
  convention_centre: {
    card: 'bg-blue-500/10 hover:bg-blue-500/15',
    cardBorder: 'border-l-blue-500',
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
    accent: 'blue',
  },
  exhibition_centre: {
    card: 'bg-emerald-500/10 hover:bg-emerald-500/15',
    cardBorder: 'border-l-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    accent: 'emerald',
  },
  theatre: {
    card: 'bg-red-500/10 hover:bg-red-500/15',
    cardBorder: 'border-l-red-500',
    badge: 'bg-red-100 text-red-700 border-red-200',
    accent: 'red',
  },
  the_cutaway: {
    card: 'bg-amber-500/10 hover:bg-amber-500/15',
    cardBorder: 'border-l-amber-500',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    accent: 'amber',
  },
  office: {
    card: 'bg-cyan-500/10 hover:bg-cyan-500/15',
    cardBorder: 'border-l-cyan-500',
    badge: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    accent: 'cyan',
  },
};

/* ============================================================
   GLASSMORPHISM STYLES
   ============================================================ */
const GLASS_STYLES: Record<TemplateGroupType, {
  container: string;
  header: string;
  headerText: string;
  accent: string;
}> = {
  convention_centre: {
    container: 'bg-white dark:bg-blue-500/5 backdrop-blur-xl border border-blue-200 dark:border-blue-500/20 shadow-sm',
    header: 'bg-gradient-to-r from-blue-700 to-blue-600 dark:from-blue-600/90 dark:to-blue-500/80 backdrop-blur-md border-b border-blue-400/30',
    headerText: 'text-white',
    accent: 'blue',
  },
  exhibition_centre: {
    container: 'bg-white dark:bg-emerald-500/5 backdrop-blur-xl border border-emerald-200 dark:border-emerald-500/20 shadow-sm',
    header: 'bg-gradient-to-r from-emerald-700 to-emerald-600 dark:from-emerald-600/90 dark:to-emerald-500/80 backdrop-blur-md border-b border-emerald-400/30',
    headerText: 'text-white',
    accent: 'emerald',
  },
  theatre: {
    container: 'bg-white dark:bg-red-500/5 backdrop-blur-xl border border-red-200 dark:border-red-500/20 shadow-sm',
    header: 'bg-gradient-to-r from-red-700 to-red-600 dark:from-red-600/90 dark:to-red-500/80 backdrop-blur-md border-b border-red-400/30',
    headerText: 'text-white',
    accent: 'red',
  },
  the_cutaway: {
    container: 'bg-white dark:bg-amber-500/5 backdrop-blur-xl border border-amber-200 dark:border-amber-500/20 shadow-sm',
    header: 'bg-gradient-to-r from-amber-700 to-amber-600 dark:from-amber-600/90 dark:to-amber-500/80 backdrop-blur-md border-b border-amber-400/30',
    headerText: 'text-white',
    accent: 'amber',
  },
  office: {
    container: 'bg-white dark:bg-cyan-500/5 backdrop-blur-xl border border-cyan-200 dark:border-cyan-500/20 shadow-sm',
    header: 'bg-gradient-to-r from-cyan-800 to-cyan-700 dark:from-cyan-600/90 dark:to-cyan-500/80 backdrop-blur-md border-b border-cyan-400/30',
    headerText: 'text-white',
    accent: 'cyan',
  },
};

// Unassigned group style (separate to avoid type conflicts)
const UNASSIGNED_GLASS_STYLE = {
  container: 'bg-white dark:bg-gray-500/5 backdrop-blur-xl border border-slate-300 dark:border-gray-500/30 border-dashed shadow-sm',
  header: 'bg-gradient-to-r from-slate-700 to-slate-600 dark:from-gray-600/90 dark:to-gray-500/80 backdrop-blur-md border-b border-slate-400/30 dark:border-gray-400/30',
  headerText: 'text-white',
  accent: 'gray',
};

// Default sub-groups per group type - Empty by default, populated by templates
const DEFAULT_SUB_GROUPS_MAP: Record<TemplateGroupType, string[]> = {
  convention_centre: [],
  exhibition_centre: [],
  theatre: [],
  the_cutaway: [],
  office: [],
};

// Human-readable group names
const GROUP_DISPLAY_NAMES: Record<TemplateGroupType | 'unassigned', string> = {
  convention_centre: 'Convention Centre',
  exhibition_centre: 'Exhibition Centre',
  theatre: 'Theatre',
  the_cutaway: 'The Cutaway',
  office: 'Office',
  unassigned: 'Unassigned',
};

/* ============================================================
   COVERAGE SIGNAL BAR — segmented LED strip for group headers
   ============================================================ */

/** `420` → `7h 0m`; used as each cost panel's supporting hours figure. */
const formatNetMinutes = (mins: number): string => {
  const safe = Math.max(0, Math.round(mins));
  return `${Math.floor(safe / 60)}h ${safe % 60}m`;
};

interface CostPanelProps {
  label: string;
  amount: number;
  minutes: number;
  /** Denominator line — what the amount is actually over. */
  countLabel: string;
  /** Amber tint: some shifts in scope resolved no rate, so the total is short. */
  warn?: boolean;
  /** Dim the amount when it is a structural zero rather than a real $0. */
  muted?: boolean;
  tone: 'planned' | 'actual';
}

/**
 * One cost total for the CURRENT view, with its own denominator.
 *
 * The denominator is the point: a bare "$0.00" cannot distinguish "nothing has
 * been worked yet" from "nothing could be priced" from "genuinely free". The
 * previous single Est. Cost read $0.00 across a fully-costed 156-shift roster
 * because it silently counted only ASSIGNED shifts.
 */
const CostPanel: React.FC<CostPanelProps> = ({
  label, amount, minutes, countLabel, warn = false, muted = false, tone,
}) => (
  <div
    className={cn(
      'rounded-lg border px-3 py-1.5 min-w-[132px]',
      tone === 'planned'
        ? 'border-blue-400/25 bg-blue-400/[0.06]'
        : 'border-emerald-400/25 bg-emerald-400/[0.06]',
    )}
  >
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={cn(
          'text-[11px] font-bold uppercase tracking-wider',
          tone === 'planned' ? 'text-blue-300/80' : 'text-emerald-300/80',
        )}
      >
        {label}
      </span>
      <span className="text-[11px] text-muted-foreground/60 tabular-nums">
        {formatNetMinutes(minutes)}
      </span>
    </div>
    <div
      className={cn(
        'font-semibold tabular-nums leading-tight',
        muted ? 'text-muted-foreground/50' : 'text-foreground',
      )}
    >
      ${amount.toFixed(2)}
    </div>
    <div
      className={cn(
        'text-[11px] leading-tight',
        warn ? 'text-amber-400' : 'text-muted-foreground/50',
      )}
      title={warn ? 'Some shifts in view have no resolvable pay rate and contribute $0 to this total.' : undefined}
    >
      {countLabel}
    </div>
  </div>
);

interface CoverageSignalBarProps {
  pct: number;      // 0-100
  accent: string;   // 'blue' | 'emerald' | 'red' | 'amber' | 'cyan' | 'gray'
  segments?: number;
}

const CoverageSignalBar: React.FC<CoverageSignalBarProps> = ({ pct, accent, segments = 10 }) => {
  const filled = Math.round((pct / 100) * segments);
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-400',
    emerald: 'bg-emerald-400',
    red: 'bg-red-400',
    amber: 'bg-amber-400',
    cyan: 'bg-cyan-400',
    gray: 'bg-slate-400',
  };
  const barColor = colorMap[accent] ?? 'bg-white/40';
  return (
    <div className="flex items-center gap-[2px]" aria-label={`${pct}% staffed`}>
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          style={{ animationDelay: `${i * 40}ms` }}
          className={cn(
            'h-[5px] w-[14px] rounded-sm transition-all duration-300',
            i < filled
              ? cn(barColor, 'opacity-90 animate-[signalFill_0.3s_ease_forwards]')
              : 'bg-muted-foreground/10 dark:bg-white/10'
          )}
        />
      ))}
    </div>
  );
};

/* ============================================================
   SUBGROUP BODY
   ------------------------------------------------------------
   Each canonical group renders one of these inside its CSS-grid "table".
   Rows are plain in-flow <div role="row">s laid out with `display: grid`
   using the SAME `gridTemplateColumns` as the header, so columns always
   align. Not virtualized — see note on the component below.
   ============================================================ */

// Shared column template for the subgroup grid. The header and every row
// reference the SAME track sizes via one CSS-grid `gridTemplateColumns`, so
// columns can never drift. This is the structural fix that replaced the old
// <table>: its rows left the table's column model and the grid lines
// misaligned. With CSS grid there are no per-cell widths to forget.
const GROUP_COL_SUB_W = 240; // px — sticky sub-group label column (standardized across modes)
const GROUP_COL_DAY_W = 280; // px — per-day column
const groupGridCols = (dayCount: number) =>
  `${GROUP_COL_SUB_W}px repeat(${dayCount}, minmax(${GROUP_COL_DAY_W}px, 1fr))`;


// Month view is bounded to the selected month ± this many days (calendar
// continuity buffer). Must match RostersPlannerPage's fetch window so the
// rendered columns line up with the data that was actually fetched.
const MONTH_BUFFER_DAYS = 3;

interface VirtualizedSubGroupBodyProps {
  subGroups: VisualSubGroup[];
  /** CSS grid track template shared with the header row so columns align. */
  gridTemplateColumns: string;
  /** Render the row's cell <div>s for the given subgroup row. */
  renderRow: (subGroup: VisualSubGroup, subIdx: number) => React.ReactNode;
  /** Optional className applied per row (e.g. for alternating borders). */
  getRowClassName?: (subGroup: VisualSubGroup, subIdx: number) => string;
  // Skeleton rows are appended as a static slot below the real rows
  // when populated subgroups don't exist yet — they reserve space
  // during the loading phase.
  skeletonSlot?: React.ReactNode;
}

// Subgroup rows are NOT virtualized: a group has only a handful of subgroups
// (AM Base, PM Base, …), so windowing them buys nothing and the absolute
// positioning it requires fought the Radix ScrollArea's scroll-element timing
// (rows overlapped, then rendered empty). The heavy part is the shift CELLS,
// which render either way. Plain in-flow grid rows are robust and align via the
// shared `gridTemplateColumns`. (PeopleModeGrid keeps virtualization — it has
// 100+ employee rows.)
const VirtualizedSubGroupBody: React.FC<VirtualizedSubGroupBodyProps> = ({
  subGroups,
  gridTemplateColumns,
  renderRow,
  getRowClassName,
  skeletonSlot,
}) => {
  return (
    <div>
      {subGroups.map((subGroup, idx) => {
        if (!subGroup) return null;
        return (
          <div
            role="row"
            key={subGroup.id}
            className={cn('grid', getRowClassName?.(subGroup, idx))}
            style={{
              gridTemplateColumns,
            }}
          >
            {renderRow(subGroup, idx)}
          </div>
        );
      })}
      {skeletonSlot}
    </div>
  );
};

/* ============================================================
   GROUP CELL SHIFT LIST
   ------------------------------------------------------------
   Renders a single cell's shift bucket container, always showing all
   shifts in the compact bucket layout.
   ============================================================ */
interface GroupCellShiftListProps {
  shifts: ShiftDisplay[];
  renderItem: (shift: ShiftDisplay, idx: number) => React.ReactNode;
}

const GroupCellShiftList: React.FC<GroupCellShiftListProps> = ({ shifts, renderItem }) => {
  if (!shifts || shifts.length === 0) return null;

  // Always ensure shifts in the container of a cell are sorted chronologically by start time
  const sortedShifts = [...shifts].sort((a, b) => {
    const timeA = a.startTime || a.rawShift?.start_time || '';
    const timeB = b.startTime || b.rawShift?.start_time || '';
    return timeA.localeCompare(timeB);
  });

  return (
    <div className="w-full">
      <div className="rounded-xl border border-white/10 dark:border-white/10 bg-slate-900/60 dark:bg-slate-900/60 overflow-hidden divide-y divide-white/[0.06] dark:divide-white/[0.06] shadow-sm w-full">
        {sortedShifts.map((shift, idx) => renderItem(shift, idx))}
      </div>
    </div>
  );
};

interface GroupSectionProps {
  group: VisualGroup;
  dates: Date[];
  isShiftsLoading: boolean;
  canEdit: boolean;
  isBulkMode: boolean;
  externalShifts: Shift[];
  isDateInTemplate: (date: Date) => boolean;
  shiftsByBucketKey: Map<string, Shift[]>;
  selectedV8ShiftIdsSet: Set<string>;
  onDeselectShiftIds?: (ids: string[]) => void;
  onSelectShiftIds?: (ids: string[]) => void;
  isDnDModeActive: boolean;
  summaryData: any;
  onDrillDown?: (dateKey: string, groupType: string, subGroupName: string) => void;
  onNavigateToMonth?: (date: Date) => void;
  renderShiftCard: (
    shift: ShiftDisplay,
    group: VisualGroup,
    subGroup: VisualSubGroup,
    date: Date
  ) => React.ReactNode;
  handleAddShift: (group: VisualGroup, subGroup: VisualSubGroup, date: Date) => void;
  handleShiftDrop: (item: DragItem, targetGroupType: TemplateGroupType | 'unassigned', targetSubGroup: string, targetDate: string, targetGroupId: string, targetSubGroupId: string) => void;
  handleEmployeeDrop: (shiftId: string, dragItem: EmployeeDragItem) => void;
  setActiveSubGroup: (subGroup: { id: string; name: string; groupExternalId: string } | null) => void;
  setIsRenameOpen: (open: boolean) => void;
  setIsCloneOpen: (open: boolean) => void;
  setIsDeleteOpen: (open: boolean) => void;
  getSubGroupTemplateLabel: (subGroup: VisualSubGroup) => string | null;
  /** Why Rename / Clone / Delete are unavailable right now, or null when they are. */
  subGroupActionsBlockedReason: string | null;

  // Persisted collapse props
  isInitiallyCollapsed: boolean;
  onToggleCollapse: (groupId: string) => void;
}

const GroupSection: React.FC<GroupSectionProps> = ({
  group,
  dates,
  isShiftsLoading,
  canEdit,
  isBulkMode,
  externalShifts,
  isDateInTemplate,
  shiftsByBucketKey,
  selectedV8ShiftIdsSet,
  onDeselectShiftIds,
  onSelectShiftIds,
  isDnDModeActive,
  summaryData,
  onDrillDown,
  onNavigateToMonth,
  renderShiftCard,
  handleAddShift,
  handleShiftDrop,
  handleEmployeeDrop,
  setActiveSubGroup,
  setIsRenameOpen,
  setIsCloneOpen,
  setIsDeleteOpen,
  getSubGroupTemplateLabel,
  subGroupActionsBlockedReason,
  isInitiallyCollapsed,
  onToggleCollapse,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(isInitiallyCollapsed);

  // Sync with prop changes
  useEffect(() => {
    setIsCollapsed(isInitiallyCollapsed);
  }, [isInitiallyCollapsed]);

  const handleToggle = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    React.startTransition(() => {
      onToggleCollapse(group.id);
    });
  };

  const glassStyle = group.type === 'unassigned'
    ? UNASSIGNED_GLASS_STYLE
    : GLASS_STYLES[group.type as TemplateGroupType] ?? UNASSIGNED_GLASS_STYLE;

  const summaryCellsForGroup = useMemo((): any[] => {
    if (!summaryData) return [];
    return Array.from(summaryData.values()).filter((cell: any) => cell.group_type === group.type);
  }, [summaryData, group.type]);

  const totalShifts: number = useMemo(() => {
    if (summaryData) {
      return summaryCellsForGroup.reduce((acc: number, cell: any) => acc + (cell.total_shifts || 0), 0) as number;
    }
    return group.subGroups.reduce(
      (acc, sg) => acc + Object.values(sg.shifts).reduce((a, s) => a + s.length, 0),
      0
    );
  }, [group.subGroups, summaryData, summaryCellsForGroup]);

  const assignedShifts: number = useMemo(() => {
    if (summaryData) {
      return summaryCellsForGroup.reduce((acc: number, cell: any) => acc + (cell.assigned_shifts || 0), 0) as number;
    }
    return group.subGroups.reduce(
      (acc, sg) => acc + Object.values(sg.shifts).reduce((a, s) => a + s.filter(sh => sh.assignedEmployeeId).length, 0),
      0
    );
  }, [group.subGroups, summaryData, summaryCellsForGroup]);

  const totalHours: number = useMemo(() => {
    if (summaryData) {
      return summaryCellsForGroup.reduce((acc: number, cell: any) => acc + (cell.total_net_minutes || 0) / 60, 0) as number;
    }
    return 0;
  }, [summaryData, summaryCellsForGroup]);

  const uniqueEmployeesCount: number = useMemo(() => {
    if (summaryData) {
      return summaryCellsForGroup.reduce((acc: number, cell: any) => acc + (cell.unique_employees || 0), 0) as number;
    }
    return 0;
  }, [summaryData, summaryCellsForGroup]);

  const coveragePct = totalShifts > 0 ? Math.min(100, Math.round((assignedShifts / totalShifts) * 100)) : 100;

  const filteredShiftsForStats = useMemo(() =>
    externalShifts.filter(s => s.group_type === group.type),
    [externalShifts, group.type]
  );

  return (
    <div
      className={cn(
        'rounded-2xl overflow-hidden [contain:layout]',
        glassStyle.container,
        !isCollapsed && isShiftsLoading && group.subGroups.length === 0 ? 'min-h-[420px]' : ''
      )}
      style={{
        contentVisibility: 'auto' as any,
        containIntrinsicSize: isCollapsed ? 'auto 54px' : 'auto 600px',
      }}
    >
      {/* Group Header with Collapse Toggle + Stats */}
      <div className={cn('px-5 py-3', glassStyle.header)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Collapse Toggle Button */}
            <button
              onClick={handleToggle}
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label={isCollapsed ? `Expand ${group.name} group` : `Collapse ${group.name} group`}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 text-white" />
              ) : (
                <ChevronDown className="h-4 w-4 text-white" />
              )}
            </button>
            <div className="w-3 h-3 rounded-full bg-white shadow-sm" />
            <div>
              <h3 className={cn('text-[15px] font-bold tracking-wide leading-tight drop-shadow-sm', glassStyle.headerText)}>
                {group.name}
              </h3>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Inline Group Stats */}
            {summaryData ? (
              <div className="flex items-center gap-3 text-[11px] text-white/95 font-medium">
                <span className="text-emerald-200 dark:text-emerald-400 font-bold">{totalHours.toFixed(0)}h</span>
                <span className="text-white/60">|</span>
                <span className="text-white/95">
                  <Users className="h-3.5 w-3.5 inline mr-1 text-white/90" />
                  {uniqueEmployeesCount} employee{uniqueEmployeesCount !== 1 ? 's' : ''}
                </span>
              </div>
            ) : (
              <GroupStatsSummary
                shifts={filteredShiftsForStats}
                compact
                className="text-white/95 font-medium"
              />
            )}
            <Badge className="bg-white/25 border-white/40 text-white backdrop-blur-sm text-[11px] font-bold font-mono tabular-nums px-2.5 py-0.5 shadow-sm">
              {assignedShifts}/{totalShifts} filled
            </Badge>

          </div>
        </div>
      </div>

      {/* Collapsible Content */}
      {!isCollapsed && (
        <div className="overflow-auto">
          <div role="table" className="relative" style={{ width: 'max-content', minWidth: '100%' }}>
            <div role="row" className="grid sticky top-0 z-20 bg-slate-100/95 dark:bg-muted/80 backdrop-blur-md border-b border-slate-300 dark:border-border" style={{ gridTemplateColumns: groupGridCols(dates.length) }}>
              <div role="columnheader" className="sticky left-0 z-30 flex items-center border-r border-b border-slate-300 dark:border-border px-3 py-2 text-left sticky-subgroup-header shadow-[2px_0_6px_-2px_rgba(0,0,0,0.15)]">
                <span className="text-[11px] font-bold text-slate-700 dark:text-muted-foreground uppercase tracking-[0.14em] font-mono">Sub-Group</span>
              </div>
              {dates.map((date, idx) => {
                const dateIsToday = isToday(date);
                const dateIsPast = isSydneyPast(date);
                const isGhost = !isDateInTemplate(date);
                const holidayName = getPublicHolidayName(date);

                return (
                  <div
                    role="columnheader"
                    key={idx}
                    data-today={!isGhost && dateIsToday ? "true" : undefined}
                    className={cn(
                      'sticky top-0 z-20 bg-slate-100/95 dark:bg-muted/80 backdrop-blur-md px-3 py-2.5 text-center transition-colors',
                      idx < dates.length - 1 && (holidayName ? 'border-r border-amber-500/20' : 'border-r border-slate-300 dark:border-border'),
                      // Public holiday highlight styling (no bottom border between header and holiday cell)
                      holidayName
                        ? 'bg-amber-500/15 dark:bg-amber-500/15 border-b-0'
                        : 'border-b border-slate-300 dark:border-border',
                      // Ghost cell styling
                      isGhost && 'bg-muted/40 border-dashed border-border opacity-50',
                      // Today highlighting (only if not ghost and not holiday)
                      !isGhost && dateIsToday && !holidayName && 'bg-primary/10 dark:bg-primary/5',
                      // Past date styling (only if not ghost and not today and not holiday)
                      !isGhost && dateIsPast && !dateIsToday && !holidayName && 'opacity-60'
                    )}
                  >
                    <div className={cn("text-[11px] font-bold uppercase tracking-[0.12em] font-mono leading-tight", holidayName ? "text-amber-800 dark:text-amber-400 font-extrabold" : dateIsToday ? "text-primary font-bold" : "text-slate-700 dark:text-muted-foreground")}>{format(date, 'EEE')}</div>
                    <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
                      <span className={cn("text-[13px] font-mono tabular-nums leading-none", holidayName ? "text-amber-800 dark:text-amber-300 font-bold" : dateIsToday ? "text-primary font-bold" : "text-slate-800 dark:text-muted-foreground font-semibold")}>
                        {format(date, 'MMM d')}
                      </span>
                      {holidayName && (
                        <span
                          className="text-[11px] italic font-medium text-amber-800 dark:text-amber-300 truncate max-w-[140px]"
                          title={`ANZ Public Holiday: ${holidayName}`}
                        >
                          {holidayName}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <VirtualizedSubGroupBody
              subGroups={group.subGroups}
              gridTemplateColumns={groupGridCols(dates.length)}
              getRowClassName={(_subGroup, subIdx) => cn(
                'transition-colors hover:bg-accent/20',
                subIdx < group.subGroups.length - 1 && 'border-b border-border',
              )}
              skeletonSlot={
                isShiftsLoading && group.subGroups.length === 0
                  ? Array.from({ length: 3 }).map((_, skelIdx) => (
                    <div
                      role="row"
                      key={`skel-${skelIdx}`}
                      aria-hidden="true"
                      className={cn(
                        'grid animate-pulse',
                        skelIdx < 2 && 'border-b border-border',
                      )}
                      style={{ gridTemplateColumns: groupGridCols(dates.length) }}
                    >
                      <div className="sticky left-0 z-20 sticky-subgroup-cell border-r border-border px-4 py-3 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.15)]">
                        <div className="h-4 w-24 rounded bg-muted/50" />
                      </div>
                      {dates.map((_, dateIdx) => (
                        <div
                          key={dateIdx}
                          className={cn(
                            'px-2 py-3 min-h-[100px]',
                            dateIdx < dates.length - 1 && 'border-r border-border',
                          )}
                        >
                          <div className="h-[88px] rounded-lg bg-muted/20" />
                        </div>
                      ))}
                    </div>
                  ))
                  : null
              }
              renderRow={(subGroup) => {
                const templateLabel = getSubGroupTemplateLabel(subGroup);
                return (
                  <>
                    <div role="cell" className="sticky left-0 z-20 border-r border-slate-300 dark:border-border px-4 py-3 sticky-subgroup-cell shadow-[2px_0_6px_-2px_rgba(0,0,0,0.15)] transition-colors group">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col min-w-0">
                          <span className="text-[13px] font-semibold text-slate-800 dark:text-foreground/90 group-hover:text-slate-950 dark:group-hover:text-foreground transition-colors overflow-hidden text-ellipsis whitespace-nowrap">
                            {subGroup.name}
                          </span>
                          {templateLabel && (
                            <span
                              className="text-[11px] font-normal italic text-slate-600 dark:text-slate-400/70 truncate max-w-[130px] leading-tight mt-0.5"
                              title={`Source Template: ${templateLabel}`}
                            >
                              {templateLabel}
                            </span>
                          )}
                        </div>
                        {/* Office has one fixed sub-group (Administration): nothing to rename, clone or delete. */}
                        {!hasFixedSubgroup(group.type) && (
                        <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for subgroup ${subGroup.name}`}
                            className="h-9 w-9 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56 bg-gray-900 border-gray-800">
                          {subGroupActionsBlockedReason && (
                            <p className="px-2 py-1.5 text-[11px] text-gray-400 leading-snug">{subGroupActionsBlockedReason}</p>
                          )}
                          <DropdownMenuItem
                            className="gap-2 focus:bg-white/5 cursor-pointer"
                            disabled={!!subGroupActionsBlockedReason}
                            onClick={() => {
                              setActiveSubGroup({
                                id: subGroup.id,
                                name: subGroup.name,
                                groupExternalId: group.type || ''
                              });
                              setIsRenameOpen(true);
                            }}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="gap-2 focus:bg-white/5 cursor-pointer"
                            disabled={!!subGroupActionsBlockedReason}
                            onClick={() => {
                              setActiveSubGroup({
                                id: subGroup.id,
                                name: subGroup.name,
                                groupExternalId: group.type || ''
                              });
                              setIsCloneOpen(true);
                            }}
                          >
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                            Clone
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-white/10" />
                          <DropdownMenuItem
                            className="gap-2 text-red-500 focus:text-red-500 focus:bg-red-500/10 cursor-pointer"
                            disabled={!!subGroupActionsBlockedReason}
                            onClick={() => {
                              setActiveSubGroup({
                                id: subGroup.id,
                                name: subGroup.name,
                                groupExternalId: group.type || ''
                              });
                              setIsDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                        )}
                    </div>
                  </div>

                  {dates.map((date, dateIdx) => {
                    const dateKey = format(date, 'yyyy-MM-dd');
                    const rawCellShifts = subGroup.shifts[dateKey] || [];
                    const cellShifts = [...rawCellShifts].sort((a, b) => {
                      const timeA = a.startTime || a.rawShift?.start_time || '';
                      const timeB = b.startTime || b.rawShift?.start_time || '';
                      return timeA.localeCompare(timeB);
                    });
                    const cellIsToday = isToday(date);
                    const cellIsPast = isSydneyPast(date);
                    const isGhost = !isDateInTemplate(date);
                    const holidayName = getPublicHolidayName(date);

                    const bucketKey = `${dateKey}::${group.type}::${subGroup.name}`;
                    const bucketShifts = shiftsByBucketKey.get(bucketKey) || [];
                    const eligibleIds = bucketShifts
                      .filter(s => !isShiftLocked(s.shift_date, s.start_time, 'roster_management'))
                      .map(s => s.id);
                    const selectableCount = eligibleIds.length;
                    
                    let cellSelectionState: 'all' | 'some' | 'none' = 'none';
                    if (selectableCount > 0) {
                      const selectedCount = eligibleIds.filter(id => selectedV8ShiftIdsSet.has(id)).length;
                      if (selectedCount === selectableCount) {
                        cellSelectionState = 'all';
                      } else if (selectedCount > 0) {
                        cellSelectionState = 'some';
                      }
                    }

                    const handleToggleSelect = () => {
                      if (selectableCount === 0) return;
                      const selectedCount = eligibleIds.filter(id => selectedV8ShiftIdsSet.has(id)).length;
                      if (selectedCount === selectableCount) {
                        onDeselectShiftIds?.(eligibleIds);
                      } else {
                        onSelectShiftIds?.(eligibleIds);
                      }
                    };

                    return (
                      <div
                        role="cell"
                        key={dateIdx}
                        className={cn(
                          'px-3 py-3 align-top min-h-[80px] relative group/cell transition-colors border-b border-slate-300 dark:border-border',
                          dateIdx < dates.length - 1 && (holidayName ? 'border-r border-amber-500/20' : 'border-r border-slate-300 dark:border-border'),
                          // Public holiday highlight styling (fully golden, matching header)
                          !isGhost && holidayName && 'bg-amber-500/10 dark:bg-amber-500/15',
                          // Ghost cell styling
                          isGhost && 'bg-muted/30 border-dashed border-slate-300 dark:border-border cursor-pointer hover:bg-muted/50',
                          // Today highlighting (only if convention, not ghost and not holiday)
                          !isGhost && cellIsToday && !holidayName && 'bg-primary/5',
                          // Past date styling (only if not ghost and not today and not holiday)
                          !isGhost && cellIsPast && !cellIsToday && !holidayName && 'opacity-60'
                        )}
                        onClick={isGhost && onNavigateToMonth ? () => onNavigateToMonth(date) : undefined}
                      >
                        {isGhost ? (
                          // Ghost Cell Content - "Go to [Month]" link
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-slate-600 dark:text-muted-foreground text-[13px] font-medium hover:text-slate-900 dark:hover:text-foreground transition-colors">
                              Go to {format(date, 'MMMM')} →
                            </span>
                          </div>
                        ) : (
                          // Active Cell Content - Shifts and Add button
                          <DroppableCell
                            active={isDnDModeActive}
                            groupType={group.type}
                            subGroupName={subGroup.name}
                            groupId={group.id}
                            subGroupId={subGroup.id}
                            date={dateKey}
                            onDrop={handleShiftDrop}
                            disabled={isBulkMode || !canEdit || cellIsPast || !isDnDModeActive}
                            className="flex flex-col gap-1.5 min-h-[80px] h-full relative"
                          >
                            <GroupCellShiftList
                              shifts={cellShifts}
                              renderItem={(shift, shiftIdx) => (
                              <div
                                key={shift.id}
                                style={{ '--i': shiftIdx, animationDelay: `calc(${shiftIdx} * 40ms)` } as React.CSSProperties}
                                className="animate-[slideUpFade_0.25s_ease_forwards]"
                              >
                                <DraggableShiftCard
                                  active={isDnDModeActive}
                                  shift={shift}
                                  groupType={group.type}
                                  subGroupName={subGroup.name}
                                  disabled={
                                    isBulkMode ||
                                    cellIsPast ||
                                    isSydneyStarted(format(date, 'yyyy-MM-dd'), shift.startTime) ||
                                    !canEdit ||
                                    !isDnDModeActive ||
                                    (isDnDModeActive && !shift.isDraft)
                                  }
                                >
                                  {(isDnDModeActive && canEdit && !cellIsPast && !isSydneyStarted(format(date, 'yyyy-MM-dd'), shift.startTime) && shift.isDraft) ? (
                                    <DroppableShiftAssign
                                      shiftId={shift.id}
                                      shiftRole={shift.role}
                                      canAccept={!shift.isLocked}
                                      onAssign={handleEmployeeDrop}
                                    >
                                      {renderShiftCard(shift, group, subGroup, date)}
                                    </DroppableShiftAssign>
                                  ) : (
                                    renderShiftCard(shift, group, subGroup, date)
                                  )}
                                </DraggableShiftCard>
                              </div>
                              )}
                            />

                            {/* For cells WITH shifts: Reserved row with + at the bottom right */}
                            {!isBulkMode && canEdit && !cellIsPast && cellShifts.length > 0 && (
                              <div className="flex items-center justify-end w-full pt-1 mt-auto">
                                <RosterCellAddButton
                                  onClick={(e) => {
                                    e?.stopPropagation();
                                    handleAddShift(group, subGroup, date);
                                  }}
                                  hasShifts={true}
                                  holidayName={holidayName}
                                  title={holidayName ? `Add Shift (${holidayName})` : "Add Shift"}
                                />
                              </div>
                            )}

                            {/* For EMPTY cells: Centered add button */}
                            {!isBulkMode && canEdit && !cellIsPast && cellShifts.length === 0 && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                                <RosterCellAddButton
                                  onClick={() => handleAddShift(group, subGroup, date)}
                                  hasShifts={false}
                                  holidayName={holidayName}
                                  title={holidayName ? `Add Shift (${holidayName})` : "Add Shift"}
                                />
                              </div>
                            )}
                          </DroppableCell>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export const GroupModeView: React.FC<GroupModeViewProps> = ({
  selectedDate,
  viewType,
  canEdit,
  organizationId,
  organizationName,
  rosterId,
  departmentId,
  departmentName,
  subDepartmentId,
  subDepartmentName,
  // Ghost Cell Navigation props
  templateStartDate,
  templateEndDate,
  onNavigateToMonth,
  onAddShift,
  isBulkMode,
  onBulkModeToggle,
  // Data props from parent (required)
  shifts: externalShifts,
  isShiftsLoading = false,
  complianceMap,
  showLegend = false,
  dayZoom = 60,
  projection,
  selectedV8ShiftIds: propsSelectedV8ShiftIds, // Destructure the prop and rename it
  onToggleShiftSelection,
  onSelectShiftIds,
  onDeselectShiftIds,
  onAssignShift,
  summaryData,
  onDrillDown,
  footerStats,
  showBudget = false,
}) => {
  const { toast } = useToast();
  const { isDark } = useTheme();
  // Get enhanced filters and selection state from context
  const {
    advancedFilters,
    hasActiveFilters,
  } = useRosterUI();

  const isDnDModeActive = useRosterStore(s => s.isDnDModeActive);
  const setLastShiftMove = useRosterStore(s => s.setLastShiftMove);
  const lastShiftMove = useRosterStore(s => s.lastShiftMove);
  const clearLastShiftMove = useRosterStore(s => s.clearLastShiftMove);

  // Use props if provided, otherwise fallback to context
  const selectedV8ShiftIds = propsSelectedV8ShiftIds ?? [];
  // O(1) lookup for per-card selection check
  const selectedV8ShiftIdsSet = React.useMemo(
    () => new Set(selectedV8ShiftIds),
    [selectedV8ShiftIds],
  );

  // The shifts the toolbar filters let through — the same rule every view uses.
  // Bulk bucket-selection and the legacy branch read this, so selecting a bucket
  // never picks up shifts the filter is hiding.
  const visibleShifts = React.useMemo(
    () => (externalShifts ? applyAdvancedFilters(externalShifts, advancedFilters) : externalShifts),
    [externalShifts, advancedFilters],
  );

  // Index shifts by key: `${shift_date}::${group_type||'unassigned'}::${sub_group_name||'General'}`
  const shiftsByBucketKey = React.useMemo(() => {
    const map = new Map<string, Shift[]>();
    if (!visibleShifts) return map;
    
    visibleShifts.forEach(shift => {
      const dateKey = shift.shift_date;
      const groupKey = shift.group_type || 'unassigned';
      const subGroupKey = shift.sub_group_name || 'General';
      const key = `${dateKey}::${groupKey}::${subGroupKey}`;
      
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(shift);
    });
    return map;
  }, [visibleShifts]);

  // Collapsible group state (persisted to localStorage)
  const [collapsedGroups, toggleGroupCollapse] = useCollapsedGroups();

  // Per-cell "+N more" expansion now lives inside GroupCellShiftList (local
  // component state), so toggling it re-renders only that one cell instead of
  // the whole grid (the old grid-level Set caused ~200ms INP per click).

  // Track groups the user has explicitly expanded (session-only, resets on remount).
  // When a past group is auto-collapsed and the user clicks to expand it, we record
  // the group here so effectiveCollapsed no longer forces it shut.
  const userExpandedGroupsRef = useRef<Set<string>>(new Set());

  // Wrapped toggle: if the group is currently effectively collapsed (either by
  // explicit choice or auto-collapse) and the user clicks → they are expanding →
  // record in userExpandedGroupsRef so the auto-collapse rule is suppressed.
  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    if (collapsedGroups.has(groupId) || userExpandedGroupsRef.current.has(groupId) === false) {
      // Toggling from collapsed → open: mark as explicitly expanded so
      // pastGroupIds auto-collapse is bypassed for this group.
      userExpandedGroupsRef.current = new Set(userExpandedGroupsRef.current).add(groupId);
    } else {
      // Toggling from open → collapsed: remove from expanded set.
      const next = new Set(userExpandedGroupsRef.current);
      next.delete(groupId);
      userExpandedGroupsRef.current = next;
    }
    toggleGroupCollapse(groupId);
  }, [collapsedGroups, toggleGroupCollapse]);

  // TanStack Query mutation hooks (auto-invalidate caches on success)
  const deleteShiftMutation = useDeleteShift();
  const updateShiftMutation = useUpdateShift(); // For DnD group changes
  const bulkDeleteMutation = useBulkDeleteShifts();
  const bulkPublishMutation = useBulkPublishShifts();
  const bulkUnpublishMutation = useBulkUnpublishShifts();
  const publishShiftMutation = usePublishShift();
  const unpublishShiftMutation = useUnpublishShift();
  const createShiftMutation = useCreateShift();
  const addSubGroupMutation = useAddSubGroup();
  const addSubGroupRangeMutation = useAddSubGroupRange();
  const queryClient = useQueryClient();

  // ==================== UNDO HANDLER ====================
  const handleUndoMove = useCallback(async () => {
    if (!lastShiftMove) return;

    try {
      const { shiftId, prevData } = lastShiftMove;
      await shiftsCommands.moveShift(shiftId, prevData);

      toast({
        title: 'Move Undone',
        description: 'Shift has been restored to its previous position.',
      });

      clearLastShiftMove();
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: shiftKeys.detail(shiftId) });
    } catch (error) {
      toast({
        title: 'Undo Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [lastShiftMove, clearLastShiftMove, queryClient, toast]);

  // Page-level scroll container ref (the Radix ScrollArea). Subgroup rows are
  // rendered in normal flow (not virtualized), so no scroll-element resolution
  // is needed here anymore.
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // ==================== DND DROP HANDLER ====================
  // externalShifts churns on every optimistic mutation (including the one
  // this very handler triggers). If we close over it directly, the callback
  // identity changes on every shift update — which re-registers the drop
  // spec on every one of ~1.4k DroppableCells. Read via ref to keep the
  // handler stable across renders.
  const externalShiftsRef = useRef(externalShifts);
  useEffect(() => {
    externalShiftsRef.current = externalShifts;
  }, [externalShifts]);

  const handleShiftDrop = useCallback(
    async (item: DragItem, targetGroupType: TemplateGroupType | 'unassigned', targetSubGroup: string, targetDate: string, targetGroupId: string, targetSubGroupId: string) => {
      // Find the shift in our data
      const shift = externalShiftsRef.current.find(s => s.id === item.shiftId);
      if (!shift) {
        toast({
          title: 'Error',
          description: 'Could not find the shift to move',
          variant: 'destructive',
        });
        return;
      }

      // ── Optimistic cache update (instant UI feedback) ──
      const snapshot = snapshotLists(queryClient);
      patchLists(queryClient, (old) =>
        old.map(s =>
          s.id === item.shiftId
            ? {
              ...s,
              ...(targetDate !== item.shiftDate ? { shift_date: targetDate } : {}),
              group_type: targetGroupType === 'unassigned' ? null : targetGroupType,
              sub_group_name: targetSubGroup === 'Unassigned' ? null : targetSubGroup,
              shift_group_id: targetGroupType === 'unassigned' ? null : targetGroupId,
            }
            : s,
        ) as any,
      );

      // --- Compliance-gated check for ALL shifts on date change ---
      // Routes through the unified executeAssignShift command which runs:
      //   Assigned shifts: full V2 compliance (all 12 rules incl. R01 overlap)
      //   Unassigned shifts: skeleton compliance (R02 min duration, R08 meal break)
      if (targetDate !== item.shiftDate) {
        const result = await executeAssignShift({
          shiftId: shift.id,
          employeeId: undefined as any,   // preserve current assignment
          targetDate,
        });

        if (!result.success) {
          // ── Rollback: compliance rejected the move ──
          rollbackLists(queryClient, snapshot);
          toast({
            title: 'Move Blocked',
            description: result.error ?? 'Compliance check failed.',
            variant: 'destructive',
          });
          return;
        }

        // Surface advisory warnings (non-blocking)
        if (result.advisories && result.advisories.length > 0) {
          toast({
            title: 'Warning',
            description: result.advisories[0],
          });
        }
      }

      try {
        // Capture previous state for Undo
        const prevData = {
          groupType: shift.group_type || null,
          subGroupName: shift.sub_group_name || null,
          shiftGroupId: shift.shift_group_id || null,
          rosterSubgroupId: (shift as any).roster_subgroup_id || shift.shift_subgroup_id || null,
          shiftDate: shift.shift_date || null,
        };

        // If the shift is dropped into the 'unassigned' bucket in Group Mode, 
        // we do NOT want to null out its roster_subgroup_id / group_type as this violates NOT NULL constraints.
        // It simply gets unassigned from whatever employee or stays unassigned.
        await shiftsCommands.moveShift(item.shiftId, {
          groupType: targetGroupType === 'unassigned' ? undefined : targetGroupType,
          subGroupName: targetSubGroup === 'Unassigned' ? undefined : targetSubGroup,
          shiftGroupId: targetGroupType === 'unassigned' ? undefined : targetGroupId,
          rosterSubgroupId: targetGroupType === 'unassigned' ? undefined : targetSubGroupId,
          // Date change already applied by executeAssignShift above — only pass
          // non-date group metadata changes to moveShift to avoid double-write.
          shiftDate: null,
        });

        // Store for Undo
        setLastShiftMove({
          shiftId: item.shiftId,
          prevData,
        });

        toast({
          title: 'Shift Moved',
          description: `Shift moved to ${targetGroupType === 'unassigned' ? 'Unassigned' : GROUP_DISPLAY_NAMES[targetGroupType]} / ${targetSubGroup}${targetDate !== item.shiftDate ? ` on ${targetDate}` : ''}`,
          action: (
            <ToastAction altText="Undo" onClick={handleUndoMove}>
              Undo
            </ToastAction>
          ),
        });
      } catch (error) {
        // ── Rollback: moveShift failed ──
        rollbackLists(queryClient, snapshot);
        toast({
          title: 'Failed to move shift',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      } finally {
        // Always reconcile with the server
        queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
        queryClient.invalidateQueries({ queryKey: shiftKeys.detail(item.shiftId) });
      }
    },
    [queryClient, toast]
  );

  // ==================== REFS FOR CLOSURE STABILITY ====================
  const departmentIdRef = useRef<string | undefined>(departmentId);
  const departmentNameRef = useRef<string | undefined>(departmentName);
  const subDepartmentIdRef = useRef<string | undefined>(subDepartmentId);
  const subDepartmentNameRef = useRef<string | undefined>(subDepartmentName);
  const organizationIdRef = useRef<string | undefined>(organizationId);
  const organizationNameRef = useRef<string | undefined>(organizationName);
  const rosterIdRef = useRef<string | undefined>(rosterId);

  useEffect(() => { departmentIdRef.current = departmentId; }, [departmentId]);
  useEffect(() => { departmentNameRef.current = departmentName; }, [departmentName]);
  useEffect(() => { subDepartmentIdRef.current = subDepartmentId; }, [subDepartmentId]);
  useEffect(() => { subDepartmentNameRef.current = subDepartmentName; }, [subDepartmentName]);
  useEffect(() => { organizationIdRef.current = organizationId; }, [organizationId]);
  useEffect(() => { organizationNameRef.current = organizationName; }, [organizationName]);
  useEffect(() => { rosterIdRef.current = rosterId; }, [rosterId]);

  // ==================== EMPLOYEE DnD ASSIGNMENT (MODAL-GATED) ====================
  const [pendingDndAssign, setPendingDndAssign] = useState<{
    shiftId: string;
    employeeId: string;
    employeeName: string;
    shiftDisplay: ShiftDisplay;
  } | null>(null);
  const [isDndAssigning, setIsDndAssigning] = useState(false);

  const handleEmployeeDrop = useCallback((shiftId: string, dragItem: EmployeeDragItem) => {
    // Delegate to centralized parent handler if available
    if (onAssignShift) {
      onAssignShift(shiftId, dragItem.employeeId, dragItem.employeeName);
      return;
    }
    // Fallback: local modal (legacy path)
    const matchedShift = externalShifts.find(s => s.id === shiftId);
    if (!matchedShift) {
      toast({ title: 'Error', description: 'Could not find shift details.', variant: 'destructive' });
      return;
    }
    const shiftDisplay: ShiftDisplay = {
      id: matchedShift.id,
      role: (matchedShift as any).roles?.name || 'Shift',
      startTime: matchedShift.start_time,
      endTime: matchedShift.end_time,
      status: 'Open',
      isPublished: false,
      isDraft: true,
      isOnBidding: false,
      isTrading: false,
      isCancelled: false,
      groupColor: '',
      rawShift: matchedShift,
      isUrgent: false,
    };
    setPendingDndAssign({
      shiftId,
      employeeId: dragItem.employeeId,
      employeeName: dragItem.employeeName,
      shiftDisplay,
    });
  }, [externalShifts, toast, onAssignShift]);

  const handleDndAssignConfirm = useCallback(async (options: { ignoreWarnings: boolean }) => {
    if (!pendingDndAssign) return;
    setIsDndAssigning(true);
    try {
      const result = await executeAssignShift({
        shiftId: pendingDndAssign.shiftId,
        employeeId: pendingDndAssign.employeeId,
        context: 'MANUAL',
        ignoreWarnings: options.ignoreWarnings,
      });
      if (!result.success) {
        toast({
          title: 'Assignment blocked',
          description: result.error ?? 'Compliance check failed.',
          variant: 'destructive',
        });
        queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
        return;
      }
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      toast({ title: 'Shift assigned', description: 'Employee successfully assigned.' });
      setPendingDndAssign(null);
    } catch {
      queryClient.invalidateQueries({ queryKey: shiftKeys.all });
      toast({
        title: 'Assignment failed',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDndAssigning(false);
    }
  }, [pendingDndAssign, queryClient, toast]);

  // ==================== GHOST CELL HELPER ====================
  // Check if a date is within the active template's bounds (normalized to start of day)
  const isDateInTemplate = useMemo(() => {
    return (cellDate: Date): boolean => {
      if (!templateStartDate || !templateEndDate) {
        return true; // No bounds defined, consider all dates valid
      }
      const normalizedCell = startOfDay(cellDate);
      const normalizedStart = startOfDay(templateStartDate);
      const normalizedEnd = startOfDay(templateEndDate);
      // Check: normalizedStart <= normalizedCell <= normalizedEnd
      return normalizedCell >= normalizedStart && normalizedCell <= normalizedEnd;
    };
  }, [templateStartDate, templateEndDate]);


  // Add/Edit shift now navigates to the dedicated full-page form route.
  const openShiftForm = useShiftFormNav();

  // ==================== DELETE CONFIRMATION ====================
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shiftToDelete, setShiftToDelete] = useState<ShiftDisplay | null>(null);
  /** A full-time shift being copied onto a range (the Office page's Copy, shared). */
  const [copySource, setCopySource] = useState<CopyShiftSource | null>(null);
  /** A full-time shift shown expanded: Scheduled · Actual · Payroll · Variance. */
  const [expandedShift, setExpandedShift] = useState<Shift | null>(null);
  /** A shift being audited for ICC Sydney EBA compliance. */
  const [auditedShift, setAuditedShift] = useState<Shift | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ==================== PUBLISH/UNPUBLISH CONFIRMATION ====================
  const [confirmActionOpen, setConfirmActionOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'publish' | 'unpublish'; shift: ShiftDisplay } | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // ==================== BULK MODE STATE ====================
  // Bulk mode selection state removed in favor of centralized store



  // ==================== EMERGENCY ALERT STATE ====================
  const [isEmergencyAlertOpen, setIsEmergencyAlertOpen] = useState(false);
  const [emergencyAlertMessage, setEmergencyAlertMessage] = useState('');

  // ==================== SUB-GROUP ACTIONS STATE ====================
  const [activeSubGroup, setActiveSubGroup] = useState<{ id: string, name: string, groupExternalId: string } | null>(null);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isCloneOpen, setIsCloneOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const deleteSubGroupMutation = useDeleteSubGroup();
  const renameSubGroupMutation = useRenameSubGroup();
  const cloneSubGroupMutation = useCloneSubGroup();



  // ==================== PROFILE DATA (via React Query) ====================
  const { data: employeeProfiles = [] } = useEmployees(organizationId);

  // Build profile map from React Query data (replaces direct Supabase call)
  const profileMap = useMemo(() => {
    const map: Record<string, { first_name: string; last_name: string }> = {};
    employeeProfiles.forEach((p: any) => {
      map[p.id] = { first_name: p.first_name || '', last_name: p.last_name || '' };
      if (p.legacy_employee_id) {
        map[p.legacy_employee_id] = { first_name: p.first_name || '', last_name: p.last_name || '' };
      }
    });
    return map;
  }, [employeeProfiles]);

  // ==================== DATE CALCULATION ====================
  const dates = useMemo((): Date[] => {
    const result: Date[] = [];
    switch (viewType) {
      case 'day':
        result.push(selectedDate);
        break;
      case '3day':
        for (let i = 0; i < 3; i++) result.push(addDays(selectedDate, i));
        break;
      case 'week':
        const weekStart = startOfWeekAU(selectedDate);
        for (let i = 0; i < 7; i++) result.push(addDays(weekStart, i));
        break;
      case 'month': {
        // Bound to the selected month ± a small buffer (matches the parent
        // fetch window in RostersPlannerPage). Previously this extended to
        // templateEndDate, which for multi-month templates rendered dozens of
        // EMPTY future columns — the fetch is month-scoped, so Jul/Aug/Sept
        // had no data. Capping removes that waste and bounds the column count.
        const windowEnd = addDays(endOfMonth(selectedDate), MONTH_BUFFER_DAYS);
        let current = addDays(startOfMonth(selectedDate), -MONTH_BUFFER_DAYS);
        while (current <= windowEnd) {
          result.push(current);
          current = addDays(current, 1);
        }
        break;
      }
    }
    return result;
  }, [selectedDate, viewType]);

  // Profiles are now fetched via useEmployees React Query hook above

  // Note: visualGroups useMemo is defined after buildVisualGroupsFromShifts and getDefaultGroups

  // ==================== DYNAMIC STRUCTURE FETCHING ====================
  // Calculate date range strings for hook
  const { dateRangeStart, dateRangeEnd } = useMemo(() => {
    if (dates.length === 0) return { dateRangeStart: null, dateRangeEnd: null };
    const start = format(dates[0], 'yyyy-MM-dd');
    const end = format(dates[dates.length - 1], 'yyyy-MM-dd');
    return { dateRangeStart: start, dateRangeEnd: end };
  }, [dates]);

  const {
    selectedDepartmentIds,
    selectedSubDepartmentIds,
  } = useRosterUI();

  const { data: rosterStructures = [], isError: isRosterError, error: rosterError } = useRosterStructure(
    organizationId,
    dateRangeStart,
    dateRangeEnd,
    {
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    }
  );

  // Sub-group Rename / Clone / Delete act on ONE sub-department's roster. With
  // several in scope the grid merges their rows, and acting on "the first" would
  // quietly change one team and not the others — so the actions ask for one.
  const singleSubDepartmentId = selectedSubDepartmentIds.length === 1 ? selectedSubDepartmentIds[0] : null;
  const subGroupActionsBlockedReason = useMemo((): string | null => {
    if (!organizationId || !departmentId || selectedDepartmentIds.length > 1) {
      return 'Choose one department to change its sub-groups.';
    }
    if (!singleSubDepartmentId) {
      return 'Choose one sub-department in the scope filter to change its sub-groups.';
    }
    if (!dateRangeStart || !dateRangeEnd) return 'There are no days in view.';
    return null;
  }, [organizationId, departmentId, selectedDepartmentIds.length, singleSubDepartmentId, dateRangeStart, dateRangeEnd]);

  const subGroupScopeFor = (groupExternalId: string): SubgroupScope | null =>
    subGroupActionsBlockedReason || !organizationId || !departmentId || !singleSubDepartmentId || !dateRangeStart || !dateRangeEnd
      ? null
      : {
          organizationId,
          departmentId,
          subDepartmentId: singleSubDepartmentId,
          groupExternalId,
          startDate: dateRangeStart,
          endDate: dateRangeEnd,
        };

  // Surface only roster fetch errors to the console. Earlier diagnostic logs
  // here mapped over the entire roster structures array on every effect run,
  // showing up as main-thread work during view changes.
  useEffect(() => {
    if (isRosterError) {
      console.error(`[GroupModeView] Roster fetch error:`, rosterError);
    }
  }, [rosterStructures, isRosterError, rosterError]);

  // ==================== TEMPLATE RESOLUTION MAP ====================
  const { data: allTemplates = [] } = useAllTemplates();
  const templateMap = useMemo(() => {
    const map = new Map<string, string>();
    allTemplates.forEach((t) => {
      map.set(String(t.id), t.name);
    });
    return map;
  }, [allTemplates]);

  const getSubGroupTemplateLabel = useCallback((subGroup: VisualSubGroup): string | null => {
    const templateNames = new Set<string>();
    let hasManual = false;

    Object.values(subGroup.shifts).forEach(shiftList => {
      shiftList.forEach(shiftDisplay => {
        const raw = shiftDisplay.rawShift;
        if (!raw) return;
        const tId = raw.template_id;
        const isFromT = raw.is_from_template || !!tId;

        if (isFromT) {
          const joinedName = (raw as any)?.templates?.name;
          const cachedName = tId ? templateMap.get(String(tId)) : null;
          const resolvedName = joinedName || cachedName || '[Deleted Template]';
          templateNames.add(resolvedName);
        } else {
          hasManual = true;
        }
      });
    });

    if (templateNames.size === 0) {
      return null;
    }

    const names = Array.from(templateNames).sort();
    let result = names.join(', ');
    if (hasManual && names.length > 0) {
      result += ' (+ manual)';
    }
    return result;
  }, [templateMap]);

  // Helper to get formatted group name
  const getGroupName = (externalId: string | null, name: string) => {
    if (externalId && GROUP_DISPLAY_NAMES[externalId as TemplateGroupType]) {
      return GROUP_DISPLAY_NAMES[externalId as TemplateGroupType];
    }
    return name;
  };

  // ==================== BUILD VISUAL GROUPS (DYNAMIC) ====================
  const buildVisualGroupsFromShifts = (shifts: Shift[]): VisualGroup[] => {

    // 1. Build a unified structure map from the fetched roster structures
    const groupsMap = new Map<string, {
      id: string;
      name: string;
      externalId: string | null;
      type: TemplateGroupType;
      sortOrder: number;
      subGroups: Map<string, { id: string; name: string; sortOrder: number }>;
    }>();

    const toCanonicalKey = (name: string, externalId: string | null): string => {
      if (externalId && (ALL_GROUP_TYPES as string[]).includes(externalId)) {
        return externalId;
      }
      return name.trim().toLowerCase().replace(/\s+/g, '_');
    };

    const ensureGroup = (id: string, name: string, externalId: string | null, sortOrder: number) => {
      const key = toCanonicalKey(name, externalId);
      if (!groupsMap.has(key)) {
        let type: TemplateGroupType = 'convention_centre';
        if ((ALL_GROUP_TYPES as string[]).includes(key)) {
          type = key as TemplateGroupType;
        }
        groupsMap.set(key, {
          id,
          name,
          externalId,
          type,
          sortOrder,
          subGroups: new Map()
        });
      } else {
        const existing = groupsMap.get(key)!;
        if (!existing.externalId && externalId) existing.externalId = externalId;
        if ((!existing.id || existing.id === null) && id) existing.id = id;
      }
      return groupsMap.get(key)!;
    };

    // Initialize with standard ICC Sydney groups
    ALL_GROUP_TYPES.forEach((type, idx) => {
      ensureGroup(null as any, GROUP_DISPLAY_NAMES[type], type, idx);
    });

    // Populate structure from API data
    rosterStructures.forEach(roster => {
      roster.groups.forEach(group => {
        const groupEntry = ensureGroup(group.id, group.name, group.externalId, group.sortOrder);
        group.subGroups.forEach(sg => {
          if (!groupEntry.subGroups.has(sg.name)) {
            groupEntry.subGroups.set(sg.name, {
              id: sg.id,
              name: sg.name,
              sortOrder: sg.sortOrder
            });
          }
        });
      });
    });

    const visualGroups: VisualGroup[] = [];
    const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);

    sortedGroups.forEach(groupDef => {
      const subGroups: VisualSubGroup[] = [];
      const subGroupMap = new Map<string, { id: string, name: string, shifts: Record<string, ShiftDisplay[]> }>();

      groupDef.subGroups.forEach(sg => {
        subGroupMap.set(sg.name, { id: sg.id, name: sg.name, shifts: {} });
      });

      const groupShifts = shifts.filter(shift => {
        const sType = (shift.group_type as TemplateGroupType) || 'convention_centre';
        return sType === groupDef.type;
      });

      groupShifts.forEach(shift => {
        const subGroupName = shift.sub_group_name || 'General';
        if (!subGroupMap.has(subGroupName)) {
          subGroupMap.set(subGroupName, {
            id: `adhoc-${groupDef.type}-${subGroupName}`,
            name: subGroupName,
            shifts: {}
          });
        }

        const sgEntry = subGroupMap.get(subGroupName)!;
        const dateKey = shift.shift_date;
        if (!sgEntry.shifts[dateKey]) sgEntry.shifts[dateKey] = [];

        const assignedProfile = (shift as any).assigned_profiles || (shift as any).profiles;
        let employeeName = assignedProfile
          ? `${assignedProfile.first_name || ''} ${assignedProfile.last_name || ''}`.trim()
          : undefined;

        if (!employeeName && shift.assigned_employee_id && profileMap[shift.assigned_employee_id]) {
          const p = profileMap[shift.assigned_employee_id];
          employeeName = `${p.first_name} ${p.last_name}`.trim();
        }
        if (!employeeName && shift.assigned_employee_id) employeeName = 'Assigned';

        // S3: Published + assigned + assignment_outcome IS NULL (awaiting acceptance)
        // S4: Published + assigned + assignment_outcome === 'confirmed'
        // Do not synthesize stale values — keep null as-is.
        const assignmentOutcome = (shift as any).assignment_outcome ?? null;

        const isPublished = ['Published', 'InProgress', 'Completed'].includes(shift.lifecycle_status || '');
        const isDraft = shift.lifecycle_status === 'Draft';

        // Lock calculation: Check if shift start time is in the past OR explicitly locked in DB
        const isLocked = shift.is_locked || isShiftLocked(shift.shift_date, shift.start_time, 'roster_management');

        sgEntry.shifts[dateKey].push({
          id: shift.id,
          employeeName,
          status: getShiftStatus(shift),
          startTime: shift.start_time,
          endTime: shift.end_time,
          role: (shift as any).roles?.name || 'Shift',
          isPublished,
          isDraft: isPublished ? false : isDraft,
          isOnBidding: isOnBidding(shift.bidding_status),
          isUrgent: isOnBidding(shift.bidding_status) && computeBiddingUrgency(shift.shift_date, shift.start_time) === 'urgent',
          isTrading: !!shift.trade_requested_at,
          isCancelled: shift.is_cancelled,
          groupColor: groupDef.type,
          subGroup: subGroupName,
          assignmentOutcome,
          assignedEmployeeId: shift.assigned_employee_id,
          rawShift: shift,
          isLocked: isLocked, // Pass explicit lock status
        });
      });

      subGroupMap.forEach(sg => subGroups.push(sg));
      subGroups.sort((a, b) => a.name.localeCompare(b.name));

      visualGroups.push({
        id: groupDef.id,
        name: getGroupName(groupDef.externalId, groupDef.name),
        type: groupDef.type,
        color: GLASS_STYLES[groupDef.type]?.accent || 'gray',
        subGroups
      });
    });

    return visualGroups;
  };

  const getShiftStatus = (shift: Shift): ShiftDisplay['status'] => {
    if (shift.is_published) return 'Published';
    if (shift.is_draft) return 'Draft';
    if (shift.assigned_employee_id) return 'Assigned';
    return 'Open';
  };

  const getDefaultGroups = (): VisualGroup[] => {
    return ALL_GROUP_TYPES.map((type) => ({
      id: type,
      name: GROUP_DISPLAY_NAMES[type],
      type,
      color: GLASS_STYLES[type].accent,
      subGroups: DEFAULT_SUB_GROUPS_MAP[type].map((name) => ({
        id: `${type}-${name}`,
        name,
        shifts: {},
      })),
    }));
  };

  // ==================== BUILD VISUAL GROUPS (BUCKET VIEW / SUMMARY) ====================
  // Scalability path: in the Group-mode default Bucket View the grid renders
  // aggregate GroupSummaryCells only and never individual shift cards, so the
  // parent skips the heavy per-shift fetch. We therefore derive the ROW
  // structure (groups + subgroups) from the already-fetched aggregate summary
  // instead of from `shifts` — merging the distinct (group_type, sub_group_name)
  // pairs present in the summary with the three default template groups so the
  // templates always render even when empty. Per-cell totals still resolve via
  // the existing `summaryData.get(`${dateKey}::${group.type}::${subGroup.name}`)`
  // lookup in the render path; rows just need to exist without shift data.
  const buildVisualGroupsFromSummary = (
    summary: Map<string, import('@/modules/rosters/api/rosterSummary.queries').RosterSummaryCellDTO>,
  ): VisualGroup[] => {
    // Start from the three default template groups (guaranteed to render).
    const base = getDefaultGroups();
    const byType = new Map<string, VisualGroup>(base.map(g => [g.type, g]));

    // Track subgroup names already present per group so we don't duplicate.
    const subNamesByType = new Map<string, Set<string>>();
    for (const g of base) {
      subNamesByType.set(g.type, new Set(g.subGroups.map(sg => sg.name)));
    }

    // Populate subgroups from database structure (rosterStructures) first
    // so empty subgroups render in the summary bucket view.
    rosterStructures.forEach(roster => {
      roster.groups.forEach(group => {
        const type = (group.externalId || 'unassigned') as TemplateGroupType | 'unassigned';
        let groupEntry = byType.get(type);
        if (!groupEntry) {
          const isTemplate = (ALL_GROUP_TYPES as string[]).includes(type);
          groupEntry = {
            id: group.id || type,
            name: GROUP_DISPLAY_NAMES[type] ?? group.name ?? type,
            type,
            color: isTemplate
              ? GLASS_STYLES[type as TemplateGroupType].accent
              : UNASSIGNED_GLASS_STYLE.accent,
            subGroups: [],
          };
          byType.set(type, groupEntry);
          subNamesByType.set(type, new Set());
        }

        group.subGroups.forEach(sg => {
          const existingNames = subNamesByType.get(type)!;
          if (!existingNames.has(sg.name)) {
            existingNames.add(sg.name);
            groupEntry.subGroups.push({
              id: sg.id,
              name: sg.name,
              shifts: {},
            });
          }
        });
      });
    });

    // Collect distinct (group_type, sub_group_name) pairs from the summary.
    for (const cell of summary.values()) {
      const type = (cell.group_type || 'unassigned') as TemplateGroupType | 'unassigned';
      const subName = cell.sub_group_name || 'General';

      let group = byType.get(type);
      if (!group) {
        // A group present in the summary but not in the default templates
        // (e.g. an ad-hoc / unassigned bucket). Create it so its rows render.
        const isTemplate = (ALL_GROUP_TYPES as string[]).includes(type);
        group = {
          id: type,
          name: GROUP_DISPLAY_NAMES[type] ?? type,
          type,
          color: isTemplate
            ? GLASS_STYLES[type as TemplateGroupType].accent
            : UNASSIGNED_GLASS_STYLE.accent,
          subGroups: [],
        };
        byType.set(type, group);
        subNamesByType.set(type, new Set());
      }

      const existingNames = subNamesByType.get(type)!;
      if (!existingNames.has(subName)) {
        existingNames.add(subName);
        group.subGroups.push({
          id: `summary-${type}-${subName}`,
          name: subName,
          shifts: {}, // Bucket View renders aggregate cells — no per-shift data.
        });
      }
    }

    // Stable ordering: templates first (in canonical order), then any extras.
    const order: Record<string, number> = {
      convention_centre: 0,
      exhibition_centre: 1,
      theatre: 2,
      the_cutaway: 3,
      office: 4,
    };
    const groups = Array.from(byType.values()).sort(
      (a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99),
    );
    groups.forEach(g => g.subGroups.sort((a, b) => a.name.localeCompare(b.name)));
    return groups;
  };

  // ==================== DERIVE VISUAL GROUPS VIA MEMO ====================
  const visualGroups = useMemo((): VisualGroup[] => {
    // Bucket View: build rows from the aggregate summary (no shift fetch).
    // Phase-2: when projection snapshot is available, map directly from it.
    // Filtering is already applied upstream by useRosterProjections/applyAdvancedFilters.
    if (projection) {
      return projection.groups.map((pg): VisualGroup => ({
        id: pg.id,
        name: pg.name,
        type: pg.type,
        color: pg.colors.accent,
        coverage: pg.stats.totalShifts > 0 ? { ratio: pg.stats.assignedShifts / pg.stats.totalShifts, pct: Math.min(100, Math.round((pg.stats.assignedShifts / pg.stats.totalShifts) * 100)), label: '', colorClass: '', bgClass: '' } : undefined,
        totalHours: pg.stats.totalHours,
        subGroups: pg.subGroups.map((psg): VisualSubGroup => ({
          id: psg.id,
          name: psg.name,
          shifts: Object.fromEntries(
            Object.entries(psg.shiftsByDate).map(([date, pShifts]) => [
              date,
              pShifts.map((ps): ShiftDisplay => ({
                id: ps.id,
                role: ps.roleName,
                startTime: ps.startTime,
                endTime: ps.endTime,
                employeeName: ps.employeeName ?? undefined,
                status: ps.isPublished ? 'Published' : ps.isDraft ? 'Draft' : ps.employeeId ? 'Assigned' : 'Open',
                isPublished: ps.isPublished,
                isDraft: ps.isDraft,
                isOnBidding: ps.isOnBidding,
                isTrading: ps.isTrading,
                isCancelled: ps.isCancelled,
                // groupColor stores the TemplateGroupType key so renderShiftCard can look up GROUP_COLORS
                groupColor: ps.groupType ?? 'convention_centre',
                subGroup: ps.subGroupName ?? undefined,
                assignedEmployeeId: ps.employeeId,
                rawShift: ps.raw,
                isUrgent: ps.isUrgent,
                isLocked: ps.isLocked,
                detailedCost: ps.detailedCost,
              })),
            ])
          ),
        })),
      }));
    }

    // Legacy fallback — used when projection is not yet available. Filtered by
    // the shared applyAdvancedFilters (its inline copy skipped trading, role and
    // search, so this branch filtered differently from every other view).
    if (!visibleShifts) return buildVisualGroupsFromShifts([]);
    return buildVisualGroupsFromShifts(visibleShifts);
  }, [projection, visibleShifts, rosterStructures, profileMap, summaryData, isDnDModeActive]);

  // ==================== AUTO-COLLAPSE PAST GROUPS ====================
  // A group is "all-past" when every date in the current view window falls
  // before today (start of Sydney day). This is memoized on visualGroups +
  // dates so it only recomputes when the data or date window changes.
  const pastGroupIds = useMemo((): Set<string> => {
    if (dates.length === 0) return new Set();
    const todayStart = startOfDay(new Date());
    const allPast = dates.every(d => isBefore(d, todayStart));
    if (!allPast) return new Set(); // At least one future/today date — no auto-collapse
    // Every date in the window is past: all groups are candidates.
    return new Set(visualGroups.map(g => g.id));
  }, [visualGroups, dates]);

  // Merge the persisted explicit collapses with the auto-collapsed past groups.
  // Groups in userExpandedGroupsRef are excluded from the auto-collapse so the
  // user can re-open a past group mid-session and have it stay open.
  const effectiveCollapsed = useMemo((): Set<string> => {
    const merged = new Set(collapsedGroups);
    for (const id of pastGroupIds) {
      if (!userExpandedGroupsRef.current.has(id)) {
        merged.add(id);
      }
    }
    return merged;
  }, [collapsedGroups, pastGroupIds]);

  // ==================== CONTEXT BUILDER ====================
  const buildShiftContext = (
    group: VisualGroup,
    subGroup: VisualSubGroup,
    date: Date,
    launchSource: 'grid' | 'global' | 'edit' = 'grid',
    specificRosterId?: string
  ): ShiftContext => {
    return {
      mode: 'group',
      launchSource,
      date: format(date, 'yyyy-MM-dd'),
      organizationId: organizationIdRef.current,
      organizationName: organizationNameRef.current,
      rosterId: specificRosterId || rosterIdRef.current,
      departmentId: departmentIdRef.current,
      departmentName: departmentNameRef.current,
      subDepartmentId: subDepartmentIdRef.current,
      subDepartmentName: subDepartmentNameRef.current,
      group_type: group.type,
      groupId: group.id,
      groupName: group.name,
      groupColor: group.color,
      subGroupId: subGroup.id,
      subGroupName: subGroup.name,
    };
  };

  // ==================== HANDLERS ====================

  const handleAddShift = async (group: VisualGroup, subGroup: VisualSubGroup, date: Date) => {
    if (!canEdit) return;



    // Check if date is in the past
    // Logic:
    // 1. If date < today, warn user (unless overridden or admin)
    // 2. If date is today, allow
    // 3. If date > today, allow

    if (isSydneyPast(date)) {
      toast({
        title: 'Past Date',
        description: 'Cannot add shifts on past dates.',
        variant: 'destructive',
      });
      return;
    }
    // a. Check if `rosterStructures` has a roster for this specific date
    // b. If not, Lazy Create it (or reuse existing draft)
    // c. Pass the ID to the modal context

    const dateKey = format(date, 'yyyy-MM-dd');
    const specificRoster = rosterStructures.find(r => dateKey >= r.startDate && dateKey <= r.endDate);
    // May be undefined on a day nobody has scheduled yet. That is no longer a
    // blocker: sm_create_shift resolves (and creates) the day's roster from
    // org/dept/sub-dept + shift_date via sm_resolve_roster. Passing it when we DO
    // know it keeps the explicit path, which stacks onto the roster the grid is
    // already showing instead of re-deriving it.
    const specificRosterId = specificRoster?.rosterId || rosterId;

    if (onAddShift) {
      onAddShift(group.name, subGroup.name, group.color, date, specificRosterId);
      return;
    }

    const context = buildShiftContext(group, subGroup, date, 'grid', specificRosterId);
    startTransition(() => {
      openShiftForm({ context });
    });
  };

  const handleEditShift = (
    shift: ShiftDisplay,
    group: VisualGroup,
    subGroup: VisualSubGroup,
    date: Date,
    launchSource: 'grid' | 'edit' | 'global' = 'grid'
  ) => {
    // SECURITY: prevent editing started shifts even if the modal logic is bypassed
    const startTimeStr = shift.rawShift.start_time;
    const shiftDateStr = shift.rawShift.shift_date;

    // Started check in Sydney (AEST/AEDT) — independent of the viewer's browser tz.
    const shiftStart = parseZonedDateTime(shiftDateStr, startTimeStr, SYDNEY_TZ);

    if (new Date() >= shiftStart && shift.rawShift.lifecycle_status !== 'Published') {
      toast({
        title: 'Shift Locked',
        description: 'This shift has already started and cannot be edited. You can only delete it from the menu.',
        variant: 'default',
      });
      return;
    }

    const context = buildShiftContext(group, subGroup, date, 'edit');

    // ENRICH CONTEXT WITH REAL SHIFT DATA TO ENSURE REFERENCE DATA LOADS (Roles, etc)
    // If we only rely on the current visual grid grouping, we might miss the actual
    // department or organization ID, causing roles or remuneration queries to skip.
    context.organizationId = shift.rawShift.organization_id || context.organizationId;
    context.departmentId = shift.rawShift.department_id || context.departmentId;
    context.subDepartmentId = shift.rawShift.sub_department_id || context.subDepartmentId;
    context.rosterId = shift.rawShift.roster_id || context.rosterId;
    context.roleId = shift.rawShift.role_id || undefined;
    context.employeeId = shift.rawShift.assigned_employee_id || undefined;

    startTransition(() => {
      openShiftForm({ context, editMode: true, existingShift: shift.rawShift });
    });
  };

  const handleDeleteShift = (shift: ShiftDisplay) => {
    setShiftToDelete(shift);
    setDeleteDialogOpen(true);
  };



  const confirmDeleteShift = async () => {
    if (!shiftToDelete) return;

    setIsDeleting(true);
    try {
      // Pass the version the UI is showing → the gateway rejects the delete with a
      // VERSION_CONFLICT if another manager changed this shift in the meantime.
      await deleteShiftMutation.mutateAsync({
        shiftId: shiftToDelete.rawShift.id,
        expectedVersion: shiftToDelete.rawShift.version,
      });
      toast({ title: 'Shift Deleted', description: 'The shift has been removed.' });
    } catch (error: any) {
      console.error('[confirmDeleteShift] Error:', error);
      // error.message is concurrency-aware (e.g. "changed by another manager").
      toast({ title: 'Error', description: error.message || 'Failed to delete shift.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setShiftToDelete(null);
    }
  };

  /**
   * Copy a full-time shift onto a range of dates — offered only on an assigned
   * FT shift. The flow checks leave, existing shifts, writable rosters and the
   * employee's cycle ceiling (cl 35.1(a)) for the range, and writes into
   * Office / Administration.
   */
  const openCopyShift = (shift: ShiftDisplay) => {
    const raw = shift.rawShift;
    if (raw.target_employment_type !== 'FT' || !raw.assigned_employee_id
      || !raw.role_id || !raw.organization_id || !raw.department_id || !raw.sub_department_id) return;
    setCopySource({
      employeeId: raw.assigned_employee_id,
      employeeName: shift.employeeName ?? '',
      dateKey: raw.shift_date,
      shift: raw,
      roleId: raw.role_id,
      organizationId: raw.organization_id,
      departmentId: raw.department_id,
      subDepartmentId: raw.sub_department_id,
    });
  };

  const handleCloneShift = async (shift: ShiftDisplay) => {
    try {
      const { rawShift } = shift;
      const cloneData: any = {
        roster_id: rawShift.roster_id,
        department_id: rawShift.department_id,
        sub_department_id: rawShift.sub_department_id,
        shift_date: rawShift.shift_date,
        start_time: rawShift.start_time,
        end_time: rawShift.end_time,
        organization_id: rawShift.organization_id,
        group_type: rawShift.group_type,
        sub_group_name: rawShift.sub_group_name,
        shift_group_id: (rawShift as any).shift_group_id,
        shift_subgroup_id: (rawShift as any).shift_subgroup_id || (rawShift as any).roster_subgroup_id,
        role_id: rawShift.role_id,
        remuneration_level: rawShift.remuneration_level,
        paid_break_minutes: rawShift.paid_break_minutes,
        unpaid_break_minutes: rawShift.unpaid_break_minutes,
        timezone: rawShift.timezone,
        required_skills: rawShift.required_skills || [],
        required_licenses: rawShift.required_licenses || [],
        event_ids: rawShift.event_ids || [],
        tags: rawShift.tags || [],
        notes: rawShift.notes,
        is_training: rawShift.is_training,
        // Mandatory on every shift (fn_shift_inherit_template_row raises 23502
        // without it), and the clone is for the same people as its source.
        // Omitted, every Clone failed with "target_employment_type is required".
        target_employment_type: (rawShift as any).target_employment_type,
        target_requires_flexible: (rawShift as any).target_requires_flexible,
        // assigned_employee_id is NOT copied as per refined requirements
      };

      await createShiftMutation.mutateAsync(cloneData);
      toast({
        title: 'Shift Cloned',
        description: 'A new draft replica has been created (unassigned).',
      });
    } catch (error: any) {
      toast({
        title: 'Clone Failed',
        description: error.message || 'Could not clone shift.',
        variant: 'destructive',
      });
    }
  };

  // Push to Bidding - marks shift as available for bidding
  // Bidding window auto-closes 4 hours before shift start
  const handleRequestPublish = (shift: ShiftDisplay) => {
    // SECURITY: prevent publishing started shifts
    if (isShiftLocked(shift.rawShift.shift_date, shift.rawShift.start_time, 'roster_management')) {
      toast({
        title: 'Action Locked',
        description: 'Cannot publish a shift that has already started.',
        variant: 'destructive',
      });
      return;
    }

    // BUSINESS POLICY: prevent publishing unassigned shifts within 4h of start.
    // Resolve the start as a real instant in Sydney (naive fallback would parse in
    // the viewer's browser tz); compare against the real current instant.
    const shiftStart = shift.rawShift.start_at
      ? new Date(shift.rawShift.start_at)
      : parseZonedDateTime(shift.rawShift.shift_date, shift.rawShift.start_time, SYDNEY_TZ);
    const now = new Date();
    const hoursToStart = differenceInHours(shiftStart, now);
    if (hoursToStart < 4 && (!shift.rawShift.assigned_employee_id || shift.rawShift.assignment_status === 'unassigned')) {
      toast({
        title: 'Use Emergency Assignment',
        description: 'This shift starts within 4 hours, so it can’t be opened for bidding — bids lock in the emergency window and it would immediately revert to Draft. Assign an employee to emergency-publish it instead.',
        variant: 'destructive',
      });
      return;
    }

    setPendingAction({ type: 'publish', shift });
    setConfirmActionOpen(true);
  };

  const handleRequestUnpublish = (shift: ShiftDisplay) => {
    // SECURITY: prevent unpublishing started shifts
    if (isShiftLocked(shift.rawShift.shift_date, shift.rawShift.start_time, 'roster_management')) {
      toast({
        title: 'Action Locked',
        description: 'Cannot unpublish a shift that has already started.',
        variant: 'destructive',
      });
      return;
    }
    setPendingAction({ type: 'unpublish', shift });
    setConfirmActionOpen(true);
  };

  const executePendingAction = async () => {
    if (!pendingAction) return;

    setIsProcessingAction(true);
    try {
      if (pendingAction.type === 'publish') {
        const result = await publishShiftMutation.mutateAsync(pendingAction.shift.id);
        if (!(result as any).success) {
          throw new Error((result as any).error || (result as any).message || 'Publish failed. This shift might be in an invalid state for publishing (e.g. already started or conflicting).');
        }
        toast({ title: 'Shift Published', description: 'Action completed successfully.' });
      } else if (pendingAction.type === 'unpublish') {
        await unpublishShiftMutation.mutateAsync({ shiftId: pendingAction.shift.id });
        toast({ title: 'Shift Unpublished', description: 'Action completed successfully.' });
      }
      // setRefreshKey not needed as mutation invalidates queries
      // setRefreshKey((k) => k + 1);
    } catch (error: any) {
      console.error(`[${pendingAction.type}] Error:`, error);
      toast({ title: 'Error', description: error.message || 'Action failed.', variant: 'destructive' });
    } finally {
      setIsProcessingAction(false);
      setConfirmActionOpen(false);
      setPendingAction(null);
    }
  };

  const handleToggleShiftSelection = useCallback((id: string) => {
    const shift = externalShifts.find(s => s.id === id);
    // Safely extract date and time to avoid undefined which would cause isShiftLocked to artificially lock the shift
    const shiftDate = shift?.shift_date;
    const startTime = shift?.start_time;

    // Check if shift is locked before toggling
    if (shift && shiftDate && startTime && isShiftLocked(shiftDate, startTime, 'roster_management')) {
      toast({
        title: 'Selection Blocked',
        description: 'You cannot select a locked shift.',
        variant: 'destructive',
      });
      return;
    }
    if (onToggleShiftSelection) {
      onToggleShiftSelection(id);
    }
  }, [externalShifts, onToggleShiftSelection, toast]);



  // ==================== RENDER SHIFT CARD ====================
  const renderShiftCard = (
    shift: ShiftDisplay,
    group: VisualGroup,
    subGroup: VisualSubGroup,
    date: Date
  ) => {
    // Check if this is a past shift (Date-wise)
    const isPastDate = isSydneyStarted(format(date, 'yyyy-MM-dd'), shift.startTime);

    // Strict Locking Check (Includes past TIME on current day + 4h rule)
    const isLocked = shift.isLocked;

    // Sydney (AEST/AEDT) start instant, independent of the viewer's browser tz.
    const shiftStart = parseZonedDateTime(format(date, 'yyyy-MM-dd'), shift.startTime, SYDNEY_TZ);

    const now = new Date();
    const hoursToStart = differenceInHours(shiftStart, now);
    const minutesToStart = differenceInMinutes(shiftStart, now);
    const isEmergency = hoursToStart < 4;

    // DEBUG: Log calculation for shifts starting soon
    // if (hoursToStart < 6) {
    //   console.log(`[ShiftCard] ${shift.id} Start:${shift.startTime} Now:${format(now, 'HH:mm')} Diff:${hoursToStart}h${minutesToStart % 60}m Emergency:${isEmergency} OnBidding:${shift.isOnBidding}`);
    // }

    const groupConfig = GROUP_COLORS[shift.groupColor as TemplateGroupType] || GROUP_COLORS.convention_centre;
    const accentColor = groupConfig.accent === 'emerald' ? 'green' : groupConfig.accent;

    const lifecycleStatus = shift.isPublished ? 'published' : shift.isDraft ? 'draft' : 'draft';

    const menu = (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            className="h-6 w-6 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/20 rounded transition-colors text-slate-700 dark:text-white/80 hover:text-slate-950 dark:hover:text-white"
            onClick={(e) => e.stopPropagation()}
            disabled={isLocked && false}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-popover border-border min-w-[200px] z-50 shadow-lg">
          {(() => {
            const hasStarted = isSydneyStarted(shift.rawShift.shift_date, shift.startTime);

            return (
              <>
                {/* 1. Clone */}
                <DropdownMenuItem
                  disabled={hasStarted || !canEdit}
                  onClick={() => handleCloneShift(shift)}
                  className={cn(
                    "text-popover-foreground hover:bg-accent cursor-pointer",
                    (hasStarted || !canEdit) && "text-muted-foreground/50 cursor-not-allowed"
                  )}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Clone Shift {hasStarted ? '(Started)' : !canEdit ? '(View Only)' : ''}
                </DropdownMenuItem>

                {/* 2. Edit */}
                <DropdownMenuItem
                  disabled={hasStarted || !canEdit}
                  onClick={() => handleEditShift(shift, group, subGroup, date)}
                  className={cn(
                    "text-popover-foreground hover:bg-accent cursor-pointer",
                    (hasStarted || !canEdit) && "text-muted-foreground/50 cursor-not-allowed"
                  )}
                >
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit Shift {hasStarted ? '(Started)' : !canEdit ? '(View Only)' : ''}
                </DropdownMenuItem>

                {/* 3. Audit */}
                <DropdownMenuItem
                  onClick={() => setAuditedShift(shift.rawShift)}
                  className="text-popover-foreground hover:bg-accent cursor-pointer"
                >
                  <ShieldCheck className="h-4 w-4 mr-2 text-indigo-500" />
                  Audit Compliance
                </DropdownMenuItem>

                {/* 4. More: Scheduled vs Actual vs Billable & Variance */}
                {shift.rawShift.target_employment_type === 'FT' && (
                  <DropdownMenuItem
                    onClick={() => setExpandedShift(shift.rawShift)}
                    className="text-popover-foreground hover:bg-accent cursor-pointer"
                  >
                    <Layers className="h-4 w-4 mr-2 text-cyan-500" />
                    More (Variance & Pay)
                  </DropdownMenuItem>
                )}
                {shift.rawShift.target_employment_type !== 'FT' && (
                  <DropdownMenuItem
                    onClick={() => setExpandedShift(shift.rawShift)}
                    className="text-popover-foreground hover:bg-accent cursor-pointer"
                  >
                    <Layers className="h-4 w-4 mr-2 text-cyan-500" />
                    More (Variance & Pay)
                  </DropdownMenuItem>
                )}

                {/* Publish / Unpublish where applicable */}
                {!hasStarted && canEdit && shift.isDraft && !shift.isPublished && (
                  <DropdownMenuItem
                    disabled={isEmergency && (!shift.rawShift.assigned_employee_id || shift.rawShift.assignment_status === 'unassigned')}
                    onClick={() => handleRequestPublish(shift)}
                    className={cn(
                      "text-popover-foreground hover:bg-accent cursor-pointer",
                      isEmergency && (!shift.rawShift.assigned_employee_id || shift.rawShift.assignment_status === 'unassigned') && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {isEmergency && (!shift.rawShift.assigned_employee_id || shift.rawShift.assignment_status === 'unassigned')
                      ? 'Publish (Assign Required)'
                      : 'Publish Shift'}
                  </DropdownMenuItem>
                )}

                {!hasStarted && canEdit && shift.rawShift.lifecycle_status === 'Published' && (
                  <DropdownMenuItem
                    onClick={() => handleRequestUnpublish(shift)}
                    className="text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer"
                  >
                    <Undo2 className="h-4 w-4 mr-2" />
                    Unpublish Shift
                  </DropdownMenuItem>
                )}

                {/* Copy to... on FT shifts */}
                {canEdit && shift.rawShift.target_employment_type === 'FT' && shift.rawShift.assigned_employee_id && (
                  <DropdownMenuItem
                    onClick={() => openCopyShift(shift)}
                    className="text-popover-foreground hover:bg-accent cursor-pointer"
                  >
                    <CopyPlus className="h-4 w-4 mr-2" />
                    Copy to…
                  </DropdownMenuItem>
                )}

                <DropdownMenuSeparator className="bg-border" />

                {/* 5. Delete */}
                <DropdownMenuItem
                  disabled={hasStarted || !canEdit}
                  onClick={() => handleDeleteShift(shift)}
                  className={cn(
                    "text-destructive hover:bg-destructive/10 cursor-pointer",
                    (hasStarted || !canEdit) && "text-muted-foreground/50 cursor-not-allowed"
                  )}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Shift {hasStarted ? '(Started)' : !canEdit ? '(View Only)' : ''}
                </DropdownMenuItem>
              </>
            );
          })()}
        </DropdownMenuContent>
      </DropdownMenu>
    );

    return (
      <div
        key={shift.id}
        className="h-full relative group/card"
        onDoubleClick={() => {
          const hasStarted = isSydneyStarted(shift.rawShift.shift_date, shift.startTime);

          if (hasStarted) {
            toast({
              title: 'Shift Locked',
              description: 'This shift has already started and cannot be edited. You can only delete it from the menu.',
              variant: 'default',
            });
            return;
          }

          if (!isLocked) {
            handleEditShift(shift, group, subGroup, date);
          }
        }}
      >
        <SmartShiftCard
          shift={{
            ...shift.rawShift,
            employeeName: shift.employeeName,
          } as Shift}
          variant="compact"
          groupColor={accentColor}
          compliance={complianceMap?.[shift.id]}
          headerAction={!isBulkMode ? menu : undefined}
          isSelected={isBulkMode && selectedV8ShiftIdsSet.has(shift.id)}
          isLocked={isLocked || (isDnDModeActive && !shift.isDraft)}
          isPast={isPastDate}
          isDnDActive={isDnDModeActive}
          detailedCost={shift.detailedCost}
          onClick={() => isBulkMode && handleToggleShiftSelection(shift.id)}
        />
      </div>
    );
  };

  // ==================== LOADING STATE ====================
  // Previously: full early-return to a centered spinner while shifts loaded.
  // That blocked the group headers from rendering, so LCP fired on whatever
  // text paint happened first — measured as 6.32s in a recent trace because
  // the LCP element (the group h3) couldn't render until the query finished.
  //
  // visualGroups always returns the three default groups (Convention Centre,
  // Exhibition Centre, Theatre) even with empty shifts via
  // buildVisualGroupsFromShifts([]) — so rendering the headers immediately
  // gives the browser an LCP candidate within the first React commit.
  // The parent page already overlays a "Loading shifts…" indicator on top.

  const activeSubGroupScope = activeSubGroup ? subGroupScopeFor(activeSubGroup.groupExternalId) : null;
  const activeSubGroupScopeLabel = activeSubGroupScope
    ? `${GROUP_DISPLAY_NAMES[activeSubGroupScope.groupExternalId as TemplateGroupType] ?? activeSubGroupScope.groupExternalId} · ` +
      formatRange(activeSubGroupScope.startDate, activeSubGroupScope.endDate)
    : '';

  // ==================== MAIN RENDER ====================
  return (
    <>
      <div className="flex flex-col h-full transition-colors bg-background relative overflow-hidden">
        {/* DnD Mode Indicator */}
        {isDnDModeActive && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
            <Badge className="px-4 py-1.5 bg-emerald-600 text-white border border-emerald-500/40 shadow-sm flex items-center gap-2 text-[11px] font-semibold rounded-full">
              <Zap className="h-3.5 w-3.5" />
              DnD Mode Active
            </Badge>
          </div>
        )}

        {/* Main Content (day / 3-day / week / month grid) */}
        <ScrollArea ref={scrollAreaRef} className="flex-1">
            <div className="p-4 md:p-5 space-y-6">
              {visualGroups.map((group) => (
                <GroupSection
                  key={group.type}
                  group={group}
                  dates={dates}
                  isShiftsLoading={isShiftsLoading}
                  canEdit={canEdit}
                  isBulkMode={isBulkMode}
                  externalShifts={externalShifts}
                  isDateInTemplate={isDateInTemplate}
                  shiftsByBucketKey={shiftsByBucketKey}
                  selectedV8ShiftIdsSet={selectedV8ShiftIdsSet}
                  onDeselectShiftIds={onDeselectShiftIds}
                  onSelectShiftIds={onSelectShiftIds}
                  isDnDModeActive={isDnDModeActive}
                  summaryData={summaryData}
                  onDrillDown={onDrillDown}
                  onNavigateToMonth={onNavigateToMonth}
                  renderShiftCard={renderShiftCard}
                  handleAddShift={handleAddShift}
                  handleShiftDrop={handleShiftDrop}
                  handleEmployeeDrop={handleEmployeeDrop}
                  setActiveSubGroup={setActiveSubGroup}
                  setIsRenameOpen={setIsRenameOpen}
                  setIsCloneOpen={setIsCloneOpen}
                  setIsDeleteOpen={setIsDeleteOpen}
                  getSubGroupTemplateLabel={getSubGroupTemplateLabel}
                  subGroupActionsBlockedReason={subGroupActionsBlockedReason}
                  isInitiallyCollapsed={effectiveCollapsed.has(group.id)}
                  onToggleCollapse={handleToggleGroupCollapse}
                />
              ))}

              {visualGroups.length === 0 && !isShiftsLoading && (
                <RosterEmptyState
                  icon={Layers}
                  title="No groups found"
                  description="No roster groups or sub-groups have been configured for this department."
                />
              )}
            </div>
          </ScrollArea>

        <ShiftExpandDialog shift={expandedShift} onOpenChange={(o) => { if (!o) setExpandedShift(null); }} />
        <ShiftAuditDialog shift={auditedShift} onOpenChange={(o) => { if (!o) setAuditedShift(null); }} />

        {/* Copy a full-time shift onto a range */}
        <CopyShiftFlow
          source={copySource}
          defaultEndDate={copySource
            ? format(endOfWeek(parseISO(copySource.dateKey), { weekStartsOn: 1 }), 'yyyy-MM-dd')
            : ''}
          referenceDate={format(getSydneyNow(), 'yyyy-MM-dd')}
          onClose={() => setCopySource(null)}
          onCopied={() => { void queryClient.invalidateQueries({ queryKey: shiftKeys.all }); }}
        />

        {/* Delete Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Shift?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-[13px] text-muted-foreground">
                  <p>
                    This action cannot be undone. The shift "{shiftToDelete?.role}" will be permanently removed.
                  </p>
                  {(() => {
                    // A full-time employee is owed their contracted hours over the
                    // declared cycle, so deleting one of their shifts leaves the
                    // cycle short — said here, as the Office page did.
                    const raw = shiftToDelete?.rawShift as (Shift & { net_length_minutes?: number | null }) | undefined;
                    if (!raw || raw.target_employment_type !== 'FT' || !raw.assigned_employee_id) return null;
                    const hours = Number(raw.net_length_minutes ?? 0) / 60;
                    const label = `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
                    return (
                      <p>
                        This removes <strong className="text-foreground">{label}</strong> from{' '}
                        {shiftToDelete?.employeeName ? `${shiftToDelete.employeeName}'s` : 'their'} contracted
                        cycle. A full-time employee is owed their contracted hours over the declared cycle
                        (ICC EBA cl 35.1(a)), so it will be short until another shift replaces this one.
                      </p>
                    );
                  })()}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                className="border-border text-muted-foreground hover:bg-muted"
                disabled={isDeleting}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteShift}
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>




        {/* Bulk actions toolbar removed - now rendered in RostersPlannerPage */}
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmActionOpen} onOpenChange={setConfirmActionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {pendingAction?.type === 'publish' && 'Publish Shift'}
              {pendingAction?.type === 'unpublish' && 'Unpublish Shift'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.type === 'publish' && (
                pendingAction.shift.rawShift.assigned_employee_id
                  ? "This shift is assigned. Publishing will send a job offer to the employee. They must accept it to confirm."
                  : "This shift is unassigned. Publishing will open it for bidding to eligible employees."
              )}
              {pendingAction?.type === 'unpublish' && "This shift will be unpublished and reverted to Draft."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-border text-muted-foreground hover:bg-muted"
              disabled={isProcessingAction}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                executePendingAction();
              }}
              className={cn(
                "text-white",
                pendingAction?.type === 'publish'
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-amber-600 hover:bg-amber-700"
              )}
              disabled={isProcessingAction}
            >
              {isProcessingAction ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Emergency Cover Alert */}
      <AlertDialog open={isEmergencyAlertOpen} onOpenChange={setIsEmergencyAlertOpen}>
        <AlertDialogContent className="bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-500/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600 dark:text-red-400 flex items-center gap-2">
              <Ban className="h-5 w-5" />
              Emergency Cover Required
            </AlertDialogTitle>
            <AlertDialogDescription>
              {emergencyAlertMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-background dark:bg-white/10 text-foreground hover:bg-muted dark:hover:bg-white/20 border-border dark:border-white/10">Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



      {/* SubGroup Actions Dialogs — each previews the change (dry run) before making it */}
      {activeSubGroup && activeSubGroupScope && (
        <>
          <RenameSubGroupDialog
            currentName={activeSubGroup.name}
            scopeLabel={activeSubGroupScopeLabel}
            isOpen={isRenameOpen}
            onOpenChange={setIsRenameOpen}
            onPreview={async (newName) =>
              describeSubgroupRename(
                await renameRosterSubgroup(activeSubGroupScope, activeSubGroup.name, newName, true),
                activeSubGroup.name,
                newName,
              )}
            onRename={async (newName) => {
              await renameSubGroupMutation.mutateAsync({ scope: activeSubGroupScope, oldName: activeSubGroup.name, newName });
            }}
          />
          <CloneSubGroupDialog
            currentName={activeSubGroup.name}
            scopeLabel={activeSubGroupScopeLabel}
            isOpen={isCloneOpen}
            onOpenChange={setIsCloneOpen}
            onPreview={async (newName) =>
              describeSubgroupClone(
                await cloneRosterSubgroup(activeSubGroupScope, activeSubGroup.name, newName, true),
                activeSubGroup.name,
                newName,
              )}
            onClone={async (newName) => {
              await cloneSubGroupMutation.mutateAsync({ scope: activeSubGroupScope, sourceName: activeSubGroup.name, newName });
            }}
          />
          <DeleteSubGroupDialog
            subGroupName={activeSubGroup.name}
            scopeLabel={activeSubGroupScopeLabel}
            isOpen={isDeleteOpen}
            onOpenChange={setIsDeleteOpen}
            onPreview={async () =>
              describeSubgroupDeletion(
                await deleteRosterSubgroup(activeSubGroupScope, activeSubGroup.name, true),
                activeSubGroup.name,
              )}
            onConfirm={async () => {
              await deleteSubGroupMutation.mutateAsync({ scope: activeSubGroupScope, name: activeSubGroup.name });
            }}
          />
        </>
      )}

      {/* DnD Assign Compliance Modal — only rendered when NOT using centralized parent handler */}
      {!onAssignShift && pendingDndAssign && (
        <DndAssignModal
          open={!!pendingDndAssign}
          onClose={() => setPendingDndAssign(null)}
          onConfirm={handleDndAssignConfirm}
          isAssigning={isDndAssigning}
          shiftId={pendingDndAssign.shiftId}
          employeeId={pendingDndAssign.employeeId}
          employeeName={pendingDndAssign.employeeName}
          shiftRole={pendingDndAssign.shiftDisplay.role}
          shiftDate={pendingDndAssign.shiftDisplay.rawShift.shift_date}
          shiftStartTime={pendingDndAssign.shiftDisplay.startTime}
          shiftEndTime={pendingDndAssign.shiftDisplay.endTime}
        />
      )}
    </>
  );
};

