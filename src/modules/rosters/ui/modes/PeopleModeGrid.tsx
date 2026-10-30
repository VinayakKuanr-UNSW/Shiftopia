import React, { useMemo, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';


import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import {
  MoreHorizontal,
  Undo2,
  Edit2,
  Zap,
  Flame,
  Users,
  Search,
  X,
  ShieldCheck,
  Layers,
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { SmartShiftCard, type ComplianceInfo } from '@/modules/rosters/ui/components/SmartShiftCard';
import { resolveGroupType, resolveShiftStatus } from '@/modules/rosters/utils/roster-utils';
import { DroppableDateCell } from '@/modules/rosters/ui/components/DroppableDateCell';
import { useApprovedLeaveDays } from '@/modules/rosters/hooks/useApprovedLeaveDays';
import { LeaveDayCard } from '@/modules/rosters/ui/components/LeaveDayCard';
import { RosterCellAddButton } from '@/modules/rosters/ui/components/RosterCellAddButton';
import { RosterEmptyState } from '@/modules/rosters/ui/components/RosterEmptyState';
import { ShiftExpandDialog } from '@/modules/rosters/ui/dialogs/ShiftExpandDialog';
import { ShiftAuditDialog } from '@/modules/rosters/ui/dialogs/ShiftAuditDialog';
import type { RawLeaveDay } from '@/modules/office/domain/types';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import { getPublicHolidayName } from '@/modules/core/lib/holidays';
import { isSydneyPast, todayISO } from '@/modules/core/lib/date.utils';
import { 
  PeopleModeEmployee, 
  PeopleModeShift, 
  DND_SHIFT_TYPE,
  ShiftDragItem
} from './people-mode.types';
import type { UnfilledShift } from './UnfilledShiftsPanel';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { useShallow } from 'zustand/react/shallow';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { useDrag } from 'react-dnd';
import { canDragShift } from '@/modules/rosters/utils/dnd.utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { getFatigueBand } from '@/modules/rosters/domain/projections/utils/fatigue';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';

/* ============================================================
   INTERFACES
   ============================================================ */

// Re-export for backward compatibility if needed, or just use the imported ones
export type EmployeeShift = PeopleModeShift;

// ── Module-scope no-op so that an absent onAssignShift prop doesn't bust
//    referential equality on every render of every DroppableDateCell.
const NOOP_ASSIGN: (shift: UnfilledShift, employeeId: string, dateKey: string) => void = () => {};

// ── Virtualization constants ─────────────────────────────────────────────────
// Estimated row height in px. Real rows vary with shift count per day, but the
// majority cluster around 200–240px. `useVirtualizer`'s dynamic measurement
// (`measureElement`) corrects drift after first paint, so the estimate is only
// used for the initial total-size calculation.
const VIRT_ROW_HEIGHT = 220;
const VIRT_OVERSCAN = 5;

// Shared CSS-grid column template. Header and every (virtualized,
// absolutely-positioned) row reference the SAME track sizes, so columns can
// never drift. This replaced the old <table>, whose absolutely-positioned
// virtual <tr>s left the table's column model and misaligned the grid lines.
const PEOPLE_COL_EMP_W = 240; // px — sticky employee column
const PEOPLE_COL_DAY_W = 180; // px — per-day column (standardized across modes)
const peopleGridCols = (dayCount: number) =>
  `${PEOPLE_COL_EMP_W}px repeat(${dayCount}, minmax(${PEOPLE_COL_DAY_W}px, 1fr))`;

// ── canUnpublish — any Published shift can be unpublished (→ S1 or S2) ───────
function canUnpublish(shift: PeopleModeShift): boolean {
  return shift.lifecycleStatus === 'published';
}

interface PeopleModeGridProps {
  employees: PeopleModeEmployee[];
  dates: Date[];
  canEdit: boolean;
  isBulkMode?: boolean;
  selectedShifts?: string[];
  onToggleShiftSelection?: (shiftId: string) => void;
  onAddShift: (employee: PeopleModeEmployee, date: Date) => void;
  onViewShift?: (shift: PeopleModeShift) => void;
  /** Compliance data map: shiftId -> ComplianceInfo */
  complianceMap?: Record<string, ComplianceInfo>;
  /** Card variant: compact (default) or detailed */
  cardVariant?: 'compact' | 'detailed';
  onUnpublishShift?: (shiftId: string) => void;

  /** Called when an unfilled shift is drag-dropped onto an employee date cell */
  onAssignShift?: (shift: UnfilledShift, employeeId: string, dateKey: string) => void;
  /** Called when an existing shift is moved */
  onMoveShift?: (shiftId: string, targetEmployeeId: string, targetDate: string) => void;

  /** Integrated column header search */
  searchTerm?: string;
  onSearchChange?: (term: string) => void;
}

/* ============================================================
   DRAGGABLE SHIFT CARD WRAPPER
   ============================================================ */

interface DraggableShiftCardProps {
  shift: PeopleModeShift;
  employee: PeopleModeEmployee;
  children: React.ReactNode;
  disabled?: boolean;
}

const DraggableShiftCardImpl: React.FC<DraggableShiftCardProps> = ({
  shift,
  employee,
  children,
  disabled,
}) => {
  const shiftId = shift.id;
  const subGroup = shift.subGroup;
  const startTime = shift.startTime;
  const endTime = shift.endTime;
  const isPublished = shift.lifecycleStatus === 'published';
  const isCancelled = shift.isCancelled;
  const shiftDate = shift.rawShift?.shift_date || '';
  const sourceGroupType = (shift as any).groupType || 'people-mode';

  // canDrag reads isDnDModeActive via getState() so flipping the global flag
  // does NOT re-render every card or re-register every drag spec. Previously
  // this was a reactive subscription + dep — measured as ~800ms INP on the
  // DnD toggle in the 1.4k-card grid.
  const [{ isDragging }, drag] = useDrag(() => ({
    type: DND_SHIFT_TYPE,
    item: {
      shiftId,
      sourceGroupType,
      sourceSubGroup: subGroup || 'Unassigned',
      shiftDate,
      startTime,
      endTime,
      lifecycle_status: isPublished ? 'Published' : 'Draft',
      is_cancelled: isCancelled,
    } as ShiftDragItem,
    canDrag: () => canDragShift(
      {
        lifecycle_status: isPublished ? 'Published' : 'Draft',
        is_cancelled: isCancelled,
      },
      useRosterStore.getState().isDnDModeActive,
    ) && !disabled,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [shiftId, subGroup, startTime, endTime, isPublished, isCancelled, shiftDate, sourceGroupType, disabled, employee.id]);

  return (
    <div
      ref={drag}
      className={cn(
        'transition-all duration-300',
        isDragging && 'opacity-40 scale-95 rotate-1 grayscale shadow-none'
      )}
    >
      {React.cloneElement(children as React.ReactElement, { isDragging })}
    </div>
  );
};

const DraggableShiftCard = React.memo(DraggableShiftCardImpl);

/* ============================================================
   SHIFT ROW MENU (memoized)
   ============================================================ */

interface ShiftRowMenuProps {
  shift: PeopleModeShift;
  onEdit: (shift: PeopleModeShift) => void;
  onUnpublish?: (shiftId: string) => void;
  onExpand?: (shift: PeopleModeShift) => void;
  onAudit?: (shift: PeopleModeShift) => void;
}

const ShiftRowMenu = React.memo<ShiftRowMenuProps>(({ shift, onEdit, onUnpublish, onExpand, onAudit }) => {
  const { isPast } = resolveShiftStatus(shift);

  return (
    // modal={false}: skip Radix focus trap + body lock. A 3-item menu over a
    // shift card doesn't need either; the trap traversal showed up as the
    // FocusOnMount span in the INP trace.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className="h-6 w-6 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/20 rounded transition-colors text-slate-700 dark:text-white/80 hover:text-slate-950 dark:hover:text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border min-w-[200px] z-50 shadow-lg">
        {/* 1. Edit */}
        <DropdownMenuItem
          disabled={isPast}
          onClick={() => onEdit(shift)}
          className={cn(
            "text-popover-foreground hover:bg-accent cursor-pointer",
            isPast && "text-muted-foreground/50 cursor-not-allowed"
          )}
        >
          <Edit2 className="h-4 w-4 mr-2" />
          Edit Shift {isPast && '(Locked)'}
        </DropdownMenuItem>

        {/* 2. Audit */}
        {onAudit && (
          <DropdownMenuItem
            onClick={() => onAudit(shift)}
            className="text-popover-foreground hover:bg-accent cursor-pointer"
          >
            <ShieldCheck className="h-4 w-4 mr-2 text-indigo-500" />
            Audit Compliance
          </DropdownMenuItem>
        )}

        {/* 3. More: Scheduled vs Actual vs Billable & Variance */}
        {onExpand && shift.rawShift?.target_employment_type === 'FT' && (
          <DropdownMenuItem
            onClick={() => onExpand(shift)}
            className="text-popover-foreground hover:bg-accent cursor-pointer"
          >
            <Layers className="h-4 w-4 mr-2 text-cyan-500" />
            More (Variance & Pay)
          </DropdownMenuItem>
        )}
        {onExpand && shift.rawShift?.target_employment_type !== 'FT' && (
          <DropdownMenuItem
            onClick={() => onExpand(shift)}
            className="text-popover-foreground hover:bg-accent cursor-pointer"
          >
            <Layers className="h-4 w-4 mr-2 text-cyan-500" />
            More (Variance & Pay)
          </DropdownMenuItem>
        )}

        {canUnpublish(shift) && !isPast && onUnpublish && (
          <DropdownMenuItem
            onClick={() => onUnpublish(shift.id)}
            className="text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer"
          >
            <Undo2 className="h-4 w-4 mr-2" />
            Unpublish Shift
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
ShiftRowMenu.displayName = 'ShiftRowMenu';

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
const PeopleModeGrid: React.FC<PeopleModeGridProps> = ({
  employees,
  dates,
  canEdit,
  isBulkMode: propIsBulkMode = false,
  selectedShifts: propsSelectedShifts = [],
  onToggleShiftSelection,
  onAddShift,
  onViewShift,
  complianceMap,
  cardVariant = 'compact',
  onUnpublishShift,

  onAssignShift,
  onMoveShift,
  searchTerm = '',
  onSearchChange,
}) => {
  const [isSearchOpen, setIsSearchOpen] = React.useState(Boolean(searchTerm));
  React.useEffect(() => {
    if (searchTerm) setIsSearchOpen(true);
  }, [searchTerm]);

  const {
    bulkModeActive: globalBulkModeActive,
    toggleShiftSelection: globalToggleShiftSelection,
  } = useRosterStore(
    useShallow((s) => ({
      bulkModeActive: s.bulkModeActive,
      selectedV8ShiftIds: s.selectedV8ShiftIds,
      toggleShiftSelection: s.toggleShiftSelection,
    })),
  );

  const isBulkMode = propIsBulkMode || globalBulkModeActive;
  const { toggleShiftSelection: uiToggleShiftSelection } = useRosterUI();

  const currentSelectedShifts = propsSelectedShifts;
  // O(1) lookup for the selection check that runs once per shift card.
  // Memoized on the array reference so identical selection state doesn't
  // rebuild the Set on every render of the parent.
  const currentSelectedShiftsSet = useMemo(
    () => new Set(currentSelectedShifts),
    [currentSelectedShifts],
  );

  const [expandedShift, setExpandedShift] = React.useState<Shift | null>(null);
  const [auditedShift, setAuditedShift] = React.useState<Shift | null>(null);

  const handleExpandShift = useCallback((shift: PeopleModeShift) => {
    if (shift.rawShift) setExpandedShift(shift.rawShift as Shift);
  }, []);

  const handleAuditShift = useCallback((shift: PeopleModeShift) => {
    if (shift.rawShift) setAuditedShift(shift.rawShift as Shift);
  }, []);

  const handleEditShift = useCallback((shift: PeopleModeShift) => {
    onViewShift?.(shift);
  }, [onViewShift]);

  const handleShiftClick = useCallback((shift: PeopleModeShift) => {
    if (isBulkMode) {
      // Prioritize prop-based toggle, then global store, then UI context
      if (onToggleShiftSelection) {
        onToggleShiftSelection(shift.id);
      } else if (globalToggleShiftSelection) {
        globalToggleShiftSelection(shift.id);
      } else {
        uiToggleShiftSelection(shift.id);
      }
    } else {
      onViewShift?.(shift);
    }
  }, [isBulkMode, onToggleShiftSelection, globalToggleShiftSelection, uiToggleShiftSelection, onViewShift]);

  const stableOnAssign = onAssignShift ?? NOOP_ASSIGN;
  const isDnDModeActive = useRosterStore(s => s.isDnDModeActive);
  // Profile IDs for the approved-leave lookup. (The availability overlay that
  // also read these is retired: availability is managed on Team Availability.)
  const profileIds = useMemo(() => employees.map(e => e.id), [employees]);

  // Approved leave — a leave card on the day, and the day closed to rostering.
  const { getLeave } = useApprovedLeaveDays(profileIds, dates);

  const showFatigueHeatmap = useRosterStore(s => s.showFatigueHeatmap);

  // FTG is the PEAK fatigue over the days currently shown (each day computed with
  // a full 7-day history lookback, so a given day reads the same in any zoom).
  // Surface the window in the tooltip so it's clear the number is view-scoped.

  // ── Virtualization: `@tanstack/react-virtual` measures rows dynamically so
  //    rows whose actual height differs from VIRT_ROW_HEIGHT don't drift over
  //    long scroll distances. With negligible overhead at small list sizes we
  //    virtualize unconditionally — no threshold guard needed.
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: employees.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => VIRT_ROW_HEIGHT,
    overscan: VIRT_OVERSCAN,
    measureElement: (el) => el?.getBoundingClientRect().height ?? VIRT_ROW_HEIGHT,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <TooltipProvider delayDuration={200}>
      {showFatigueHeatmap && (
        <div className="absolute top-4 right-4 z-[60] flex items-center gap-4 animate-in fade-in slide-in-from-right-4 duration-500">
          <Badge className="px-3.5 py-1.5 bg-amber-600 text-white border border-amber-500/40 shadow-sm flex items-center gap-2 text-[11px] font-bold rounded-full">
            <Flame className="h-3.5 w-3.5" />
            HEALTH MODE
          </Badge>
          
          <div className="hidden md:flex items-center gap-3 px-4 py-1.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10">
            {[
              { color: 'bg-emerald-500', label: 'Optimal' },
              { color: 'bg-amber-500', label: 'Risk' },
              { color: 'bg-red-500', label: 'Critical' },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className={cn("h-1.5 w-1.5 rounded-full", l.color)} />
                <span className="text-[11px] font-black uppercase tracking-wider text-white/60">{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* DnD Mode Indicator */}
      {isDnDModeActive && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-500 pointer-events-none">
          <Badge className="px-4 py-1.5 bg-emerald-600 text-white border border-emerald-500/40 shadow-sm flex items-center gap-2 text-[11px] font-semibold rounded-full">
            <Zap className="h-3.5 w-3.5" />
            DnD Mode Active
          </Badge>
        </div>
      )}

      {/* ==================== TABLE CONTAINER — Grid is the container itself ==================== */}
      <div
        ref={scrollContainerRef}
        className="overflow-auto flex-1 h-full min-h-0 custom-scrollbar relative isolate bg-background"
      >
        <div role="table" className="relative" style={{ width: 'max-content', minWidth: '100%' }}>
                {/* ==================== HEADER ROW ==================== */}
                <div role="row" className="grid sticky top-0 z-30 bg-muted/80 backdrop-blur-md dark:bg-muted/40 border-b border-border shadow-xs" style={{ gridTemplateColumns: peopleGridCols(dates.length) }}>
                  {/* Employee Column Header with Integrated Search */}
                  <div role="columnheader" className="sticky top-0 left-0 z-30 flex items-center bg-muted/90 backdrop-blur-md dark:bg-muted/50 border-r border-b border-border px-3 py-2 text-left shadow-[2px_0_6px_-2px_rgba(0,0,0,0.1)]">
                    {isSearchOpen && onSearchChange ? (
                      <div className="flex items-center gap-1.5 w-full bg-background/90 rounded-md px-2 py-1 border border-border shadow-xs focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
                        <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <input
                          autoFocus
                          value={searchTerm}
                          onChange={(e) => onSearchChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setIsSearchOpen(false);
                              if (searchTerm) onSearchChange('');
                            }
                          }}
                          placeholder="Search staff…"
                          className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/60 outline-none font-sans"
                        />
                        {searchTerm ? (
                          <button
                            type="button"
                            onClick={() => onSearchChange('')}
                            className="p-0.5 hover:text-foreground text-muted-foreground rounded transition-colors cursor-pointer"
                            title="Clear search"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setIsSearchOpen(false);
                            if (searchTerm) onSearchChange('');
                          }}
                          className="p-0.5 hover:text-foreground text-muted-foreground rounded transition-colors cursor-pointer"
                          title="Close search"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.14em] font-mono">Employee</span>
                          {searchTerm && (
                            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                              Filtered
                            </span>
                          )}
                        </div>
                        {onSearchChange && (
                          <button
                            type="button"
                            onClick={() => setIsSearchOpen(true)}
                            className={cn(
                              "p-1 rounded-md hover:bg-background/80 transition-colors cursor-pointer text-muted-foreground hover:text-foreground",
                              searchTerm && "text-primary bg-primary/10 hover:bg-primary/20"
                            )}
                            aria-label="Search employees"
                            title="Search employees by name"
                          >
                            <Search className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Date Column Headers */}
                  {dates.map((date, idx) => {
                    const dateIsToday = format(date, 'yyyy-MM-dd') === todayISO();
                    const holidayName = getPublicHolidayName(date);
                    return (
                      <div
                        role="columnheader"
                        key={idx}
                        data-today={dateIsToday ? "true" : undefined}
                        className={cn(
                          'sticky top-0 z-20 bg-muted/80 backdrop-blur-md dark:bg-muted/40 px-3 py-2.5 text-center transition-colors',
                          idx < dates.length - 1 && (holidayName ? 'border-r border-amber-500/20' : 'border-r border-border'),
                          holidayName ? 'bg-amber-500/10 dark:bg-amber-500/15 border-b-0' : 'border-b border-border',
                          dateIsToday && 'bg-primary/5'
                        )}
                      >
                        <div className={cn("text-[11px] font-bold uppercase tracking-[0.12em] font-mono leading-tight", holidayName ? "text-amber-400 font-extrabold" : dateIsToday ? "text-primary font-bold" : "text-muted-foreground")}>{format(date, 'EEE')}</div>
                        <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
                          <span className={cn("text-[13px] font-mono tabular-nums leading-none", holidayName ? "text-amber-300 font-bold" : dateIsToday ? "text-primary font-bold" : "text-muted-foreground/60 font-medium")}>
                            {format(date, 'MMM d')}
                          </span>
                          {holidayName && (
                            <span className="text-[11px] italic font-normal text-amber-400 dark:text-amber-300 truncate max-w-[140px]" title={`ANZ Public Holiday: ${holidayName}`}>
                              {holidayName}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ==================== BODY ROWS ==================== */}
                {/* `height` + `position: relative` give the virtualizer the
                    full scroll-bounding box; rows are absolutely positioned
                    by `translateY` so only the visible window mounts. */}
                {employees.length === 0 ? (
                  <div className="p-12 flex items-center justify-center min-w-[600px]">
                    <RosterEmptyState
                      icon={Users}
                      title="No employees found"
                      description="No employees match your search query or assigned department filter."
                    />
                  </div>
                ) : (
                  <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
                    {virtualItems.map((vi) => {
                      const employee = employees[vi.index];
                      if (!employee) return null;
                      return (
                        <EmployeeRow
                          key={employee.id}
                          ref={rowVirtualizer.measureElement}
                          data-index={vi.index}
                          gridTemplateColumns={peopleGridCols(dates.length)}
                          employee={employee}
                          empIdx={vi.index}
                          dates={dates}
                          canEdit={canEdit}
                          isBulkMode={isBulkMode}
                          showFatigueHeatmap={showFatigueHeatmap}
                          cardVariant={cardVariant}
                          complianceMap={complianceMap}
                          currentSelectedShifts={currentSelectedShiftsSet}
                          isDnDModeActive={isDnDModeActive}
                          getLeave={getLeave}
                          onAddShift={onAddShift}
                          onClickShift={handleShiftClick}
                          onEditShift={handleEditShift}
                          onExpandShift={handleExpandShift}
                          onAuditShift={handleAuditShift}
                          onUnpublishShift={onUnpublishShift}
                          onAssign={stableOnAssign}
                          onMoveShift={onMoveShift}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${vi.start}px)`,
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
      <ShiftExpandDialog shift={expandedShift} onOpenChange={(o) => { if (!o) setExpandedShift(null); }} />
      <ShiftAuditDialog shift={auditedShift} onOpenChange={(o) => { if (!o) setAuditedShift(null); }} />
    </TooltipProvider>
  );
};

export default PeopleModeGrid;

/* ============================================================
   EMPLOYEE ROW (memoized)
   ============================================================ */

interface EmployeeRowProps {
  employee: PeopleModeEmployee;
  empIdx: number;
  dates: Date[];
  canEdit: boolean;
  isBulkMode: boolean;
  showFatigueHeatmap: boolean;
  cardVariant: 'compact' | 'detailed';
  complianceMap?: Record<string, ComplianceInfo>;
  currentSelectedShifts: Set<string>;
  isDnDModeActive: boolean;
  getLeave: (employeeId: string, dateKey: string) => RawLeaveDay | undefined;
  onAddShift: (employee: PeopleModeEmployee, date: Date) => void;
  onClickShift: (shift: PeopleModeShift) => void;
  onEditShift: (shift: PeopleModeShift) => void;
  onExpandShift?: (shift: PeopleModeShift) => void;
  onAuditShift?: (shift: PeopleModeShift) => void;
  onUnpublishShift?: (shiftId: string) => void;
  onAssign: (shift: UnfilledShift, employeeId: string, dateKey: string) => void;
  onMoveShift?: (shiftId: string, targetEmployeeId: string, targetDate: string) => void;
  /** CSS grid track template shared with the header row so columns align. */
  gridTemplateColumns: string;
  // Forwarded by the virtualizer for absolute positioning + dynamic
  // measurement. `style` carries the translateY transform; `data-index`
  // lets `measureElement` correlate the DOM node back to the row index.
  style?: React.CSSProperties;
  'data-index'?: number;
}

const EmployeeRowImpl = React.forwardRef<HTMLDivElement, EmployeeRowProps>(({
  employee,
  empIdx,
  dates,
  canEdit,
  isBulkMode,
  showFatigueHeatmap,
  cardVariant,
  complianceMap,
  currentSelectedShifts,
  isDnDModeActive,
  getLeave,
  onAddShift,
  onClickShift,
  onEditShift,
  onExpandShift,
  onAuditShift,
  onUnpublishShift,
  onAssign,
  onMoveShift,
  gridTemplateColumns,
  style,
  'data-index': dataIndex,
}, ref) => {
  // Fatigue band drives the FTG badge, its tooltip, and the heatmap row tint —
  // one classification via the shared helper so the three can't drift.
  const fatigueBand = getFatigueBand(employee.fatigueScore);

  // A row with no contract baseline (casuals / zero-contract employees) has
  // nothing to measure utilization against, so we suppress the UTL bands, the
  // "/ Yh" fraction, and the progress bar for these rows.
  const hasContractBaseline = employee.periodContractedHours > 0;
  const isOffRoster = (employee as { isOffRoster?: boolean }).isOffRoster === true;

  return (
    <div
      role="row"
      ref={ref}
      data-index={dataIndex}
      style={{ ...style, gridTemplateColumns }}
      className={cn(
        'grid group relative border-b border-border/50',
        empIdx % 2 === 0 ? 'bg-card' : 'bg-muted/30'
      )}
    >
      {showFatigueHeatmap && (
        <div
          className={cn(
            'absolute inset-0 pointer-events-none',
            fatigueBand === 'ok' ? 'bg-emerald-500/5' :
            fatigueBand === 'risk' ? 'bg-amber-500/10' :
            'bg-red-500/15'
          )}
        />
      )}
      {/* ========== EMPLOYEE INFO CELL ========== */}
      <div role="cell" className="sticky left-0 z-20 sticky-employee-cell transition-colors border-r border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar className={cn(
            'h-10 w-10 shrink-0 ring-2 ring-offset-1',
            employee.overHoursWarning ? 'ring-amber-400/70' : 'ring-transparent'
          )}>
            <AvatarImage src={employee.avatar} alt={employee.name} />
            <AvatarFallback className="bg-primary/10 text-primary text-[13px] font-medium">
              {employee.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[13px] font-semibold text-foreground truncate">{employee.name}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {isOffRoster && (
                  <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded uppercase whitespace-nowrap">
                    Off-roster
                  </span>
                )}
                {employee.overHoursWarning && (
                  <span className="text-[11px] font-bold tracking-wider text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded uppercase">OT</span>
                )}
              </div>
            </div>

            {/* Hours row */}
            <div className="flex items-center justify-between text-[11px] font-mono mt-1">
              <span className={cn(
                'tabular-nums font-medium',
                employee.overHoursWarning ? 'text-amber-400' : 'text-muted-foreground'
              )}>
                {employee.currentHours.toFixed(1)}h{' '}
                {hasContractBaseline ? (
                  <span className="text-muted-foreground/40">/ {Math.round(employee.periodContractedHours)}h</span>
                ) : (
                  <span className="text-muted-foreground/40">· no contract</span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ========== DATE CELLS ========== */}
      {dates.map((date, dateIdx) => (
        <EmployeeDateCell
          key={dateIdx}
          employee={employee}
          date={date}
          isLastCol={dateIdx === dates.length - 1}
          canEdit={canEdit}
          isBulkMode={isBulkMode}
          cardVariant={cardVariant}
          complianceMap={complianceMap}
          currentSelectedShifts={currentSelectedShifts}
          isDnDModeActive={isDnDModeActive}
          getLeave={getLeave}
          onAddShift={onAddShift}
          onClickShift={onClickShift}
          onEditShift={onEditShift}
          onExpandShift={onExpandShift}
          onAuditShift={onAuditShift}
          onUnpublishShift={onUnpublishShift}
          onAssign={onAssign}
          onMoveShift={onMoveShift}
        />
      ))}
    </div>
  );
});
EmployeeRowImpl.displayName = 'EmployeeRow';

const EmployeeRow = React.memo(EmployeeRowImpl);

/* ============================================================
   EMPLOYEE DATE CELL (memoized — one cell per (employee, date))
   ============================================================ */

interface EmployeeDateCellProps {
  employee: PeopleModeEmployee;
  date: Date;
  isLastCol: boolean;
  canEdit: boolean;
  isBulkMode: boolean;
  cardVariant: 'compact' | 'detailed';
  complianceMap?: Record<string, ComplianceInfo>;
  currentSelectedShifts: Set<string>;
  isDnDModeActive: boolean;
  getLeave: (employeeId: string, dateKey: string) => RawLeaveDay | undefined;
  onAddShift: (employee: PeopleModeEmployee, date: Date) => void;
  onClickShift: (shift: PeopleModeShift) => void;
  onEditShift: (shift: PeopleModeShift) => void;
  onExpandShift?: (shift: PeopleModeShift) => void;
  onAuditShift?: (shift: PeopleModeShift) => void;
  onUnpublishShift?: (shiftId: string) => void;
  onAssign: (shift: UnfilledShift, employeeId: string, dateKey: string) => void;
  onMoveShift?: (shiftId: string, targetEmployeeId: string, targetDate: string) => void;
}

const EmployeeDateCellImpl: React.FC<EmployeeDateCellProps> = ({
  employee,
  date,
  isLastCol,
  canEdit,
  isBulkMode,
  cardVariant,
  complianceMap,
  currentSelectedShifts,
  isDnDModeActive,
  getLeave,
  onAddShift,
  onClickShift,
  onEditShift,
  onExpandShift,
  onAuditShift,
  onUnpublishShift,
  onAssign,
  onMoveShift,
}) => {
  const dateKey = format(date, 'yyyy-MM-dd');
  const shifts = employee.shifts[dateKey] ?? [];
  const leave = getLeave(employee.id, dateKey);
  const datePast = isSydneyPast(date);
  /** Approved leave closes the day to rostering. */
  const closed = datePast || Boolean(leave);

  const holidayName = getPublicHolidayName(date);
  const isTodayDate = format(date, 'yyyy-MM-dd') === todayISO();

  const cellClassName = cn(
    'px-3 py-3 align-top relative group/cell transition-colors',
    !isLastCol && (holidayName ? 'border-r border-amber-500/20' : 'border-r border-border'),
    holidayName ? 'bg-amber-500/10 dark:bg-amber-500/15' : isTodayDate && 'bg-primary/5',
    canEdit && !isBulkMode && 'cursor-pointer',
  );

  const cellOnClick = useCallback(() => {
    if (canEdit && !isBulkMode && shifts.length === 0 && !closed) {
      onAddShift(employee, date);
    }
  }, [canEdit, isBulkMode, shifts.length, closed, onAddShift, employee, date]);

  const handleAddClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onAddShift(employee, date);
  }, [onAddShift, employee, date]);

  return (
    <DroppableDateCell
      active={isDnDModeActive}
      employeeId={employee.id}
      dateKey={dateKey}
      className={cellClassName}
      onClick={cellOnClick}
      onAssign={onAssign}
      onMove={onMoveShift}
    >
      <div className="space-y-2 min-h-[80px]">
        {leave && <LeaveDayCard leave={leave} hasConflictingShift={shifts.length > 0} />}

        {shifts.length > 0
          ? shifts.map((shift) => {
              const { isPast, isLocked: isManagementLocked } = resolveShiftStatus(shift);
              const isLocked = isManagementLocked || (isDnDModeActive && shift.lifecycleStatus !== 'draft');
              const rawShift = shift.rawShift;
              if (!rawShift) return null;

              return (
                <DraggableShiftCard
                  key={shift.id}
                  shift={shift}
                  employee={employee}
                  disabled={isManagementLocked}
                >
                   <SmartShiftCard
                    headerAction={
                      canEdit && !isBulkMode ? (
                        <ShiftRowMenu
                          shift={shift}
                          onEdit={onEditShift}
                          onExpand={onExpandShift}
                          onAudit={onAuditShift}
                          onUnpublish={onUnpublishShift}
                        />
                      ) : undefined
                    }
                    shift={rawShift}
                    variant={cardVariant}
                    groupColor={resolveGroupType(rawShift)}
                    compliance={complianceMap?.[shift.id]}
                    isSelected={currentSelectedShifts.has(shift.id)}
                    isLocked={isLocked}
                    isPast={isPast}
                    isDnDActive={isDnDModeActive}
                    showStatusIcons={true}
                    onClick={() => onClickShift(shift)}
                  />
                </DraggableShiftCard>
              );
            })
          : null}

        {!isBulkMode && canEdit && !closed && (
          <div
            className={cn(
              'absolute inset-0 flex pointer-events-none z-10',
              shifts.length > 0 ? 'items-end justify-end p-2' : 'items-center justify-center'
            )}
          >
            <RosterCellAddButton
              onClick={handleAddClick}
              hasShifts={shifts.length > 0}
              holidayName={holidayName}
              title={holidayName ? `Add Shift (${holidayName})` : "Add Shift"}
            />
          </div>
        )}

      </div>
    </DroppableDateCell>
  );
};

const EmployeeDateCell = React.memo(EmployeeDateCellImpl);
