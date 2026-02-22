import React, { useState, useMemo } from 'react';
import { Plus, Briefcase, Loader2 } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { format, addDays, startOfWeek } from 'date-fns';
import { EnhancedAddShiftModal, ShiftContext } from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import { ShiftCardCompact } from '@/modules/rosters/ui/components/ShiftCardCompact';
import { BulkActionsToolbar } from '@/modules/rosters/ui/components/BulkActionsToolbar';
import { useShiftsByDateRange, useRemunerationLevels, useBulkDeleteShifts, useBulkPublishShifts, useRoles } from '@/modules/rosters/state/useRosterShifts';
import { Shift } from '@/modules/rosters/api/shifts.api';
import { toast } from 'sonner';

interface RolesModeViewProps {
  selectedDate: Date;
  viewType: 'day' | '3day' | 'week' | 'month';
  canEdit: boolean;
  organizationId?: string;
  departmentIds?: string[];
  subDepartmentIds?: string[];
  rosterId?: string;
}

export const RolesModeView: React.FC<RolesModeViewProps> = ({
  selectedDate,
  viewType,
  canEdit,
  organizationId,
  departmentIds = [],
  subDepartmentIds = [],
  rosterId,
}) => {
  // ==================== HOOKS ====================
  const activeDeptId = departmentIds[0];
  const activeSubDeptId = subDepartmentIds[0];

  const { data: levels = [], isLoading: isLoadingLevels } = useRemunerationLevels();
  const { data: roles = [], isLoading: isLoadingRoles } = useRoles(activeDeptId, activeSubDeptId);

  const startDate = useMemo(() => {
    if (viewType === 'week') return format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    if (viewType === 'month') return format(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1), 'yyyy-MM-dd');
    return format(selectedDate, 'yyyy-MM-dd');
  }, [selectedDate, viewType]);

  const endDate = useMemo(() => {
    if (viewType === 'day') return startDate;
    if (viewType === '3day') return format(addDays(new Date(startDate), 2), 'yyyy-MM-dd');
    if (viewType === 'week') return format(addDays(new Date(startDate), 6), 'yyyy-MM-dd');
    if (viewType === 'month') return format(addDays(addDays(new Date(startDate), 31), -1), 'yyyy-MM-dd'); // Rough end of month
    return startDate;
  }, [startDate, viewType]);

  const { data: shifts = [], isLoading: isLoadingShifts } = useShiftsByDateRange(
    organizationId || null,
    startDate,
    endDate,
    {
      departmentIds,
      subDepartmentIds,
    }
  );

  const bulkDelete = useBulkDeleteShifts();
  const bulkPublish = useBulkPublishShifts();

  // ==================== STATE ====================
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState<ShiftContext | null>(null);

  // ==================== DERIVED ====================
  const dates = useMemo(() => {
    const numDays = viewType === 'day' ? 1 : viewType === '3day' ? 3 : viewType === 'week' ? 7 : 31;
    return Array.from({ length: numDays }).map((_, i) => addDays(new Date(startDate), i));
  }, [startDate, viewType]);

  const shiftsByRoleAndDate = useMemo(() => {
    const grouped: Record<string, Record<string, Shift[]>> = {};
    shifts.forEach((shift) => {
      const roleId = shift.role_id || 'unassigned';
      const date = shift.shift_date;
      if (!grouped[roleId]) grouped[roleId] = {};
      if (!grouped[roleId][date]) grouped[roleId][date] = [];
      grouped[roleId][date].push(shift);
    });
    return grouped;
  }, [shifts]);

  const sortedLevels = useMemo(() => {
    return [...levels].sort((a, b) => (b.level_number || 0) - (a.level_number || 0));
  }, [levels]);

  const rolesByLevel = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    roles.forEach(role => {
      const levelId = role.remuneration_level_id || 'unassigned';
      if (!grouped[levelId]) grouped[levelId] = [];
      grouped[levelId].push(role);
    });
    return grouped;
  }, [roles]);

  // ==================== HANDLERS ====================
  const handleCellClick = (roleId: string, date: Date, remunerationLevelId?: string) => {
    if (!canEdit) return;
    setModalContext({
      mode: 'roles',
      launchSource: 'grid',
      date: format(date, 'yyyy-MM-dd'),
      organizationId,
      departmentId: activeDeptId,
      subDepartmentId: activeSubDeptId,
      roleId: roleId === 'unassigned' ? undefined : roleId,
      remunerationLevelId,
      rosterId,
    });
    setIsModalOpen(true);
  };

  const handleShiftSelect = (id: string, selected: boolean) => {
    if (selected) {
      setSelectedShiftIds((prev) => [...prev, id]);
    } else {
      setSelectedShiftIds((prev) => prev.filter((s) => s !== id));
    }
  };

  const handlePublish = async (ids: string[]) => {
    try {
      await bulkPublish.mutateAsync(ids);
      toast.success(`${ids.length} shifts published`);
      setSelectedShiftIds([]);
    } catch (err) {
      toast.error('Failed to publish shifts');
    }
  };

  const handleDelete = async (ids: string[]) => {
    try {
      await bulkDelete.mutateAsync(ids);
      toast.success(`${ids.length} shifts deleted`);
      setSelectedShiftIds([]);
    } catch (err) {
      toast.error('Failed to delete shifts');
    }
  };

  // ==================== HELPERS ====================
  const getLevelColor = (levelNum: number) => {
    if (levelNum >= 7) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    if (levelNum >= 5) return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    if (levelNum >= 3) return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
    return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  };

  const mapToDisplayShift = (shift: Shift) => ({
    ...shift,
    id: shift.id,
    role: shift.roles?.name || 'Unknown Role',
    startTime: shift.start_time,
    endTime: shift.end_time,
    lifecycleStatus: (shift.lifecycle_status || 'Draft').toLowerCase() as any,
    assignmentStatus: shift.assigned_employee_id ? 'assigned' : 'unassigned',
    fulfillmentStatus: shift.fulfillment_status as any,
    assignmentOutcome: (shift as any).assignment_outcome,
    subGroup: shift.sub_group_name || undefined,
    groupColor: shift.group_type === 'convention_centre' ? 'blue' :
      shift.group_type === 'exhibition_centre' ? 'green' :
        shift.group_type === 'theatre' ? 'purple' : 'blue',
    employeeName: shift.assigned_profiles ? `${shift.assigned_profiles.first_name} ${shift.assigned_profiles.last_name}` : undefined,
    rawShift: shift
  });

  // ==================== RENDER ====================
  if (isLoadingLevels || isLoadingRoles || isLoadingShifts) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] text-slate-400 gap-3">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p>Loading role data...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0B0F1A]">
      {/* Dynamic Header */}
      <div className="sticky top-0 z-30 flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0B0F1A]/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-100 uppercase tracking-tight">Roles Mode</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="uppercase tracking-widest px-1.5 py-0.5 rounded border border-slate-800 bg-slate-900/50">Viewing Coverage per Role</span>
              {(activeSubDeptId || activeDeptId) && <span className="text-indigo-400 font-medium">Filtered by Hierarchy</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsBulkMode(!isBulkMode)}
            className={cn(
              "h-8 border-slate-800 text-xs font-medium uppercase tracking-wider transition-all",
              isBulkMode ? "bg-indigo-500/10 border-indigo-500/50 text-indigo-400" : "bg-slate-900/50 text-slate-400 hover:text-slate-200"
            )}
          >
            {isBulkMode ? "Exit Bulk Mode" : "Bulk Mode"}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6">
          <div className="rounded-xl border border-slate-800/50 bg-[#0D121F] overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="w-72 min-w-72 p-4 text-left text-xs font-bold text-slate-500 uppercase tracking-widest bg-slate-900/30">
                    Role & Level
                  </th>
                  {dates.map((date) => (
                    <th key={date.toISOString()} className="p-4 text-center border-l border-slate-800 bg-slate-900/10">
                      <div className="text-xs font-bold text-slate-300 uppercase tracking-tight">{format(date, 'EEE')}</div>
                      <div className="text-sm font-medium text-slate-500">{format(date, 'MMM d')}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedLevels.map((level) => {
                  const levelRoles = rolesByLevel[level.id] || [];
                  if (levelRoles.length === 0) return null;

                  return (
                    <React.Fragment key={level.id}>
                      {/* Level Group Header */}
                      <tr className="bg-slate-900/20">
                        <td colSpan={dates.length + 1} className="px-4 py-2 border-b border-slate-800/50">
                          <div className="flex items-center gap-2">
                            <Badge className={cn("text-[10px] font-bold uppercase py-0 px-2 rounded-sm", getLevelColor(level.level_number || 0))}>
                              L{level.level_number} - {level.level_name}
                            </Badge>
                            <div className="h-px flex-1 bg-slate-800/30" />
                          </div>
                        </td>
                      </tr>

                      {levelRoles.map((role) => (
                        <tr key={role.id} className="group hover:bg-slate-900/40 transition-colors border-b border-slate-800/50">
                          <td className="p-4 align-top">
                            <div className="flex flex-col gap-1">
                              <div className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">
                                {role.name}
                              </div>
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">
                                {role.code || 'NO CODE'}
                              </div>
                            </div>
                          </td>

                          {dates.map((date) => {
                            const dateStr = format(date, 'yyyy-MM-dd');
                            const cellShifts = shiftsByRoleAndDate[role.id]?.[dateStr] || [];

                            return (
                              <td
                                key={`${role.id}-${dateStr}`}
                                className="p-3 border-l border-slate-800 align-top min-w-[240px] relative group/cell"
                              >
                                <div className="flex flex-col gap-2 min-h-[60px]">
                                  {cellShifts.map((shift) => (
                                    <ShiftCardCompact
                                      key={shift.id}
                                      shift={mapToDisplayShift(shift)}
                                      variant="roles"
                                      isSelected={selectedShiftIds.includes(shift.id)}
                                      showCheckbox={isBulkMode}
                                      onCheckboxChange={() => handleShiftSelect(shift.id, !selectedShiftIds.includes(shift.id))}
                                      className="w-full"
                                    />
                                  ))}

                                  {canEdit && !isBulkMode && (
                                    <button
                                      onClick={() => handleCellClick(role.id, date, level.id)}
                                      className="opacity-0 group-hover/cell:opacity-100 flex items-center justify-center w-full py-2 border border-dashed border-slate-800 rounded-lg text-slate-500 hover:text-indigo-400 hover:border-indigo-500/5 transition-all hover:bg-indigo-500/5"
                                    >
                                      <Plus className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}

                {/* Handle Unassigned Roles or Level-less roles */}
                {rolesByLevel['unassigned']?.length > 0 && (
                  <React.Fragment>
                    <tr className="bg-slate-900/20">
                      <td colSpan={dates.length + 1} className="px-4 py-2 border-b border-slate-800/50">
                        <div className="flex items-center gap-2">
                          <Badge className="text-[10px] font-bold uppercase py-0 px-2 rounded-sm bg-slate-800 text-slate-400 border-slate-700">
                            Other Roles
                          </Badge>
                          <div className="h-px flex-1 bg-slate-800/30" />
                        </div>
                      </td>
                    </tr>
                    {rolesByLevel['unassigned'].map(role => (
                      <tr key={role.id} className="group hover:bg-slate-900/40 transition-colors border-b border-slate-800/50">
                        <td className="p-4 align-top">
                          <div className="flex flex-col gap-1">
                            <div className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">
                              {role.name}
                            </div>
                          </div>
                        </td>
                        {dates.map((date) => {
                          const dateStr = format(date, 'yyyy-MM-dd');
                          const cellShifts = shiftsByRoleAndDate[role.id]?.[dateStr] || [];
                          return (
                            <td key={`${role.id}-${dateStr}`} className="p-3 border-l border-slate-800 align-top min-w-[240px] relative group/cell">
                              <div className="flex flex-col gap-2 min-h-[60px]">
                                {cellShifts.map((shift) => (
                                  <ShiftCardCompact
                                    key={shift.id}
                                    shift={mapToDisplayShift(shift)}
                                    variant="roles"
                                    isSelected={selectedShiftIds.includes(shift.id)}
                                    showCheckbox={isBulkMode}
                                    onCheckboxChange={() => handleShiftSelect(shift.id, !selectedShiftIds.includes(shift.id))}
                                  />
                                ))}
                                {canEdit && !isBulkMode && (
                                  <button onClick={() => handleCellClick(role.id, date)} className="opacity-0 group-hover/cell:opacity-100 flex items-center justify-center w-full py-2 border border-dashed border-slate-800 rounded-lg text-slate-500 hover:text-indigo-400 hover:border-indigo-500/5 transition-all hover:bg-indigo-500/5">
                                    <Plus className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </ScrollArea>

      {/* Footer Summary */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-900/50 text-[10px] uppercase tracking-widest text-slate-500 font-bold">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span>Total Shifts:</span>
            <span className="text-slate-300">{shifts.length}</span>
          </div>
          <div className="flex items-center gap-2 text-emerald-500">
            <span className="bg-emerald-500/20 px-1 rounded">Assigned:</span>
            <span>{shifts.filter(s => !!s.assigned_employee_id).length}</span>
          </div>
          <div className="flex items-center gap-2 text-amber-500">
            <span className="bg-amber-500/20 px-1 rounded">Unfilled:</span>
            <span>{shifts.filter(s => !s.assigned_employee_id).length}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span>Est. Cost: <span className="text-slate-300">$0.00</span></span>
          <span className="text-slate-700">|</span>
          <span>Budget: <span className="text-slate-300">$15000.00</span></span>
        </div>
      </div>

      {isBulkMode && selectedShiftIds.length > 0 && (
        <BulkActionsToolbar
          selectedCount={selectedShiftIds.length}
          selectedShiftIds={selectedShiftIds}
          onClearSelection={() => setSelectedShiftIds([])}
          onDelete={handleDelete}
          onPublish={handlePublish}
          allowedActions={['publish', 'delete']}
        />
      )}

      {isModalOpen && (
        <EnhancedAddShiftModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          context={modalContext}
          onSuccess={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
};

export default RolesModeView;
