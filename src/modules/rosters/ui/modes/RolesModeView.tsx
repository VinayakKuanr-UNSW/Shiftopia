import { PageState } from '@/modules/core/ui/components/PageState';
import React, { useState, useMemo } from 'react';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { format, addDays, parse, isToday } from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';
import { useDrag, useDrop } from 'react-dnd';
import { 
  Plus, 
  MoreHorizontal,
  Edit2,
  Undo2,
  Loader2,
  Briefcase,
  Zap,
  ChevronDown,
  ChevronRight,
  Trash2,
  ShieldCheck,
  Layers,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { isSydneyPast, todayISO } from '@/modules/core/lib/date.utils';
import { getPublicHolidayName } from '@/modules/core/lib/holidays';
import { formatCost } from '@/modules/rosters/domain/projections/utils/cost';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { useShiftFormNav } from '@/modules/rosters/hooks/useShiftFormNav';
import { SmartShiftCard } from '@/modules/rosters/ui/components/SmartShiftCard';
import { RosterEmptyState } from '@/modules/rosters/ui/components/RosterEmptyState';
import * as import_GroupSummaryCell from '@/modules/rosters/ui/components/GroupSummaryCell';
import { RosterCellAddButton } from '@/modules/rosters/ui/components/RosterCellAddButton';
import { useRemunerationLevels, useRoles, useUnpublishShift, useCreateShift, useDeleteShift } from '@/modules/rosters/state/useRosterShifts';
import { ShiftExpandDialog } from '@/modules/rosters/ui/dialogs/ShiftExpandDialog';
import { ShiftAuditDialog } from '@/modules/rosters/ui/dialogs/ShiftAuditDialog';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Shift } from '@/modules/rosters/api/shifts.api';
import { resolveGroupType, resolveShiftStatus } from '@/modules/rosters/utils/roster-utils';
import { 
  DND_SHIFT_TYPE, 
  DND_UNFILLED_SHIFT, 
  DND_EMPLOYEE_TYPE,
  type ShiftDragItem, 
  type EmployeeDragItem,
} from './people-mode.types';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { canDragShift, canDropOnTarget } from '@/modules/rosters/utils/dnd.utils';
import { UnfilledShift } from './UnfilledShiftsPanel';
import type { RolesProjection } from '@/modules/rosters/domain/projections/types';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
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


// Month view is bounded to the selected month ± this many days (calendar
// continuity buffer). Matches RostersPlannerPage / GroupModeView.
const MONTH_BUFFER_DAYS = 3;

interface RolesModeViewProps {
  selectedDate: Date;
  viewType: 'day' | '3day' | 'week' | 'month';
  canEdit: boolean;
  organizationId?: string;
  departmentIds?: string[];
  subDepartmentIds?: string[];
  rosterId?: string;
  shifts?: Shift[];
  projection?: RolesProjection;
  onEditShift?: (shift: any) => void;
  onMoveShift?: (shiftId: string, targetContext: any) => void;
  onAssignShift?: (shiftId: string, employeeId: string, employeeName: string) => void;
  selectedV8ShiftIds?: string[];
  isBulkMode?: boolean;
  onToggleShiftSelection?: (shiftId: string) => void;
  /** Phase-3: pre-aggregated server-side summary map for month view */
  summaryData?: Map<string, import('@/modules/rosters/api/rosterSummary.queries').RosterSummaryCellDTO>;
  /** Callback to open drill-down panel */
  onDrillDown?: (date: string, groupType: string, subGroupName?: string) => void;
}

interface FlatRole {
  id: string;
  name: string;
  shiftsByDate: Record<string, Shift[]>;
}

interface LevelGroup {
  levelNumber: number;
  levelLabel: string;
  roles: FlatRole[];
}

/**
 * Droppable wrapper for shift assignment via employee drag
 */
interface DroppableShiftAssignProps {
  shiftId: string;
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
        'rounded-lg transition-[box-shadow,background-color,ring-color] duration-200 h-full',
        isOver && canDrop  && 'ring-2 ring-emerald-500 ring-inset bg-emerald-500/5 shadow-lg',
        isOver && !canDrop && 'ring-2 ring-red-500 ring-inset opacity-60 bg-red-500/5',
      )}
    >
      {children}
    </div>
  );
};

interface RoleShiftCardProps {
  shift: Shift;
  isDnDModeActive: boolean;
  onEdit: (shift: Shift) => void;
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
  isBulkMode: boolean;
  onAssignEmployee: (shiftId: string, employeeId: string, employeeName: string) => void;
  headerAction?: React.ReactNode;
  detailedCost?: import('@/modules/rosters/domain/projections/utils/cost/types').ShiftCostBreakdown;
}

// Shared presentational card — identical output whether or not DnD is wired up.
const RoleShiftCardView: React.FC<RoleShiftCardProps & { isDragging?: boolean }> = ({
  shift, isDnDModeActive, onEdit, isSelected, onToggleSelection, isBulkMode, headerAction, detailedCost, isDragging,
}) => {
  const { isPast, isLocked: isManagementLocked } = resolveShiftStatus(shift);
  const isLocked = isManagementLocked || (isDnDModeActive && shift.lifecycle_status !== 'Published');
  return (
    <SmartShiftCard
      shift={{
        ...shift,
        roles: (shift as any).roles || { id: (shift as any).role_id || '', name: (shift as any).role_name || (shift as any).roles?.name || 'Shift' },
        assigned_profiles: (shift as any).assigned_profiles || (shift as any).profiles,
      } as any}
      onClick={() => isBulkMode ? onToggleSelection(shift.id) : isPast ? undefined : onEdit(shift)}
      isDragging={isDragging}
      isLocked={isLocked}
      isPast={isPast}
      isDnDActive={isDnDModeActive}
      showStatusIcons={true}
      groupColor={resolveGroupType(shift)}
      isSelected={isSelected}
      headerAction={headerAction}
      detailedCost={detailedCost}
    />
  );
};

const DraggableShiftCardActive: React.FC<RoleShiftCardProps> = (props) => {
  const { shift, isDnDModeActive, onAssignEmployee } = props;
  const { isLocked: isManagementLocked } = resolveShiftStatus(shift);
  const isLocked = isManagementLocked || (isDnDModeActive && shift.lifecycle_status !== 'Published');

  const [{ isDragging }, drag] = useDrag({
    type: DND_SHIFT_TYPE,
    item: (): ShiftDragItem => ({
      shiftId: shift.id,
      sourceGroupType: (shift as any).group_type || 'unassigned',
      sourceSubGroup: (shift as any).sub_group_name || 'Unassigned',
      shiftDate: shift.shift_date,
      startTime: shift.start_time,
      endTime: shift.end_time,
      lifecycle_status: shift.lifecycle_status as any,
      is_cancelled: shift.is_cancelled || false,
    }),
    canDrag: () => canDragShift(shift, isDnDModeActive) && !isManagementLocked,
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }, [shift, isDnDModeActive, isManagementLocked]);

  return (
    <div ref={drag} className={cn(isDragging && 'opacity-50')}>
      <DroppableShiftAssign
        shiftId={shift.id}
        shiftRole={shift.roles?.name || (shift as any).role_name || ''}
        canAccept={!isLocked && isDnDModeActive}
        onAssign={(id, item) => onAssignEmployee(id, item.employeeId, item.employeeName)}
      >
        <RoleShiftCardView {...props} isDragging={isDragging} />
      </DroppableShiftAssign>
    </div>
  );
};

// Gate: only wire useDrag + the employee drop target when DnD mode is on.
const DraggableShiftCard: React.FC<RoleShiftCardProps> = (props) => {
  if (!props.isDnDModeActive) return <RoleShiftCardView {...props} />;
  return <DraggableShiftCardActive {...props} />;
};

interface DroppableRoleCellProps {
  date: string;
  roleId: string;
  roleName: string;
  onMove: (shiftId: string, targetContext: any) => void;
  onAssignUnfilled: (unfilled: UnfilledShift) => void;
  isDnDModeActive: boolean;
  hasShifts?: boolean;
  children: React.ReactNode;
}

// Base cell class shared by the active (droppable) and inert variants so the
// table column widths/borders are identical whether or not DnD is registered.
const ROLE_CELL_BASE_CLASS = 'min-w-[180px] px-3 py-3 border-r border-b border-border relative group/cell transition-colors h-full';

const DroppableRoleCellActive: React.FC<DroppableRoleCellProps> = ({ date, roleId, roleName, onMove, onAssignUnfilled, isDnDModeActive, hasShifts = false, children }) => {
  const [{ isOver, canDrop }, drop] = useDrop({
    accept: [DND_SHIFT_TYPE, DND_UNFILLED_SHIFT],
    canDrop: (item: any) => {
      // Logic for locking:
      // 1. DND Mode must be active
      // 2. Target date must not be fully in the past (handled by isSydneyPast if we want to block whole days)
      // 3. For the specific shift's timing, it must not be locked on the target date.
      const targetIsPastDay = isSydneyPast(parse(date, 'yyyy-MM-dd', new Date())) && !isToday(parse(date, 'yyyy-MM-dd', new Date()));
      
      let isStrictlyLocked = targetIsPastDay;
      if (!isStrictlyLocked && item.startTime) {
        // If it's today, check if the shift would have already started
        isStrictlyLocked = isShiftLocked(date, item.startTime, 'roster_management');
      }

      return canDropOnTarget(isDnDModeActive, item, { isPast: isStrictlyLocked });
    },
    drop: (item: any, monitor) => {
      const type = monitor.getItemType();
      if (type === DND_SHIFT_TYPE) {
        onMove(item.shiftId, { roleId, roleName, shiftDate: date });
      } else if (type === DND_UNFILLED_SHIFT) {
        onAssignUnfilled(item);
      }
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
      canDrop: !!monitor.canDrop(),
    }),
  }, [date, roleId, roleName, onMove, isDnDModeActive]);

  const parsedDate = parse(date, 'yyyy-MM-dd', new Date());
  const holidayName = getPublicHolidayName(parsedDate);
  const isTodayDate = format(parsedDate, 'yyyy-MM-dd') === todayISO();

  return (
    <td
      ref={drop}
      className={cn(
        ROLE_CELL_BASE_CLASS,
        hasShifts ? 'align-top' : 'align-middle',
        holidayName ? 'bg-amber-500/10 dark:bg-amber-500/15 border-r-amber-500/20' : isTodayDate && 'bg-primary/5',
        isOver && canDrop && 'bg-emerald-500/10 ring-2 ring-emerald-500/50 ring-inset scale-[1.01] z-10',
        isOver && !canDrop && 'bg-red-500/10 ring-2 ring-red-500/50 ring-inset cursor-no-drop opacity-60'
      )}
    >
      {children}
    </td>
  );
};

// Gate: register the useDrop target only when DnD mode is on. Otherwise render
// an inert <td> — avoids a useDrop per (role, date) cell in week/month tables.
const DroppableRoleCell: React.FC<DroppableRoleCellProps> = (props) => {
  if (!props.isDnDModeActive) {
    const parsedDate = parse(props.date, 'yyyy-MM-dd', new Date());
    const holidayName = getPublicHolidayName(parsedDate);
    const isTodayDate = format(parsedDate, 'yyyy-MM-dd') === todayISO();
    return (
      <td className={cn(
        ROLE_CELL_BASE_CLASS,
        props.hasShifts ? 'align-top' : 'align-middle',
        holidayName ? 'bg-amber-500/10 dark:bg-amber-500/15 border-r-amber-500/20' : isTodayDate && 'bg-primary/5'
      )}>
        {props.children}
      </td>
    );
  }
  return <DroppableRoleCellActive {...props} />;
};

export const RolesModeView: React.FC<RolesModeViewProps> = ({ 
  selectedDate, viewType, canEdit, organizationId, departmentIds = [], subDepartmentIds = [], rosterId, shifts: parentShifts, projection, onEditShift, onMoveShift, onAssignShift, selectedV8ShiftIds: propsSelectedV8ShiftIds, isBulkMode, onToggleShiftSelection, summaryData, onDrillDown 
}) => {
  const { toast } = useToast();
  const createShiftMutation = useCreateShift();
  const activeDeptId = departmentIds[0];
  const activeSubDeptId = subDepartmentIds[0];

  const isDnDModeActive = useRosterStore(s => s.isDnDModeActive);



  const selectedV8ShiftIds = propsSelectedV8ShiftIds ?? [];
  // O(1) lookup for per-card selection check
  const selectedV8ShiftIdsSet = useMemo(
    () => new Set(selectedV8ShiftIds),
    [selectedV8ShiftIds],
  );

  const { data: levels = [], isLoading: isLoadingLevels } = useRemunerationLevels();
  const { data: roles = [], isLoading: isLoadingRoles } = useRoles(organizationId, activeDeptId, activeSubDeptId);

  const startDate = useMemo(() => {
    if (viewType === 'week') return format(startOfWeekAU(selectedDate), 'yyyy-MM-dd');
    // Month: first of month minus the buffer (calendar continuity + matches fetch).
    if (viewType === 'month') return format(addDays(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1), -MONTH_BUFFER_DAYS), 'yyyy-MM-dd');
    return format(selectedDate, 'yyyy-MM-dd');
  }, [selectedDate, viewType]);

  const endDate = useMemo(() => {
    if (viewType === 'day') return startDate;
    if (viewType === 'week') return format(addDays(new Date(startDate), 6), 'yyyy-MM-dd');
    // Month: last of month plus the buffer — bounds columns to ~36 rather than a fixed 31.
    if (viewType === 'month') return format(addDays(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0), MONTH_BUFFER_DAYS), 'yyyy-MM-dd');
    return format(addDays(new Date(startDate), viewType === '3day' ? 2 : 0), 'yyyy-MM-dd');
  }, [startDate, selectedDate, viewType]);

  // The planner owns the shifts query and always passes the result down. A
  // second query here used a different cache key (raw [] filters vs the
  // planner's undefined), so it fired its own request whose data was never
  // read, and held a competing spinner over the planner's loading overlay.
  const activeShifts: Shift[] = parentShifts ?? [];
  const unpublishMutation = useUnpublishShift();

  const openShiftForm = useShiftFormNav();
  const [confirmV8ShiftId, setConfirmV8ShiftId] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [expandedShift, setExpandedShift] = useState<Shift | null>(null);
  const [auditedShift, setAuditedShift] = useState<Shift | null>(null);
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const deleteShiftMutation = useDeleteShift();
  const [collapsedLevels, setCollapsedLevels] = useState<Set<number>>(new Set());


  const handleCloneShift = async (shift: Shift) => {
    try {
      const cloneData: any = {
        roster_id: shift.roster_id,
        department_id: shift.department_id,
        sub_department_id: shift.sub_department_id,
        shift_date: shift.shift_date,
        start_time: shift.start_time,
        end_time: shift.end_time,
        organization_id: shift.organization_id,
        group_type: (shift as any).group_type,
        sub_group_name: (shift as any).sub_group_name,
        shift_group_id: (shift as any).shift_group_id,
        shift_subgroup_id: (shift as any).shift_subgroup_id || (shift as any).roster_subgroup_id,
        role_id: shift.role_id,
        remuneration_level: shift.remuneration_level,
        paid_break_minutes: shift.paid_break_minutes,
        unpaid_break_minutes: shift.unpaid_break_minutes,
        timezone: shift.timezone,
        required_skills: shift.required_skills || [],
        required_licenses: shift.required_licenses || [],
        event_ids: shift.event_ids || [],
        tags: shift.tags || [],
        notes: shift.notes,
        is_training: shift.is_training,
        // Mandatory on every shift — without it every Clone failed with
        // "target_employment_type is required" (fn_shift_inherit_template_row).
        target_employment_type: (shift as any).target_employment_type,
        target_requires_flexible: (shift as any).target_requires_flexible,
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

  const handleDeleteShift = async (shift: any) => {
    try {
      await deleteShiftMutation.mutateAsync({
        shiftId: shift.id,
        expectedVersion: shift.version,
      });
      toast({
        title: 'Shift Deleted',
        description: 'The shift has been removed.',
      });
    } catch (error: any) {
      toast({
        title: 'Delete Failed',
        description: error.message || 'Could not delete shift.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setShiftToDelete(null);
    }
  };

  const buildShiftMenu = (shift: any) => {
    const { isPast } = resolveShiftStatus(shift);

    return (
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
          {/* 1. Clone */}
          <DropdownMenuItem
            disabled={isPast}
            onClick={() => handleCloneShift(shift)}
            className={cn(
              "text-popover-foreground hover:bg-accent cursor-pointer",
              isPast && "text-muted-foreground/50 cursor-not-allowed"
            )}
          >
            <Plus className="h-4 w-4 mr-2" />
            Clone Shift {isPast && '(Locked)'}
          </DropdownMenuItem>

          {/* 2. Edit */}
          <DropdownMenuItem
            disabled={isPast}
            onClick={() => onEditShift?.(shift)}
            className={cn(
              "text-popover-foreground hover:bg-accent cursor-pointer",
              isPast && "text-muted-foreground/50 cursor-not-allowed"
            )}
          >
            <Edit2 className="h-4 w-4 mr-2" />
            Edit Shift {isPast && '(Locked)'}
          </DropdownMenuItem>

          {/* 3. Audit */}
          <DropdownMenuItem
            onClick={() => setAuditedShift(shift)}
            className="text-popover-foreground hover:bg-accent cursor-pointer"
          >
            <ShieldCheck className="h-4 w-4 mr-2 text-indigo-500" />
            Audit Compliance
          </DropdownMenuItem>

          {/* 4. More: Scheduled vs Actual vs Billable & Variance */}
          <DropdownMenuItem
            onClick={() => setExpandedShift(shift)}
            className="text-popover-foreground hover:bg-accent cursor-pointer"
          >
            <Layers className="h-4 w-4 mr-2 text-cyan-500" />
            More (Variance & Pay)
          </DropdownMenuItem>

          {shift.lifecycle_status === 'Published' && !isPast && (
            <DropdownMenuItem
              onClick={() => {
                setConfirmV8ShiftId(shift.id);
                setIsConfirmOpen(true);
              }}
              className="text-amber-400 hover:bg-amber-500/10 cursor-pointer"
            >
              <Undo2 className="h-4 w-4 mr-2" />
              Unpublish Shift
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator className="bg-border" />

          {/* 5. Delete */}
          <DropdownMenuItem
            disabled={isPast}
            onClick={() => {
              setShiftToDelete(shift);
              setIsDeleteDialogOpen(true);
            }}
            className={cn(
              "text-destructive hover:bg-destructive/10 cursor-pointer",
              isPast && "text-muted-foreground/50 cursor-not-allowed"
            )}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Shift {isPast && '(Locked)'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const dates = useMemo(() => {
    // Derive the column count from the actual start/end window (month is now
    // bounded to month ± buffer, so it's no longer a fixed 31).
    const start = new Date(startDate);
    const end = new Date(endDate);
    const numDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
    return Array.from({ length: numDays }).map((_, i) => addDays(start, i));
  }, [startDate, endDate]);

  const levelGroups = useMemo((): LevelGroup[] => {
    const shiftsByRoleAndDate: Record<string, Record<string, Shift[]>> = {};
    
    if (projection) {
      projection.levels.forEach(l => l.roles.forEach(r => {
        if (!shiftsByRoleAndDate[r.id]) shiftsByRoleAndDate[r.id] = {};
        Object.entries(r.shiftsByDate).forEach(([d, pShifts]) => shiftsByRoleAndDate[r.id][d] = pShifts.map(ps => ({
          ...ps.raw,
          detailedCost: ps.detailedCost
        })));
      }));
      projection.unassignedRoles.forEach(r => {
        if (!shiftsByRoleAndDate[r.id]) shiftsByRoleAndDate[r.id] = {};
        Object.entries(r.shiftsByDate).forEach(([d, pShifts]) => shiftsByRoleAndDate[r.id][d] = pShifts.map(ps => ({
          ...ps.raw,
          detailedCost: ps.detailedCost
        })));
      });
    } else {
      activeShifts.forEach(shift => {
        const roleId = shift.role_id || 'unassigned';
        const d = shift.shift_date;
        if (!shiftsByRoleAndDate[roleId]) shiftsByRoleAndDate[roleId] = {};
        if (!shiftsByRoleAndDate[roleId][d]) shiftsByRoleAndDate[roleId][d] = [];
        shiftsByRoleAndDate[roleId][d].push(shift);
      });
    }

    const groups: Record<number, LevelGroup> = {};
    for (let i = 0; i <= 7; i++) {
      groups[i] = { levelNumber: i, levelLabel: `Level ${i}`, roles: [] };
    }

    roles.forEach(r => {
      const ln = (r as any).remuneration_level ?? 0;
      const lInfo = levels.find(l => l.level_number === ln);
      if (!groups[ln]) groups[ln] = { levelNumber: ln, levelLabel: lInfo?.level_name || `Level ${ln}`, roles: [] };
      groups[ln].roles.push({
        id: r.id,
        name: r.name,
        shiftsByDate: shiftsByRoleAndDate[r.id] || {},
      });
    });

    return Object.values(groups).sort((a, b) => b.levelNumber - a.levelNumber);
  }, [projection, activeShifts, roles, levels]);

  const toggleLevelCollapse = (lvl: number) => {
    const next = new Set(collapsedLevels);
    if (next.has(lvl)) next.delete(lvl);
    else next.add(lvl);
    setCollapsedLevels(next);
  };

  const handleConfirmUnpublish = async () => {
    if (!confirmV8ShiftId) return;
    try { await unpublishMutation.mutateAsync({ shiftId: confirmV8ShiftId, reason: 'Unpublished via Roles view' }); } 
    catch {} finally { setIsConfirmOpen(false); setConfirmV8ShiftId(null); }
  };

  const handleCellClick = (roleId: string, date: Date) => {
    if (!canEdit || isSydneyPast(date)) return;
    openShiftForm({
      context: {
        mode: 'roles',
        launchSource: 'grid',
        date: format(date, 'yyyy-MM-dd'),
        organizationId,
        departmentId: activeDeptId,
        subDepartmentId: activeSubDeptId,
        roleId: roleId === 'unassigned' ? undefined : roleId,
        rosterId,
      },
    });
  };

  const isLoading = !projection && (isLoadingLevels || isLoadingRoles);
  if (isLoading) return <PageState state="loading" className="h-[400px]" title="Loading roles" />;

  const totalHours = projection?.stats?.totalNetMinutes != null ? (projection.stats.totalNetMinutes / 60).toFixed(1) : '—';
  const estCost = projection?.stats?.estimatedCost ?? 0;

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      {isDnDModeActive && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <Badge className="px-4 py-1.5 bg-emerald-600 text-white border border-emerald-500/40 shadow-sm flex items-center gap-2 text-[11px] font-semibold rounded-full">
            <Zap className="h-3.5 w-3.5" />
            DnD Mode Active
          </Badge>
        </div>
      )}

      {/* Grid Container — Grid is the container itself */}
      <div className="flex-1 min-h-0 overflow-auto relative custom-scrollbar bg-background">
        <table className="border-collapse min-w-full">
              <thead>
                <tr className="bg-muted/80 backdrop-blur-md dark:bg-muted/40 border-b border-border">
                  <th className="sticky top-0 left-0 z-[30] w-[240px] min-w-[240px] px-3 py-2 text-left bg-muted/90 backdrop-blur-md dark:bg-muted/50 border-b border-r border-border shadow-[2px_0_6px_-2px_rgba(0,0,0,0.1)]">
                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.14em] font-mono">Role Description</span>
                  </th>
                  {dates.map(date => {
                    const holidayName = getPublicHolidayName(date);
                    const isToday = format(date, 'yyyy-MM-dd') === todayISO();
                    return (
                      <th key={date.toISOString()} data-today={isToday ? "true" : undefined} className={cn("sticky top-0 z-20 min-w-[180px] px-3 py-2.5 text-center transition-colors bg-muted/80 backdrop-blur-md dark:bg-muted/40", holidayName ? "bg-amber-500/10 dark:bg-amber-500/15 border-b-0" : "border-b border-border", isToday && "bg-primary/5")}>
                        <div className={cn("text-[11px] font-bold uppercase tracking-[0.12em] font-mono leading-tight", holidayName ? "text-amber-400 font-extrabold" : isToday ? "text-primary font-bold" : "text-muted-foreground")}>{format(date, 'EEE')}</div>
                        <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
                          <span className={cn("text-[13px] font-mono tabular-nums leading-none", holidayName ? "text-amber-300 font-bold" : isToday ? "text-primary font-bold" : "text-muted-foreground/60 font-medium")}>{format(date, 'MMM d')}</span>
                          {holidayName && (
                            <span className="text-[11px] italic font-normal text-amber-400 dark:text-amber-300 truncate max-w-[140px]" title={`ANZ Public Holiday: ${holidayName}`}>
                              {holidayName}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
          {levelGroups.map((group) => (
            <tbody
              key={group.levelNumber}
              style={{ contentVisibility: 'auto' as any, containIntrinsicSize: 'auto 500px' }}
            >
              <tr className="bg-indigo-500/10 border-y border-indigo-500/20">
                <td colSpan={dates.length + 1} className="px-4 py-2 sticky left-0 z-30">
                  <div className="flex items-center gap-2">
                     <button
                      onClick={() => toggleLevelCollapse(group.levelNumber)}
                      className="p-1 hover:bg-white/10 rounded transition-colors"
                      aria-label={collapsedLevels.has(group.levelNumber) ? `Expand ${group.levelLabel}` : `Collapse ${group.levelLabel}`}
                    >
                      {collapsedLevels.has(group.levelNumber) ? <ChevronRight className="w-4 h-4 text-indigo-400" /> : <ChevronDown className="w-4 h-4 text-indigo-400" />}
                    </button>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 font-mono">
                      {group.levelLabel}
                    </span>
                    <Badge variant="outline" className="text-[11px] font-bold font-mono h-5 bg-indigo-500/10 border-indigo-500/30 text-indigo-300 px-2">
                      {group.roles.length} Roles
                    </Badge>
                  </div>
                </td>
              </tr>

              {!collapsedLevels.has(group.levelNumber) && group.roles.map((role, idx) => (
                <tr key={role.id} className={cn("group transition-colors", idx % 2 === 0 ? "bg-card" : "bg-muted/20", "hover:bg-muted/40")}>
                  <td className="sticky left-0 z-20 w-[240px] min-w-[240px] px-4 py-3 align-middle border-r border-b border-border bg-card/90 backdrop-blur-md group-hover:bg-accent/40 transition-colors shadow-[2px_0_6px_-2px_rgba(0,0,0,0.1)]">
                    <span className="text-[13px] font-semibold text-foreground/90 group-hover:text-foreground transition-colors">{role.name}</span>
                  </td>
                  {dates.map(date => {
                    const dStr = format(date, 'yyyy-MM-dd');
                    const holidayName = getPublicHolidayName(date);
                    const rawCellShifts = role.shiftsByDate[dStr] || [];
                    const cellShifts = [...rawCellShifts].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
                    return (
                      <DroppableRoleCell key={`${role.id}-${dStr}`} date={dStr} roleId={role.id} roleName={role.name} onMove={onMoveShift || (() => {})} onAssignUnfilled={() => {}} isDnDModeActive={isDnDModeActive} hasShifts={cellShifts.length > 0}>
                        <div className={cn("flex flex-col gap-1 min-h-[80px] h-full relative", cellShifts.length === 0 && "justify-center items-center")}>
                          {cellShifts.map(s => (
                            <DraggableShiftCard
                              key={s.id}
                              shift={s}
                              isDnDModeActive={isDnDModeActive}
                              onEdit={sh => onEditShift?.(sh)}
                              isSelected={selectedV8ShiftIdsSet.has(s.id)}
                              onToggleSelection={onToggleShiftSelection || (() => {})}
                              isBulkMode={isBulkMode ?? false}
                              onAssignEmployee={onAssignShift || (() => {})}
                              headerAction={buildShiftMenu(s)}
                              detailedCost={(s as any).detailedCost}
                            />
                          ))}
                          {/* For cells WITH shifts: Reserved row with + at the bottom right */}
                          {canEdit && !isBulkMode && !isSydneyPast(date) && cellShifts.length > 0 && (
                            <div className="flex items-center justify-end w-full pt-1 mt-auto">
                              <RosterCellAddButton
                                onClick={(e) => {
                                  e?.stopPropagation();
                                  handleCellClick(role.id, date);
                                }}
                                hasShifts={true}
                                holidayName={holidayName}
                                title={holidayName ? `Add Shift (${holidayName})` : "Add Shift"}
                              />
                            </div>
                          )}

                          {/* For EMPTY cells: Centered add button */}
                          {canEdit && !isBulkMode && !isSydneyPast(date) && cellShifts.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                              <RosterCellAddButton
                                onClick={() => handleCellClick(role.id, date)}
                                hasShifts={false}
                                holidayName={holidayName}
                                title={holidayName ? `Add Shift (${holidayName})` : "Add Shift"}
                              />
                            </div>
                          )}
                        </div>
                      </DroppableRoleCell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        {roles.length === 0 && (
          <div className="p-12 flex items-center justify-center">
            <RosterEmptyState
              icon={Briefcase}
              title="No roles found"
              description="No roles have been configured or assigned for this department."
            />
          </div>
        )}
      </div>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Unpublish Shift</AlertDialogTitle><AlertDialogDescription>This shift will be reverted to Draft.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleConfirmUnpublish} className="bg-amber-600">Unpublish</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete Shift</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete this shift? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShiftToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => shiftToDelete && handleDeleteShift(shiftToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShiftExpandDialog shift={expandedShift} onOpenChange={(o) => { if (!o) setExpandedShift(null); }} />
      <ShiftAuditDialog shift={auditedShift} onOpenChange={(o) => { if (!o) setAuditedShift(null); }} />
    </div>
  );
};

export default RolesModeView;
