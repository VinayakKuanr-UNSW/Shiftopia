import React, { useState, useMemo } from 'react';
import { Plus, Briefcase, Loader2, MoreHorizontal, Undo2, Edit2 } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { format, addDays, startOfWeek } from 'date-fns';
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
}) => {
  // ==================== HOOKS ====================
  const activeDeptId = departmentIds[0];
  const activeSubDeptId = subDepartmentIds[0];

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
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
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
          className="h-4 w-4 flex items-center justify-center hover:bg-white/20 rounded transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3 w-3 text-white/60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-[#1a2744] border-white/10 min-w-[160px] z-50">
        <DropdownMenuItem
          onClick={() => onEditShift?.(shift)}
          className="text-white hover:bg-white/10 cursor-pointer"
        >
          <Edit2 className="h-4 w-4 mr-2" />
          Edit Shift
        </DropdownMenuItem>

        {canUnpublish(shift) && (
          <>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              onClick={() => handleRequestUnpublish(shift.id)}
              className="text-amber-400 hover:bg-amber-500/10 cursor-pointer"
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
    if (selected) {
      setSelectedShiftIds(prev => [...prev, id]);
    } else {
      setSelectedShiftIds(prev => prev.filter(s => s !== id));
    }
  };

  const handlePublish = async (ids: string[]) => {
    try {
      await bulkPublish.mutateAsync(ids);
      toast.success(`${ids.length} shifts published`);
      setSelectedShiftIds([]);
    } catch {
      toast.error('Failed to publish shifts');
    }
  };

  const handleDelete = async () => {
    try {
      await bulkDelete.mutateAsync(selectedShiftIds);
      toast.success(`${selectedShiftIds.length} shifts deleted`);
      setSelectedShiftIds([]);
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
      <div className="flex flex-col items-center justify-center h-[400px] text-slate-400 gap-3">
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
    <div className="flex flex-col h-full bg-[#060a12]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/[0.06] bg-[#080d18]/90 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-md bg-indigo-500/10">
            <Briefcase className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white/90 uppercase tracking-[0.08em]">Roles Mode</h2>
            <div className="flex items-center gap-2 text-[10px] text-white/30 font-mono tracking-wider mt-0.5">
              <span>Coverage per Role</span>
              {(activeSubDeptId || activeDeptId) && (
                <span className="text-indigo-400/80 font-semibold">Filtered</span>
              )}
              <span className="text-emerald-400/60">{totalHours}h · ${estCost.toFixed(0)}</span>
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsBulkMode(!isBulkMode)}
          className={cn(
            "h-7 text-[10px] font-bold uppercase tracking-wider border-white/[0.08] transition-all",
            isBulkMode
              ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
              : "bg-white/[0.03] text-white/40 hover:text-white/70 hover:bg-white/[0.06]"
          )}
        >
          {isBulkMode ? "Exit Bulk" : "Bulk Mode"}
        </Button>
      </div>

      {/* ─── Calendar Grid ─── */}
      <div className="flex-1 min-h-0 overflow-auto relative">
        <table
          className="border-collapse"
          style={{ minWidth: '100%' }}
        >
          {/* ── Sticky header row ── */}
          <thead>
            <tr>
              {/* Top-left corner cell — sticky in both axes */}
              <th
                className="sticky top-0 left-0 z-30 w-64 min-w-[256px] p-0 bg-[#0a0f1c] border-b border-r border-white/[0.06]"
              >
                <div className="px-4 py-3 text-[10px] font-bold text-white/25 uppercase tracking-[0.14em] font-mono">
                  Role / Level
                </div>
              </th>

              {dates.map(date => (
                <th
                  key={date.toISOString()}
                  className={cn(
                    "sticky top-0 z-20 min-w-[200px] px-3 py-2.5 text-center border-b border-l border-white/[0.06] bg-[#0a0f1c]",
                    isToday(date) && "bg-indigo-500/[0.08]"
                  )}
                >
                  <div className={cn(
                    "text-[10px] font-bold uppercase tracking-[0.12em] font-mono",
                    isToday(date) ? "text-indigo-300" : "text-white/40"
                  )}>
                    {format(date, 'EEE')}
                  </div>
                  <div className={cn(
                    "text-sm font-mono tabular-nums mt-0.5",
                    isToday(date) ? "text-indigo-200 font-bold" : "text-white/25 font-medium"
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
                  "hover:bg-white/[0.02]",
                  idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.008]"
                )}
              >
                {/* Sticky first column — role name + level badge */}
                <td
                  className="sticky left-0 z-10 w-64 min-w-[256px] px-4 py-3 align-middle border-r border-b border-white/[0.06] bg-[#080d18] group-hover:bg-[#0c1220] transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] font-semibold text-white/80 group-hover:text-white transition-colors leading-tight">
                      {role.name}
                    </span>
                    {role.levelLabel && (
                      <span className={cn(
                        "shrink-0 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm tracking-wide",
                        role.levelNumber >= 5
                          ? "text-amber-300/80 bg-amber-500/10 border border-amber-500/15"
                          : role.levelNumber >= 3
                            ? "text-indigo-300/80 bg-indigo-500/10 border border-indigo-500/15"
                            : "text-white/35 bg-white/[0.04] border border-white/[0.06]"
                      )}>
                        {role.levelLabel}
                      </span>
                    )}
                  </div>
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
                        "min-w-[200px] px-2 py-2 border-l border-b border-white/[0.06] align-top relative group/cell transition-colors",
                        today && "bg-indigo-500/[0.03]"
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

                        {canEdit && !isBulkMode && (
                          <button
                            onClick={() => handleCellClick(role.id, date)}
                            className="opacity-0 group-hover/cell:opacity-100 flex items-center justify-center w-full py-1.5 rounded border border-dashed border-white/[0.08] hover:border-indigo-500/30 text-white/15 hover:text-indigo-400/60 hover:bg-indigo-500/[0.04] transition-all duration-200"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
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

      {/* ─── Footer ─── */}
      <div className="flex items-center justify-between px-6 py-2.5 border-t border-white/[0.06] bg-[#080d18]/90 backdrop-blur-xl text-[10px] uppercase tracking-wider text-white/25 font-mono font-bold">
        <div className="flex items-center gap-5">
          <span>Shifts: <span className="text-white/60 tabular-nums">{totalShifts}</span></span>
          <span className="text-emerald-400/60">Assigned: <span className="tabular-nums">{assignedShifts}</span></span>
          <span className="text-amber-400/60">Open: <span className="tabular-nums">{unfilledShifts}</span></span>
        </div>
        <div className="flex items-center gap-4">
          <span>Est. Cost: <span className="text-white/50 tabular-nums">${estCost.toFixed(2)}</span></span>
          <span className="text-white/10">|</span>
          <span>Hours: <span className="text-white/50 tabular-nums">{totalHours}</span></span>
        </div>
      </div>

      {/* Bulk toolbar */}
      {isBulkMode && selectedShiftIds.length > 0 && (
        <BulkActionsToolbar
          selectedCount={selectedShiftIds.length}
          selectedShiftIds={selectedShiftIds}
          onClearSelection={() => setSelectedShiftIds([])}
          onDelete={handleDelete}
          onPublish={handlePublish}
          allowedActions={{ canPublish: true }}
        />
      )}

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
        <AlertDialogContent className="bg-[#0f172a] border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Unpublish Shift</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300">
              This shift will be reverted to Draft and removed from all employee-facing surfaces immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-white/70 hover:bg-white/5">
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
