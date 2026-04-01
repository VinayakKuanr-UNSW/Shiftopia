import React, { useState, useMemo } from 'react';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { format, addDays, startOfWeek, parse, isToday } from 'date-fns';
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
  ChevronRight
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { isSydneyPast } from '@/modules/core/lib/date.utils';
import { EnhancedAddShiftModal, ShiftContext } from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import { SmartShiftCard } from '@/modules/rosters/ui/components/SmartShiftCard';
import { useShiftsByDateRange, useRemunerationLevels, useRoles, useUnpublishShift } from '@/modules/rosters/state/useRosterShifts';
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
  selectedShiftIds?: string[];
  isBulkMode?: boolean;
  onToggleShiftSelection?: (shiftId: string) => void;
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
        'rounded-lg transition-all duration-200 h-full',
        isOver && canDrop  && 'ring-2 ring-emerald-500 ring-inset bg-emerald-500/5 shadow-lg',
        isOver && !canDrop && 'ring-2 ring-red-500 ring-inset opacity-60 bg-red-500/5',
      )}
    >
      {children}
    </div>
  );
};

const DraggableShiftCard: React.FC<{ 
  shift: Shift; 
  isDnDModeActive: boolean; 
  onEdit: (shift: Shift) => void; 
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
  isBulkMode: boolean;
  onAssignEmployee: (shiftId: string, employeeId: string, employeeName: string) => void;
}> = ({ shift, isDnDModeActive, onEdit, isSelected, onToggleSelection, isBulkMode, onAssignEmployee }) => {
  const { isPast, isLocked: isManagementLocked } = resolveShiftStatus(shift);
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

  const groupColor = resolveGroupType(shift);
  
  return (
    <div ref={drag} className={cn(isDragging && 'opacity-50')}>
      <DroppableShiftAssign
        shiftId={shift.id}
        shiftRole={shift.roles?.name || (shift as any).role_name || ''}
        canAccept={!isLocked && isDnDModeActive}
        onAssign={(id, item) => onAssignEmployee(id, item.employeeId, item.employeeName)}
      >
        <SmartShiftCard
          shift={{
            ...shift,
            roles: (shift as any).roles || { id: (shift as any).role_id || '', name: (shift as any).role_name || (shift as any).roles?.name || 'Shift' },
            assigned_profiles: (shift as any).assigned_profiles || (shift as any).profiles,
          } as any}
          onClick={() => isBulkMode ? onToggleSelection(shift.id) : onEdit(shift)}
          isDragging={isDragging}
          isLocked={isLocked}
          isPast={isPast}
          isDnDActive={isDnDModeActive}
          groupColor={groupColor}
          isSelected={isSelected}
        />
      </DroppableShiftAssign>
    </div>
  );
};

const DroppableRoleCell: React.FC<{ 
  date: string; 
  roleId: string; 
  roleName: string; 
  onMove: (shiftId: string, targetContext: any) => void; 
  onAssignUnfilled: (unfilled: UnfilledShift) => void; 
  isDnDModeActive: boolean;
  children: React.ReactNode; 
}> = ({ date, roleId, roleName, onMove, onAssignUnfilled, isDnDModeActive, children }) => {
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

  return (
    <td
      ref={drop}
      className={cn(
        'min-w-[200px] px-2 py-2 border-l border-b border-border align-top relative group/cell transition-all duration-300',
        isOver && canDrop && 'bg-emerald-500/10 ring-2 ring-emerald-500/50 ring-inset shadow-[inset_0_0_20px_rgba(16,185,129,0.2)] scale-[1.01] z-10',
        isOver && !canDrop && 'bg-red-500/10 ring-2 ring-red-500/50 ring-inset cursor-no-drop opacity-60'
      )}
    >
      {children}
    </td>
  );
};

export const RolesModeView: React.FC<RolesModeViewProps> = ({
  selectedDate,
  viewType,
  canEdit,
  organizationId,
  departmentIds = [],
  subDepartmentIds = [],
  rosterId,
  shifts: parentShifts,
  projection,
  onEditShift,
  onMoveShift,
  onAssignShift,
  selectedShiftIds: propsSelectedShiftIds,
  isBulkMode,
  onToggleShiftSelection,
}) => {
  const activeDeptId = departmentIds[0];
  const activeSubDeptId = subDepartmentIds[0];

  const { isDnDModeActive } = useRosterStore();

  const selectedShiftIds = propsSelectedShiftIds ?? [];

  const { data: levels = [], isLoading: isLoadingLevels } = useRemunerationLevels();
  const { data: roles = [], isLoading: isLoadingRoles } = useRoles(organizationId, activeDeptId, activeSubDeptId);

  const startDate = useMemo(() => {
    if (viewType === 'week') return format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    if (viewType === 'month') return format(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1), 'yyyy-MM-dd');
    return format(selectedDate, 'yyyy-MM-dd');
  }, [selectedDate, viewType]);

  const endDate = useMemo(() => {
    if (viewType === 'day') return startDate;
    if (viewType === 'week') return format(addDays(new Date(startDate), 6), 'yyyy-MM-dd');
    if (viewType === 'month') return format(addDays(addDays(new Date(startDate), 31), -1), 'yyyy-MM-dd');
    return format(addDays(new Date(startDate), viewType === '3day' ? 2 : 0), 'yyyy-MM-dd');
  }, [startDate, viewType]);

  const { data: internalShifts = [], isLoading: isLoadingShifts } = useShiftsByDateRange(
    projection ? null : (organizationId || null),
    startDate,
    endDate,
    { departmentIds, subDepartmentIds }
  );

  const activeShifts: Shift[] = parentShifts ?? internalShifts;
  const unpublishMutation = useUnpublishShift();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState<ShiftContext | null>(null);
  const [confirmShiftId, setConfirmShiftId] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [collapsedLevels, setCollapsedLevels] = useState<Set<number>>(new Set());

  const dates = useMemo(() => {
    const numDays = viewType === 'day' ? 1 : viewType === '3day' ? 3 : viewType === 'week' ? 7 : 31;
    return Array.from({ length: numDays }).map((_, i) => addDays(new Date(startDate), i));
  }, [startDate, viewType]);

  const levelGroups = useMemo((): LevelGroup[] => {
    const levelMap = new Map<string, { num: number; label: string }>(levels.map(l => [l.id, { num: l.level_number ?? 0, label: l.level_name || `Level ${l.level_number}` }]));
    const shiftsByRoleAndDate: Record<string, Record<string, Shift[]>> = {};
    
    if (projection) {
      projection.levels.forEach(l => l.roles.forEach(r => {
        if (!shiftsByRoleAndDate[r.id]) shiftsByRoleAndDate[r.id] = {};
        Object.entries(r.shiftsByDate).forEach(([d, pShifts]) => shiftsByRoleAndDate[r.id][d] = pShifts.map(ps => ps.raw));
      }));
      projection.unassignedRoles.forEach(r => {
        if (!shiftsByRoleAndDate[r.id]) shiftsByRoleAndDate[r.id] = {};
        Object.entries(r.shiftsByDate).forEach(([d, pShifts]) => shiftsByRoleAndDate[r.id][d] = pShifts.map(ps => ps.raw));
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
      const lInfo = r.remuneration_level_id ? levelMap.get(r.remuneration_level_id) : null;
      const ln = lInfo?.num ?? 0;
      if (!groups[ln]) groups[ln] = { levelNumber: ln, levelLabel: lInfo?.label || `Level ${ln}`, roles: [] };
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
    if (!confirmShiftId) return;
    try { await unpublishMutation.mutateAsync({ shiftId: confirmShiftId, reason: 'Unpublished via Roles view' }); } 
    catch {} finally { setIsConfirmOpen(false); setConfirmShiftId(null); }
  };

  const handleCellClick = (roleId: string, date: Date) => {
    if (!canEdit) return;
    setModalContext({
      mode: 'roles',
      launchSource: 'grid',
      date: format(date, 'yyyy-MM-dd'),
      organizationId,
      departmentId: activeDeptId,
      subDepartmentId: activeSubDeptId,
      roleId: roleId === 'unassigned' ? undefined : roleId,
      rosterId,
    });
    setIsModalOpen(true);
  };

  const isLoading = !projection && (isLoadingLevels || isLoadingRoles || isLoadingShifts);
  if (isLoading) return <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground gap-3"><Loader2 className="w-8 h-8 animate-spin" /><p className="text-sm font-medium tracking-wide">Loading roles…</p></div>;

  const totalHours = projection?.stats.totalNetMinutes != null ? (projection.stats.totalNetMinutes / 60).toFixed(1) : '—';
  const estCost = projection?.stats.estimatedCost ?? 0;

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      {isDnDModeActive && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-500">
          <Badge className="px-6 py-2 bg-emerald-500/90 text-white backdrop-blur-md border border-emerald-400/50 shadow-[0_0_20px_rgba(16,185,129,0.3)] flex items-center gap-2 text-sm font-medium rounded-full">
            <Zap className="h-4 w-4 animate-pulse" />
            DnD Mode Active
          </Badge>
        </div>
      )}

      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card/90 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-md bg-indigo-100 dark:bg-indigo-500/10"><Briefcase className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /></div>
          <div>
            <h2 className="text-[13px] font-bold text-foreground uppercase tracking-[0.08em]">Roles Mode</h2>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono tracking-[0.12em] mt-0.5">
              <span>Coverage per Role</span>
              {(activeSubDeptId || activeDeptId) && <span className="text-indigo-400/80 font-semibold">Filtered</span>}
              <span className="text-emerald-400/60">{totalHours}h · ${estCost.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto relative">
        <table className="border-collapse min-w-full">
          <thead>
            <tr className="bg-muted/30">
              <th className="sticky top-0 left-0 z-[40] w-64 min-w-[256px] px-4 py-3 text-left bg-muted/80 backdrop-blur-xl border-b border-r border-border shadow-[4px_0_8px_-4px_rgba(0,0,0,0.3)]">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] font-mono">Role Description</span>
              </th>
              {dates.map(date => (
                <th key={date.toISOString()} className={cn("sticky top-0 z-20 min-w-[200px] px-3 py-3 text-center border-b border-border bg-muted/30", format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') && "bg-primary/5")}>
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] font-mono text-muted-foreground">{format(date, 'EEE')}</div>
                  <div className="text-sm font-mono tabular-nums mt-0.5 text-muted-foreground/50">{format(date, 'MMM d')}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {levelGroups.map((group) => (
              <React.Fragment key={group.levelNumber}>
                <tr className="bg-indigo-500/10 border-y border-indigo-500/20">
                  <td colSpan={dates.length + 1} className="px-4 py-2 sticky left-0 z-30">
                    <div className="flex items-center gap-2">
                       <button onClick={() => toggleLevelCollapse(group.levelNumber)} className="p-1 hover:bg-white/10 rounded transition-colors">
                        {collapsedLevels.has(group.levelNumber) ? <ChevronRight className="w-4 h-4 text-indigo-400" /> : <ChevronDown className="w-4 h-4 text-indigo-400" />}
                      </button>
                      <span className="text-xs font-bold uppercase tracking-widest text-indigo-400 font-mono">
                        {group.levelLabel}
                      </span>
                      <Badge variant="outline" className="text-[10px] h-5 bg-indigo-500/5 border-indigo-500/20 text-indigo-300 px-2 font-mono">
                        {group.roles.length} Roles
                      </Badge>
                    </div>
                  </td>
                </tr>

                {!collapsedLevels.has(group.levelNumber) && group.roles.map((role, idx) => (
                  <tr key={role.id} className={cn("group transition-colors", idx % 2 === 0 ? "bg-card" : "bg-muted/30", "hover:bg-accent/30")}>
                    <td className="sticky left-0 z-20 w-64 min-w-[256px] px-4 py-3 align-middle border-r border-b border-border bg-card/80 backdrop-blur-md group-hover:bg-accent/40 transition-colors shadow-[4px_0_8px_-4px_rgba(0,0,0,0.3)]">
                      <span className="text-[13px] font-semibold text-foreground/80 group-hover:text-foreground transition-colors">{role.name}</span>
                    </td>
                    {dates.map(date => {
                      const dStr = format(date, 'yyyy-MM-dd');
                      const cellShifts = role.shiftsByDate[dStr] || [];
                      return (
                        <DroppableRoleCell key={`${role.id}-${dStr}`} date={dStr} roleId={role.id} roleName={role.name} onMove={onMoveShift || (() => {})} onAssignUnfilled={() => {}} isDnDModeActive={isDnDModeActive}>
                          <div className="flex flex-col gap-1 min-h-[52px]">
                            {cellShifts.map(s => (
                              <DraggableShiftCard 
                                key={s.id} 
                                shift={s} 
                                isDnDModeActive={isDnDModeActive} 
                                onEdit={sh => onEditShift?.(sh)} 
                                isSelected={selectedShiftIds.includes(s.id)}
                                onToggleSelection={onToggleShiftSelection || (() => {})}
                                isBulkMode={isBulkMode}
                                onAssignEmployee={onAssignShift || (() => {})}
                              />
                            ))}
                            {canEdit && !isBulkMode && !isShiftLocked(dStr, '23:59', 'roster_management') && (
                              <div className={cn("absolute inset-0 flex pointer-events-none z-10", cellShifts.length > 0 ? "items-end justify-end p-2" : "items-center justify-center")}>
                                <button onClick={() => handleCellClick(role.id, date)} className="flex items-center justify-center rounded-full transition-all duration-300 pointer-events-auto bg-primary/30 text-primary border border-primary/40 backdrop-blur-md hover:bg-primary/60 hover:scale-110 w-9 h-9 opacity-40 group-hover/cell:opacity-100"><Plus className="h-5 w-5" /></button>
                              </div>
                            )}
                          </div>
                        </DroppableRoleCell>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && <EnhancedAddShiftModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} context={modalContext} onSuccess={() => setIsModalOpen(false)} />}
      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader><AlertDialogTitle>Unpublish Shift</AlertDialogTitle><AlertDialogDescription>This shift will be reverted to Draft.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleConfirmUnpublish} className="bg-amber-600">Unpublish</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RolesModeView;
