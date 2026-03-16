import React, { useState, useMemo, useEffect } from 'react';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { Plus, Briefcase, Loader2, MoreHorizontal, Undo2, Edit2 } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { format, addDays, startOfWeek } from 'date-fns';
import { isSydneyPast } from '@/modules/core/lib/date.utils';
import { EnhancedAddShiftModal, ShiftContext } from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import { ShiftCardCompact } from '@/modules/rosters/ui/components/ShiftCardCompact';
import { BulkActionsToolbar } from '@/modules/rosters/ui/components/BulkActionsToolbar';
import { useShiftsByDateRange, useRemunerationLevels, useBulkDeleteShifts, useBulkPublishShifts, useRoles, useUnpublishShift } from '@/modules/rosters/state/useRosterShifts';
import { Shift } from '@/modules/rosters/api/shifts.api';
import { toast } from 'sonner';
import type { RolesProjection } from '@/modules/rosters/domain/projections/types';
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
  selectedShiftIds?: string[];
}

// ── canUnpublish — any Published shift can be unpublished (→ S1 or S2) ───────
function canUnpublish(shift: Shift): boolean {
  return shift.lifecycle_status === 'Published';
}

// Flat render structure — one row per role
interface FlatRole {
  id: string;
  name: string;
  levelLabel: string;
  levelNumber: number;
  shiftsByDate: Record<string, Shift[]>;
}

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
  selectedShiftIds: propsSelectedShiftIds,
}) => {
  // ==================== HOOKS ====================
  const activeDeptId = departmentIds[0];
  const activeSubDeptId = subDepartmentIds[0];

  const {
    bulkModeActive,
    selectedShiftIds: globalSelectedShiftIds,
    toggleShiftSelection,
    clearSelection,
  } = useRosterUI();

  const selectedShiftIds = propsSelectedShiftIds ?? globalSelectedShiftIds;
  const isBulkMode = bulkModeActive;

  const { data: levels = [], isLoading: isLoadingLevels } = useRemunerationLevels();
  const { data: roles = [], isLoading: isLoadingRoles } = useRoles(organizationId, activeDeptId, activeSubDeptId);

  const startDate = useMemo(() => {
    if (viewType === 'week') return format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    if (viewType === 'month') return format(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1), 'yyyy-MM-dd');
    return format(selectedDate, 'yyyy-MM-dd');
  }, [selectedDate, viewType]);

  const endDate = useMemo(() => {
    if (viewType === 'day') return startDate;
    if (viewType === '3day') return format(addDays(new Date(startDate), 2), 'yyyy-MM-dd');
    if (viewType === 'week') return format(addDays(new Date(startDate), 6), 'yyyy-MM-dd');
    if (viewType === 'month') return format(addDays(addDays(new Date(startDate), 31), -1), 'yyyy-MM-dd');
    return startDate;
  }, [startDate, viewType]);

  const { data: internalShifts = [], isLoading: isLoadingShifts } = useShiftsByDateRange(
    projection ? null : (organizationId || null),
    startDate,
    endDate,
    { departmentIds, subDepartmentIds }
  );

  const activeShifts: Shift[] = parentShifts ?? internalShifts;

  const bulkDelete = useBulkDeleteShifts();
  const bulkPublish = useBulkPublishShifts();
  const unpublishMutation = useUnpublishShift();

  // ==================== STATE ====================
  // Bulk state removed in favor of centralized store
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState<ShiftContext | null>(null);
  const [confirmShiftId, setConfirmShiftId] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // ==================== DERIVED ====================
  const dates = useMemo(() => {
    const numDays = viewType === 'day' ? 1 : viewType === '3day' ? 3 : viewType === 'week' ? 7 : 31;
    return Array.from({ length: numDays }).map((_, i) => addDays(new Date(startDate), i));
  }, [startDate, viewType]);

  // Flat, deduplicated role list
  const flatRoles = useMemo((): FlatRole[] => {
    const levelNumById = new Map<string, number>(
      levels.map(l => [l.id, l.level_number ?? 0])
    );
    const levelNameById = new Map<string, string>(
      levels.map(l => [l.id, l.level_name ?? ''])
    );

    if (projection) {
      const seen = new Set<string>();
      const result: FlatRole[] = [];

      for (const pl of projection.levels) {
        for (const pr of pl.roles) {
          if (seen.has(pr.id)) continue;
          seen.add(pr.id);
          result.push({
            id: pr.id,
            name: pr.name,
            levelLabel: `Level-${pl.levelNumber}`,
            levelNumber: pl.levelNumber,
            shiftsByDate: Object.fromEntries(
              Object.entries(pr.shiftsByDate).map(([d, pShifts]) => [d, pShifts.map(ps => ps.raw)])
            ),
          });
        }
      }
      for (const pr of projection.unassignedRoles) {
        if (seen.has(pr.id)) continue;
        seen.add(pr.id);
        result.push({
          id: pr.id,
          name: pr.name,
          levelLabel: '',
          levelNumber: -1,
          shiftsByDate: Object.fromEntries(
            Object.entries(pr.shiftsByDate).map(([d, pShifts]) => [d, pShifts.map(ps => ps.raw)])
          ),
        });
      }

      result.sort((a, b) => b.levelNumber - a.levelNumber || a.name.localeCompare(b.name));
      return result;
    }

    // Legacy fallback
    const shiftsByRoleAndDate: Record<string, Record<string, Shift[]>> = {};
    activeShifts.forEach(shift => {
      const roleId = shift.role_id || 'unassigned';
      const date = shift.shift_date;
      if (!shiftsByRoleAndDate[roleId]) shiftsByRoleAndDate[roleId] = {};
      if (!shiftsByRoleAndDate[roleId][date]) shiftsByRoleAndDate[roleId][date] = [];
      shiftsByRoleAndDate[roleId][date].push(shift);
    });

    const result: FlatRole[] = roles.map(r => {
      const ln = r.remuneration_level_id ? (levelNumById.get(r.remuneration_level_id) ?? -1) : -1;
      return {
        id: r.id,
        name: r.name,
        levelLabel: ln >= 0 ? `Level-${ln}` : '',
        levelNumber: ln,
        shiftsByDate: shiftsByRoleAndDate[r.id] || {},
      };
    });

    result.sort((a, b) => b.levelNumber - a.levelNumber || a.name.localeCompare(b.name));
    return result;
  }, [projection, activeShifts, roles, levels]);

  // ==================== HANDLERS ====================
  const handleRequestUnpublish = (shiftId: string) => {
    setConfirmShiftId(shiftId);
    setIsConfirmOpen(true);
  };

  const handleConfirmUnpublish = async () => {
    if (!confirmShiftId) return;
    try {
      await unpublishMutation.mutateAsync({ shiftId: confirmShiftId, reason: 'Unpublished via Roles view' });
    } catch {
      // mutation onError handles rollback
    } finally {
      setIsConfirmOpen(false);
      setConfirmShiftId(null);
    }
  };

  const buildShiftMenu = (shift: Shift) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="h-4 w-4 flex items-center justify-center hover:bg-muted dark:hover:bg-white/20 rounded transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3 w-3 text-muted-foreground dark:text-white/60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border min-w-[160px] z-50">
        <DropdownMenuItem
          onClick={() => onEditShift?.(shift)}
          className="text-popover-foreground hover:bg-accent cursor-pointer"
        >
          <Edit2 className="h-4 w-4 mr-2" />
          Edit Shift
        </DropdownMenuItem>

        {canUnpublish(shift) && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={() => handleRequestUnpublish(shift.id)}
              className="text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 dark:hover:bg-amber-500/10 cursor-pointer"
            >
              <Undo2 className="h-4 w-4 mr-2" />
              Unpublish Shift
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

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

  const handleShiftSelect = (id: string, selected: boolean) => {
    toggleShiftSelection(id);
  };

  const handlePublish = async (ids: string[]) => {
    try {
      await bulkPublish.mutateAsync(ids);
      toast.success(`${ids.length} shifts published`);
      clearSelection();
    } catch {
      toast.error('Failed to publish shifts');
    }
  };

  const handleDelete = async () => {
    try {
      await bulkDelete.mutateAsync(selectedShiftIds);
      toast.success(`${selectedShiftIds.length} shifts deleted`);
      clearSelection();
    } catch {
      toast.error('Failed to delete shifts');
    }
  };

  // ==================== HELPERS ====================
  const mapToDisplayShift = (shift: Shift) => ({
    ...shift,
    id: shift.id,
    role: (shift as any).roles?.name || 'Unknown Role',
    startTime: shift.start_time,
    endTime: shift.end_time,
    lifecycleStatus: (shift.lifecycle_status || 'Draft').toLowerCase() as any,
    assignmentStatus: (shift.assigned_employee_id ? 'assigned' : 'unassigned') as 'assigned' | 'unassigned',
    fulfillmentStatus: shift.fulfillment_status as any,
    assignmentOutcome: (shift as any).assignment_outcome,
    subGroup: shift.sub_group_name || undefined,
    groupColor: shift.group_type === 'convention_centre' ? 'blue' :
      shift.group_type === 'exhibition_centre' ? 'green' :
        shift.group_type === 'theatre' ? 'purple' : 'blue',
    employeeName: (shift as any).assigned_profiles
      ? `${(shift as any).assigned_profiles.first_name} ${(shift as any).assigned_profiles.last_name}`
      : undefined,
    rawShift: shift,
  });

  // ==================== RENDER ====================
  const isLoading = !projection && (isLoadingLevels || isLoadingRoles || isLoadingShifts);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground gap-3">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm font-medium tracking-wide">Loading roles…</p>
      </div>
    );
  }

  const totalShifts = activeShifts.filter(s => !s.is_cancelled).length;
  const assignedShifts = activeShifts.filter(s => !!s.assigned_employee_id && !s.is_cancelled).length;
  const unfilledShifts = totalShifts - assignedShifts;
  const totalHours = projection?.stats.totalNetMinutes != null
    ? (projection.stats.totalNetMinutes / 60).toFixed(1)
    : '—';
  const estCost = projection?.stats.estimatedCost ?? 0;

  const isToday = (date: Date) => {
    const now = new Date();
    return date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card/90 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-md bg-indigo-100 dark:bg-indigo-500/10">
            <Briefcase className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-[13px] font-bold text-foreground uppercase tracking-[0.08em]">Roles Mode</h2>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono tracking-[0.12em] mt-0.5">
              <span>Coverage per Role</span>
              {(activeSubDeptId || activeDeptId) && (
                <span className="text-indigo-400/80 font-semibold">Filtered</span>
              )}
              <span className="text-emerald-400/60">{totalHours}h · ${estCost.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Calendar Grid ─── */}
      <div className="flex-1 min-h-0 overflow-auto relative">
        <table
          className="border-collapse"
          style={{ minWidth: '100%' }}
        >
          {/* ── Sticky header row ── */}
          <thead>
            <tr className="bg-muted/30">
              {/* Sticky Meta Columns — Level and Role with Glassmorphism */}
              <th
                className="sticky top-0 left-0 z-[40] w-24 min-w-[96px] px-4 py-3 text-left bg-muted/80 backdrop-blur-xl border-b border-r border-border"
              >
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] font-mono">Level</span>
              </th>
              <th
                className="sticky top-0 left-[96px] z-[40] w-48 min-w-[192px] px-4 py-3 text-left bg-muted/80 backdrop-blur-xl border-b border-r border-border shadow-[4px_0_8px_-4px_rgba(0,0,0,0.3)]"
              >
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] font-mono">Role</span>
              </th>

              {dates.map(date => (
                <th
                  key={date.toISOString()}
                  className={cn(
                    "sticky top-0 z-20 min-w-[200px] px-3 py-3 text-center border-b border-border bg-muted/30",
                    isToday(date) && "bg-primary/5"
                  )}
                >
                  <div className={cn(
                    "text-[10px] font-bold uppercase tracking-[0.12em] font-mono",
                    isToday(date) ? "text-primary" : "text-muted-foreground"
                  )}>
                    {format(date, 'EEE')}
                  </div>
                  <div className={cn(
                    "text-sm font-mono tabular-nums mt-0.5",
                    isToday(date) ? "text-primary font-bold" : "text-muted-foreground/50 font-medium"
                  )}>
                    {format(date, 'MMM d')}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* ── Role rows ── */}
          <tbody>
            {flatRoles.map((role, idx) => (
              <tr
                key={role.id}
                className={cn(
                  "group transition-colors",
                  "hover:bg-accent/30",
                  idx % 2 === 0 ? "bg-card" : "bg-muted/30"
                )}
              >
                {/* Sticky Level Column — Glassmorphic */}
                <td
                  className="sticky left-0 z-20 w-24 min-w-[96px] px-4 py-3 align-middle border-r border-b border-border bg-card/80 backdrop-blur-md group-hover:bg-accent/40 transition-colors"
                >
                  {role.levelLabel && (
                    <span className={cn(
                      "shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 rounded-sm tracking-wide",
                      role.levelNumber >= 5
                        ? "text-amber-700 dark:text-amber-300 bg-amber-100/50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20"
                        : role.levelNumber >= 3
                          ? "text-indigo-700 dark:text-indigo-300 bg-indigo-100/50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20"
                          : "text-muted-foreground bg-muted border border-border"
                    )}>
                      {role.levelLabel}
                    </span>
                  )}
                </td>

                {/* Sticky Role Column — Glassmorphic with Right Shadow */}
                <td
                  className="sticky left-[96px] z-20 w-48 min-w-[192px] px-4 py-3 align-middle border-r border-b border-border bg-card/80 backdrop-blur-md group-hover:bg-accent/40 transition-colors shadow-[4px_0_8px_-4px_rgba(0,0,0,0.3)]"
                >
                  <span className="text-[13px] font-semibold text-foreground/80 group-hover:text-foreground transition-colors leading-tight">
                    {role.name}
                  </span>
                </td>

                {/* Date cells */}
                {dates.map(date => {
                  const dateStr = format(date, 'yyyy-MM-dd');
                  const cellShifts = role.shiftsByDate[dateStr] || [];
                  const today = isToday(date);

                  return (
                    <td
                      key={`${role.id}-${dateStr}`}
                      className={cn(
                        "min-w-[200px] px-2 py-2 border-l border-b border-border align-top relative group/cell transition-colors",
                        today && "bg-primary/5"
                      )}
                    >
                      <div className="flex flex-col gap-1 min-h-[52px]">
                        {cellShifts.map(shift => (
                          <ShiftCardCompact
                            key={shift.id}
                            shift={mapToDisplayShift(shift)}
                            variant="roles"
                            isSelected={selectedShiftIds.includes(shift.id)}
                            showCheckbox={isBulkMode}
                            onCheckboxChange={() => handleShiftSelect(shift.id, !selectedShiftIds.includes(shift.id))}
                            className="w-full"
                            headerAction={!isBulkMode ? buildShiftMenu(shift) : undefined}
                            onClick={() => onEditShift?.(shift)}
                          />
                        ))}

                        {/* Unified Add Shift Button — Repositioned to corner if shifts exist */}
                        {canEdit && !isBulkMode && !isSydneyPast(date) && (
                          <div className={cn(
                            "absolute inset-0 flex pointer-events-none z-10",
                            cellShifts.length > 0 ? "items-end justify-end p-2" : "items-center justify-center"
                          )}>
                            <button
                              onClick={() => handleCellClick(role.id, date)}
                              className={cn(
                                "flex items-center justify-center rounded-full transition-all duration-300 pointer-events-auto",
                                "bg-primary/30 text-primary border border-primary/40 backdrop-blur-md",
                                "hover:bg-primary/60 hover:scale-110 active:scale-95 shadow-[0_0_20px_rgba(var(--primary),0.3)]",
                                cellShifts.length > 0 
                                  ? "w-7 h-7 opacity-0 scale-75 group-hover/cell:opacity-100 group-hover/cell:scale-100" 
                                  : "w-9 h-9 opacity-40 scale-90 hover:opacity-100",
                                "group/add"
                              )}
                              title="Add Shift"
                            >
                              <Plus className={cn(
                                cellShifts.length > 0 ? "h-4 w-4" : "h-5 w-5",
                                "transition-transform group-hover/add:rotate-90"
                              )} />
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      {/* Bulk toolbar removed - now rendered in RostersPlannerPage */}

      {/* Shift modal */}
      {isModalOpen && (
        <EnhancedAddShiftModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          context={modalContext}
          onSuccess={() => setIsModalOpen(false)}
        />
      )}

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Unpublish Shift</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This shift will be reverted to Draft and removed from all employee-facing surfaces immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-muted">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmUnpublish}
              className="bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
            >
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RolesModeView;
