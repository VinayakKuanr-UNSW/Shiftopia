import React, { useState, useEffect, useMemo } from 'react';
import { shiftsApi } from '@/modules/rosters/api/shifts.api';
import { Plus, Check, Building2, ChevronDown } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { cn } from '@/modules/core/lib/utils';
import { format, addDays, startOfWeek } from 'date-fns';
import { EnhancedAddShiftModal, ShiftContext } from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import { ShiftCardCompact } from '@/modules/rosters/ui/components/ShiftCardCompact';
import { BulkActionsToolbar } from '@/modules/rosters/ui/components/BulkActionsToolbar';
import {
  mockOrganizations,
  mockDepartments,
  mockSubDepartments,
  mockRemunerationLevels,
  generateRolesModeData,
  getDepartmentsByOrg,
  getSubDepartmentsByDept,
  getLevelColor,
  type RemunerationLevel,
  type RoleShift,
  type RoleDayData,
} from '@/api/data/rolesModeData';

/* ============================================================
   INTERFACES
   ============================================================ */
interface RolesModeViewProps {
  selectedDate: Date;
  viewType: 'day' | '3day' | 'week' | 'month';
  canEdit: boolean;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export const RolesModeView: React.FC<RolesModeViewProps> = ({
  selectedDate,
  viewType,
  canEdit,
}) => {
  // ==================== STATE ====================
  // Hierarchy selectors
  const [selectedOrgId, setSelectedOrgId] = useState<string>('org-1');
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [selectedSubDeptId, setSelectedSubDeptId] = useState<string>('');

  // Filtered options based on selections
  const [filteredDepartments, setFilteredDepartments] = useState(mockDepartments);
  const [filteredSubDepartments, setFilteredSubDepartments] = useState(mockSubDepartments);

  // Modal state
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [shiftContext, setShiftContext] = useState<ShiftContext | null>(null);

  // Bulk mode state
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedShiftIds, setSelectedShiftIds] = useState<Set<string>>(new Set());

  // ==================== DERIVED DATA ====================
  const dates = useMemo(() => {
    const result: Date[] = [];
    switch (viewType) {
      case 'day':
        result.push(selectedDate);
        break;
      case '3day':
        for (let i = 0; i < 3; i++) {
          result.push(addDays(selectedDate, i));
        }
        break;
      case 'week':
        const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
        for (let i = 0; i < 7; i++) {
          result.push(addDays(weekStart, i));
        }
        break;
      case 'month':
        for (let i = 0; i < 14; i++) {
          result.push(addDays(selectedDate, i));
        }
        break;
    }
    return result;
  }, [selectedDate, viewType]);

  // Generate mock shift data
  const shiftsData = useMemo(() => {
    return generateRolesModeData(dates[0], dates.length);
  }, [dates]);

  // ==================== EFFECTS ====================
  // Update filtered departments when org changes
  useEffect(() => {
    if (selectedOrgId) {
      const depts = getDepartmentsByOrg(selectedOrgId);
      setFilteredDepartments(depts);
      setSelectedDeptId('');
      setSelectedSubDeptId('');
    }
  }, [selectedOrgId]);

  // Update filtered sub-departments when department changes
  useEffect(() => {
    if (selectedDeptId) {
      const subDepts = getSubDepartmentsByDept(selectedDeptId);
      setFilteredSubDepartments(subDepts);
      setSelectedSubDeptId('');
    }
  }, [selectedDeptId]);

  // ==================== HANDLERS ====================
  const handleCellClick = (level: RemunerationLevel, date: Date) => {
    if (!canEdit || isBulkMode) return;

    const context: ShiftContext = {
      mode: 'roles',
      date: format(date, 'yyyy-MM-dd'),
      organizationId: selectedOrgId,
      departmentId: selectedDeptId || undefined,
      subDepartmentId: selectedSubDeptId || undefined,
      // Pre-fill remuneration level
    };

    setShiftContext(context);
    setIsAddShiftOpen(true);
  };

  const handleShiftClick = (shift: RoleShift, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBulkMode) {
      toggleShiftSelection(shift.id);
    }
  };

  const toggleShiftSelection = (shiftId: string) => {
    setSelectedShiftIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(shiftId)) {
        newSet.delete(shiftId);
      } else {
        newSet.add(shiftId);
      }
      return newSet;
    });
  };

  const handlePushToBidding = async () => {
    console.log('Pushing to bidding:', selectedShiftIds);
    // TODO: Implement actual bulk push with auto-calculated close times
  };

  const handleDelete = async () => {
    console.log('Deleting shifts:', selectedShiftIds);
  };

  const handleShiftCreated = () => {
    console.log('Shift created successfully');
  };

  // ==================== RENDER ====================
  return (
    <div className="flex flex-col h-full">
      {/* ==================== HEADER BAR ==================== */}
      <div className="px-6 py-3 border-b border-border/40 flex items-center justify-between gap-4 flex-wrap">
        {/* Hierarchy Selectors */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            <span>Filter:</span>
          </div>

          {/* Organization */}
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="Organization" />
            </SelectTrigger>
            <SelectContent>
              {mockOrganizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ChevronDown className="h-4 w-4 text-muted-foreground rotate-[-90deg]" />

          {/* Department */}
          <Select
            value={selectedDeptId || '__all__'}
            onValueChange={(value) => setSelectedDeptId(value === '__all__' ? '' : value)}
            disabled={!selectedOrgId}
          >
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Departments</SelectItem>
              {filteredDepartments.map((dept) => (
                <SelectItem key={dept.id} value={dept.id}>
                  {dept.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ChevronDown className="h-4 w-4 text-muted-foreground rotate-[-90deg]" />

          {/* Sub-Department */}
          <Select
            value={selectedSubDeptId || '__all__'}
            onValueChange={(value) => setSelectedSubDeptId(value === '__all__' ? '' : value)}
            disabled={!selectedDeptId || selectedDeptId === ''}
          >
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="All Sub-Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Sub-Departments</SelectItem>
              {filteredSubDepartments.map((sub) => (
                <SelectItem key={sub.id} value={sub.id}>
                  {sub.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk Mode Toggle */}
        {canEdit && (
          <Button
            variant={isBulkMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setIsBulkMode(!isBulkMode);
              if (isBulkMode) {
                setSelectedShiftIds(new Set());
              }
            }}
          >
            {isBulkMode ? <Check className="h-4 w-4 mr-2" /> : null}
            {isBulkMode ? 'Exit Bulk Mode' : 'Bulk Mode'}
          </Button>
        )}
      </div>

      {/* ==================== MAIN GRID ==================== */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                {/* ========== TABLE HEADER ========== */}
                <thead>
                  <tr className="bg-muted/30">
                    {/* Role Column Header */}
                    <th className="sticky left-0 z-10 bg-muted/30 border-r border-b border-border px-4 py-3 text-left font-medium text-sm min-w-[220px]">
                      Remuneration Level
                    </th>

                    {/* Date Column Headers */}
                    {dates.map((date, idx) => (
                      <th
                        key={idx}
                        className={cn(
                          'border-b border-border px-3 py-3 text-center font-medium text-sm min-w-[160px]',
                          idx < dates.length - 1 && 'border-r'
                        )}
                      >
                        <div className="font-semibold">{format(date, 'EEE')}</div>
                        <div className="text-xs text-muted-foreground font-normal">
                          {format(date, 'MMM d')}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* ========== TABLE BODY ========== */}
                <tbody>
                  {/* Levels from L7 to L0 */}
                  {mockRemunerationLevels.map((level, levelIdx) => (
                    <tr
                      key={level.id}
                      className={cn(
                        'hover:bg-muted/20 transition-colors',
                        levelIdx < mockRemunerationLevels.length - 1 &&
                        'border-b border-border'
                      )}
                    >
                      {/* ========== LEVEL INFO CELL ========== */}
                      <td className="sticky left-0 z-10 bg-background border-r border-border px-4 py-3 align-top">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={cn('text-xs font-semibold', getLevelColor(level.level))}
                            >
                              {level.level}
                            </Badge>
                            <span className="text-sm font-medium">{level.description}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            ${level.hourlyRate.toFixed(2)}/hr
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Roles: {level.roles.map((r) => r.name).join(', ')}
                          </div>
                        </div>
                      </td>

                      {/* ========== DATE CELLS ========== */}
                      {dates.map((date, dateIdx) => {
                        const dateKey = format(date, 'yyyy-MM-dd');
                        const dayData: RoleDayData = shiftsData[level.id]?.[dateKey] || {
                          shifts: [],
                        };
                        const shifts = dayData.shifts;

                        return (
                          <td
                            key={dateIdx}
                            className={cn(
                              'px-3 py-3 align-top min-h-[120px]',
                              dateIdx < dates.length - 1 && 'border-r border-border',
                              canEdit && !isBulkMode && 'cursor-pointer hover:bg-primary/5'
                            )}
                            onClick={() =>
                              !isBulkMode && handleCellClick(level, date)
                            }
                          >
                            <div className="space-y-2 min-h-[80px]">
                              {/* Existing Shifts */}
                              {shifts.length > 0 ? (
                                shifts.map((shift) => (
                                  <div
                                    key={shift.id}
                                    onClick={(e) => handleShiftClick(shift, e)}
                                  >
                                    <ShiftCardCompact
                                      shift={{
                                        id: shift.id,
                                        role: level.description,
                                        startTime: shift.startTime,
                                        endTime: shift.endTime,
                                        lifecycleStatus: shift.status === 'Draft' ? 'draft' : 'published',
                                        assignmentStatus: shift.employeeName ? 'assigned' : 'unassigned',
                                        fulfillmentStatus: 'none',
                                        isTradeRequested: false,
                                        isCancelled: false,
                                        subGroup: shift.subGroupName,
                                        groupColor: shift.groupColor,
                                        employeeName: shift.employeeName,
                                      }}
                                      variant="roles"
                                      isSelected={selectedShiftIds.has(shift.id)}
                                      showCheckbox={isBulkMode}
                                      onCheckboxChange={() =>
                                        toggleShiftSelection(shift.id)
                                      }
                                    />
                                  </div>
                                ))
                              ) : (
                                /* Empty state */
                                !isBulkMode &&
                                canEdit && (
                                  <button
                                    className="w-full text-xs text-primary hover:underline flex items-center justify-center gap-1 py-4"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCellClick(level, date);
                                    }}
                                  >
                                    <Plus className="h-3 w-3" />
                                    Add Shift
                                  </button>
                                )
                              )}

                              {/* Add Shift button when there are existing shifts */}
                              {shifts.length > 0 && canEdit && !isBulkMode && (
                                <button
                                  className="w-full text-xs text-primary/70 hover:text-primary hover:underline flex items-center justify-center gap-1 py-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCellClick(level, date);
                                  }}
                                >
                                  <Plus className="h-3 w-3" />
                                  Add Shift
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
          </div>
        </div>
      </ScrollArea>

      {/* ==================== ADD SHIFT MODAL ==================== */}
      <EnhancedAddShiftModal
        isOpen={isAddShiftOpen}
        onClose={() => {
          setIsAddShiftOpen(false);
          setShiftContext(null);
        }}
        onSuccess={handleShiftCreated}
        context={shiftContext}
      />

      {/* ==================== BULK ACTIONS TOOLBAR ==================== */}
      <BulkActionsToolbar
        selectedCount={selectedShiftIds.size}
        selectedShiftIds={Array.from(selectedShiftIds)}
        onClearSelection={() => setSelectedShiftIds(new Set())}
        onPushToBidding={handlePushToBidding}
        onDelete={handleDelete}
      />
    </div>
  );
};

export default RolesModeView;
