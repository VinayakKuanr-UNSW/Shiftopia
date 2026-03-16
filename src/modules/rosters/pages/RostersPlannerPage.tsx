import React, { useMemo, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfWeek } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { cn } from '@/modules/core/lib/utils';

// Components
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import {
  RosterFunctionBar,
  ViewType,
} from '@/modules/rosters/ui/components/RosterFunctionBar';
import PeopleModeGrid, { EmployeeShift } from '@/modules/rosters/ui/modes/PeopleModeGrid';
import type { PeopleModeEmployee, PeopleModeShift } from '@/modules/rosters/ui/modes/people-mode.types';
import UnfilledShiftsPanel, {
  UnfilledShift,
} from '@/modules/rosters/ui/modes/UnfilledShiftsPanel';
import { GroupModeView } from '@/modules/rosters/ui/modes/GroupModeView';
import { EventsModeView } from '@/modules/rosters/ui/modes/EventsModeView';
import { RolesModeView } from '@/modules/rosters/ui/modes/RolesModeView';
import type { ShiftContext } from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import { BulkActionsToolbar } from '@/modules/rosters/ui/components/BulkActionsToolbar';
import { RosterModals, type RosterModalsHandle } from '@/modules/rosters/ui/components/RosterModals';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';

// Hooks & Services - Enterprise TanStack Query hooks
import { useAuth } from '@/platform/auth/useAuth';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
  useShiftsByDateRange,
  useEmployees,
  useRoles,
  useRemunerationLevels,
  useEvents,
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
  useBulkAssignShifts,
  useBulkPublishShifts,
  useBulkDeleteShifts,
  useBulkUnassignShifts,
  useBulkUnpublishShifts,
  useAcceptOffer,
  useRequestTrade,
  useCancelShift,
  useUnpublishShift,
  useShiftDeltaSync,
} from '@/modules/rosters/state/useRosterShifts';
import { useRosterUI, RosterMode, CalendarView } from '@/modules/rosters/contexts/RosterUIContext';
import {
  Shift,
} from '@/modules/rosters/api/shifts.api';
import { useRosterProjections } from '@/modules/rosters/hooks/useRosterProjections';
import { useRosterStructure } from '@/modules/rosters/state/useRosterStructure';
import { useRostersByDateRange } from '@/modules/rosters/state/useEnhancedRosters';
import { usePublishRoster } from '@/modules/rosters/state/useRosterMutations';
import { usePeopleModeData } from '@/modules/rosters/hooks/usePeopleModeData';
import { useRosterViewPrefetch } from '@/modules/rosters/hooks/useRosterViewPrefetch';
import { shiftKeys, type ShiftFilters } from '@/modules/rosters/api/queryKeys';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
const NewRostersPage: React.FC = () => {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const { isDark } = useTheme();
  const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
  const queryClient = useQueryClient();

  // ==================== SESSION-SCOPED STATE FROM CONTEXT ====================
  // These persist across navigation but reset on browser refresh
  const {
    activeMode,
    setActiveMode,
    viewType,
    setViewType,
    selectedDate,
    setSelectedDate,
    selectedOrganizationId,
    setSelectedOrganizationId,
    selectedDepartmentIds,
    setSelectedDepartmentIds,
    selectedSubDepartmentIds,
    setSelectedSubDepartmentIds,
    bulkModeActive,
    setBulkModeActive,
    selectedShiftIds,
    setSelectedShiftIds,
    toggleShiftSelection,
    clearSelection,
  } = useRosterUI();

  const selectedCount = selectedShiftIds.length;

  // ==================== SYNC SCOPE FILTER → ROSTER UI CONTEXT ====================
  // When the scope filter changes (user selects different dept/subdept), propagate
  // to the RosterUI context so data queries (which key off RosterUI state) re-fire.
  React.useEffect(() => {
    if (scope.org_ids.length > 0) {
      setSelectedOrganizationId(scope.org_ids[0]);
    }
  }, [scope.org_ids.join(',')]);

  React.useEffect(() => {
    setSelectedDepartmentIds(scope.dept_ids);
  }, [scope.dept_ids.join(',')]);

  React.useEffect(() => {
    setSelectedSubDepartmentIds(scope.subdept_ids);
  }, [scope.subdept_ids.join(',')])

  // ==================== CONTEXT STATE ====================
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null);

  // ==================== TEMPLATE DATE BOUNDS (for Ghost Cell navigation) ====================
  const [templateStartDate, setTemplateStartDate] = useState<Date | undefined>(undefined);
  const [templateEndDate, setTemplateEndDate] = useState<Date | undefined>(undefined);

  // ==================== TOGGLE STATES ====================
  // const [isLocked, setIsLocked] = useState(false); // REMOVED local state
  const [showAvailabilities, setShowAvailabilities] = useState(false);
  const [showUnfilledPanel, setShowUnfilledPanel] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // ==================== MODAL REF ====================
  // All modal open/close state lives in RosterModals; page calls imperative methods.
  const modalsRef = useRef<RosterModalsHandle>(null);

  const [dayZoom, setDayZoom] = useState<60>(60);

  // ==================== DERIVED ====================

  // ==================== DATE CALCULATION ====================
  // Use selectedDate as the start of the range (controlled by RosterFunctionBar)
  const dates = useMemo(() => {
    const arr: Date[] = [];
    switch (viewType) {
      case 'day':
        arr.push(selectedDate);
        break;
      case '3day':
        for (let i = 0; i < 3; i++) {
          arr.push(addDays(selectedDate, i));
        }
        break;
      case 'week': {
        // Use selectedDate as start (not startOfWeek to avoid crossing month boundary)
        for (let i = 0; i < 7; i++) {
          arr.push(addDays(selectedDate, i));
        }
        break;
      }
      case 'month': {
        const year = selectedDate.getFullYear();
        const month = selectedDate.getMonth();
        const firstOfMonth = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let i = 0; i < daysInMonth; i++) {
          arr.push(addDays(firstOfMonth, i));
        }
        break;
      }
    }
    return arr;
  }, [selectedDate, viewType]);

  // ==================== DATA LOADING (TanStack Query) ====================
  const queryFilters: ShiftFilters = useMemo(() => ({
    departmentIds: selectedDepartmentIds.length > 0 ? selectedDepartmentIds : undefined,
    subDepartmentIds: selectedSubDepartmentIds.length > 0 ? selectedSubDepartmentIds : undefined,
  }), [selectedDepartmentIds, selectedSubDepartmentIds]);

  // Calculate date range from dates array
  const startDate = useMemo(() =>
    dates.length > 0 ? format(dates[0], 'yyyy-MM-dd') : null
    , [dates]);

  const endDate = useMemo(() =>
    dates.length > 0 ? format(dates[dates.length - 1], 'yyyy-MM-dd') : null
    , [dates]);

  // ==================== BFF PREFETCH ====================
  // Single round-trip that seeds the shift list + lookup caches before the
  // individual hooks fire. On navigation back to this page the caches are
  // already warm — no waterfall of 5-7 separate network requests.
  useRosterViewPrefetch({
    orgId: selectedOrganizationId,
    startDate,
    endDate,
    deptIds: selectedDepartmentIds,
    subDeptIds: selectedSubDepartmentIds,
    shiftFilters: queryFilters,
  });

  // ==================== DELTA SYNC ====================
  // Subscribes to Realtime and applies surgical cache patches instead of
  // full list invalidations when shifts change in the background.
  useShiftDeltaSync({
    orgId: selectedOrganizationId,
    deptIds: selectedDepartmentIds.length > 0 ? selectedDepartmentIds : undefined,
    startDate,
    endDate,
  });

  // ==================== LOCK STATUS ====================
  // Fetch Rosters for Lock Status
  const { data: rosters = [] } = useRostersByDateRange(
    startDate || '',
    endDate || '',
    selectedDepartmentIds[0] || '',
    selectedOrganizationId || undefined,
    selectedSubDepartmentIds[0] || undefined
  );

  // Derive lock status from fetched rosters
  // LOCK FEATURE REMOVED - Always editable if permission allows
  const isLocked = false;
  const canEdit = hasPermission('update');

  // Query shifts for date range (supports day, week, month views)
  const {
    data: shifts = [],
    isLoading,
    isFetching: isRefreshing,
    refetch,
  } = useShiftsByDateRange(
    selectedOrganizationId,
    startDate,
    endDate,
    queryFilters
  );

  // Mutation hooks
  const bulkPublish = useBulkPublishShifts();
  const bulkDelete = useBulkDeleteShifts();
  const bulkAssign = useBulkAssignShifts();
  const bidShiftMutation = useAcceptOffer();
  const swapShiftMutation = useRequestTrade();
  const cancelShiftMutation = useCancelShift();
  const unpublishShiftMutation = useUnpublishShift();
  const bulkUnassign = useBulkUnassignShifts();
  const bulkUnpublishByHook = useBulkUnpublishShifts();


  // Employees lookup
  const { data: employees = [] } = useEmployees(
    selectedOrganizationId || undefined,
    selectedDepartmentIds[0] || undefined,
    selectedSubDepartmentIds[0] || undefined,
  );

  // Escape key exits bulk selection mode
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && bulkModeActive) {
        setBulkModeActive(false);
        clearSelection();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [bulkModeActive, setBulkModeActive, clearSelection]);

  // Roster structures for Group mode projection
  const { data: rosterStructures = [] } = useRosterStructure(
    selectedOrganizationId,
    startDate,
    endDate,
    {
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    }
  );

  // Lookup data for projections (stable TanStack Query cache refs)
  const { data: roles = [] } = useRoles(selectedOrganizationId || undefined, selectedDepartmentIds[0], selectedSubDepartmentIds[0]);
  const { data: levels = [] } = useRemunerationLevels();
  const { data: eventsData = [] } = useEvents(selectedOrganizationId || undefined);

  // ==================== PROJECTION ENGINE ====================
  const projection = useRosterProjections({
    shifts,
    employees,
    roles,
    levels,
    events: eventsData,
    rosterStructures,
  });

  // Derive unfilled shifts from cached query data
  const unfilledShifts: UnfilledShift[] = useMemo(() => {
    return shifts
      .filter((s: Shift) => !s.assigned_employee_id && !s.is_cancelled && !s.deleted_at)
      .map((s: Shift) => ({
        id: s.id,
        title: s.sub_group_name || 'Shift',
        role: (s as any).roles?.name || 'Unknown Role',
        department: (s as any).departments?.name || 'Unknown Dept',
        date: s.shift_date,
        start: s.start_time,
        end: s.end_time,
      }));
  }, [shifts]);

  // refreshKey REMOVED - Using React Query invalidation instead

  // ==================== VIEW TYPE HANDLER ====================
  const handleViewTypeChange = (nextView: ViewType) => {
    if (nextView === 'week') {
      setSelectedDate(startOfWeek(selectedDate, { weekStartsOn: 1 }));
      setViewType(nextView);
      return;
    }
    if (nextView === 'month') {
      setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
      setViewType(nextView);
      return;
    }
    // For day/3day, no change needed to selectedDate
    setViewType(nextView);
  };

  // ==================== MODAL HANDLERS ====================
  const handleAddShift = () => {
    const context: ShiftContext = {
      mode: activeMode as ShiftContext['mode'],
      launchSource: 'global', // Date will be editable
      date: format(selectedDate, 'yyyy-MM-dd'),
      organizationId: selectedOrganizationId || undefined,
      rosterId: selectedRosterId || undefined,
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    };
    modalsRef.current?.openAddShift(context);
  };

  const handleAddShiftWithGroup = (
    groupName: string,
    subGroupName: string,
    groupColor: string,
    date?: Date,
    rosterId?: string
  ) => {
    const context: ShiftContext = {
      mode: 'group',
      launchSource: 'grid', // Date will be locked
      date: format(date || selectedDate, 'yyyy-MM-dd'),
      organizationId: selectedOrganizationId || undefined,
      rosterId: rosterId || selectedRosterId || undefined,
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
      groupName,
      subGroupName,
      groupColor,
    };
    modalsRef.current?.openAddShift(context);
  };

  const handlePickUnfilled = (shift: UnfilledShift) => {
    const context: ShiftContext = {
      mode: 'group',
      launchSource: 'grid', // Date will be locked
      date: shift.date,
      organizationId: selectedOrganizationId || undefined,
      rosterId: selectedRosterId || undefined,
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    };
    modalsRef.current?.openAddShift(context);
  };

  const handleShiftCreated = () => {
    // Mutation hooks auto-invalidate; no manual refresh needed
    toast({
      title: 'Success',
      description: 'Shift created successfully.',
    });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    toast({
      title: 'Refreshed',
      description: 'Roster data has been refreshed.',
    });
  };


  // ==================== GHOST CELL NAVIGATION ====================
  // When user clicks a ghost cell, navigate to that month (reset to 1st of month)
  const handleNavigateToMonth = (date: Date) => {
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    setSelectedDate(firstOfMonth);
    toast({
      title: 'Switched Month',
      description: `Navigated to ${format(date, 'MMMM yyyy')}. Please select the template for this month.`,
    });
  };

  // ==================== BULK HANDLERS ====================
  const handleToggleShiftSelection = (shiftId: string) => {
    toggleShiftSelection(shiftId);
  };

  const handleClearSelection = () => {
    clearSelection();
  };

  const handleBulkModeToggle = (active: boolean) => {
    setBulkModeActive(active);
  };

  const selectedShiftsData = useMemo(() => {
    return shifts.filter(s => selectedShiftIds.includes(s.id));
  }, [shifts, selectedShiftIds]);

  const stateCounts = useMemo(() => {
    const counts = {
      assignedCount: 0,
      unassignedCount: 0,
      draftCount: 0,
      publishedCount: 0,
    };

    selectedShiftsData.forEach(s => {
      if (s.assigned_employee_id) counts.assignedCount++;
      else counts.unassignedCount++;

      if (s.lifecycle_status === 'Published') counts.publishedCount++;
      else counts.draftCount++;
    });

    return counts;
  }, [selectedShiftsData]);

  const handleSelectAll = () => {
    // visibleShifts depends on current filters and view. 
    // The `shifts` variable in this component is already filtered by date range and queryFilters.
    const visibleAndUnlockedIds = shifts
      .filter(s => !isShiftLocked(s.shift_date, s.start_time, 'roster_management'))
      .map(s => s.id);

    setBulkModeActive(true);
    setSelectedShiftIds(visibleAndUnlockedIds);
  };

  const handleBulkPublish = async (shiftIds: string[]) => {
    // Only target Draft shifts
    const draftIds = selectedShiftsData
      .filter(s => s.lifecycle_status !== 'Published')
      .map(s => s.id);

    if (draftIds.length === 0) return;

    try {
      const result = await bulkPublish.mutateAsync(draftIds);
      const count = (result as any).success_count ?? draftIds.length;
      const skipped = shiftIds.length - count;

      toast({
        title: 'Published',
        description: `Published ${count} shifts successfully.${skipped > 0 ? ` Skipped ${skipped} already published.` : ''}`,
      });
      clearSelection();
      setBulkModeActive(false);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to publish shifts', variant: 'destructive' });
    }
  };

  const handleBulkUnpublish = async (shiftIds: string[]) => {
    const publishedIds = selectedShiftsData
      .filter(s => s.lifecycle_status === 'Published')
      .map(s => s.id);

    if (publishedIds.length === 0) return;

    // We don't have a bulkUnpublish hook explicitly, but assume we can reuse logic or call individual unpublish in loop (not ideal)
    // Let's check if useBulkPublishShifts has a direction or if there's useBulkUnpublish.
    // Assuming for now we might need to implement bulk unpublish or call in loop if small count.
    
    try {
      await bulkUnpublishByHook.mutateAsync(publishedIds);
      
      toast({
        title: 'Unpublished',
        description: `Unpublished ${publishedIds.length} shifts.`,
      });
      clearSelection();
      setBulkModeActive(false);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to unpublish shifts', variant: 'destructive' });
    }
  };

  const handleBulkUnassign = async () => {
    const assignedIds = selectedShiftsData
      .filter(s => s.assigned_employee_id)
      .map(s => s.id);

    if (assignedIds.length === 0) return;

    try {
      await bulkUnassign.mutateAsync(assignedIds);
      
      toast({
        title: 'Unassigned',
        description: `Unassigned ${assignedIds.length} shifts successfully.`,
      });
      clearSelection();
      setBulkModeActive(false);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to unassign shifts', variant: 'destructive' });
    }
  };



  const handleBulkDelete = async () => {
    if (selectedShiftIds.length === 0) return;
    try {
      const successCount = await bulkDelete.mutateAsync(selectedShiftIds);

      if (successCount > 0) {
        toast({
          title: 'Deleted',
          description: `Deleted ${successCount} shifts.`,
        });
        clearSelection();
        setBulkModeActive(false);
      } else {
        toast({
          title: 'Delete Failed',
          description: "No shifts were deleted. They may have been lock or already removed.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to delete shifts', variant: 'destructive' });
    }
  };

  // ==================== EMPLOYEES WITH SHIFTS ====================
  // Legacy derivation (always called — hooks cannot be conditional)
  const legacyEmployeesWithShifts = usePeopleModeData({ employees, shifts });

  // When projection.people is available, adapt ProjectedEmployee → PeopleModeEmployee
  const GROUP_ACCENT: Record<string, string> = {
    convention_centre: 'blue',
    exhibition_centre: 'emerald',
    theatre: 'red',
  };
  const employeesWithShifts = useMemo((): PeopleModeEmployee[] => {
    if (projection.people) {
      return projection.people.employees.map((pe): PeopleModeEmployee => ({
        id: pe.id,
        name: pe.name,
        employeeId: pe.id.slice(0, 8),
        avatar: pe.avatarUrl,
        contractedHours: pe.contractedHours,
        currentHours: pe.scheduledHours,
        overHoursWarning: pe.overHoursWarning,
        shifts: Object.fromEntries(
          Object.entries(pe.shiftsByDate).map(([date, pShifts]) => [
            date,
            pShifts.map((ps): PeopleModeShift => ({
              id: ps.id,
              role: ps.roleName,
              remunerationLevel: ps.raw.remuneration_levels?.level_name ?? 'L1',
              startTime: ps.startTime,
              endTime: ps.endTime,
              department: ps.raw.group_type ?? 'General',
              subGroup: ps.subGroupName ?? '',
              group: ps.groupType ?? 'convention_centre',
              groupColor: GROUP_ACCENT[ps.groupType ?? ''] ?? 'blue',
              hours: ps.netMinutes / 60,
              pay: (ps.netMinutes / 60) * (ps.raw.remuneration_rate ?? 25),
              status: ps.employeeId ? (ps.isDraft ? 'Draft' : 'Assigned') : 'Open',
              lifecycleStatus: ps.isPublished ? 'published' : 'draft',
              assignmentStatus: ps.employeeId ? 'assigned' : 'unassigned',
              fulfillmentStatus: ps.raw.fulfillment_status,
              isTradeRequested: ps.isTrading,
              isCancelled: ps.isCancelled,
              rawShift: ps.raw,
            })),
          ])
        ),
      }));
    }
    return legacyEmployeesWithShifts;
  }, [projection.people, legacyEmployeesWithShifts]);

  // ==================== COMPUTED STATS (from projection engine) ====================
  const {
    assignedShifts: totalAssignedShifts,
    openShifts: totalUnfilledShifts,
    totalShifts,
    estimatedCost,
  } = projection.stats;
  const budget = 15000;
  const remainingBudget = budget - estimatedCost;

  // ==================== SINGLE SHIFT HANDLERS (via mutation hooks) ====================
  const handleBidShift = async (shiftId: string) => {
    try {
      await bidShiftMutation.mutateAsync(shiftId);
      toast({ title: 'Bid Placed', description: 'You have successfully bid on this shift.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to bid on shift', variant: 'destructive' });
    }
  };

  const handleSwapShift = async (shiftId: string) => {
    try {
      await swapShiftMutation.mutateAsync(shiftId);
      toast({ title: 'Trade Requested', description: 'Trade request submitted successfully.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to request trade', variant: 'destructive' });
    }
  };

  const handleCancelSingleShift = async (shiftId: string) => {
    try {
      await cancelShiftMutation.mutateAsync({ shiftId, reason: 'User initiated cancel' });
      toast({ title: 'Shift Cancelled', description: 'Shift has been cancelled.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to cancel shift', variant: 'destructive' });
    }
  };

  const handleUnpublishShift = async (shiftId: string) => {
    // Determine the shift from the collection to check for locking
    const shift = shifts.find(s => s.id === shiftId);
    if (shift && isShiftLocked(shift.shift_date, shift.start_time, 'roster_management')) {
      toast({
        title: 'Action Locked',
        description: 'Cannot unpublish a shift that has already started.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await unpublishShiftMutation.mutateAsync({ shiftId, reason: 'Unpublished via Roster' });
      toast({ title: 'Shift Unpublished', description: 'Shift reverted to Draft.' });
    } catch (error: any) {
      console.error(error);
      toast({ title: 'Error', description: error.message || 'Failed to unpublish shift', variant: 'destructive' });
    }
  };

  const handleEditShift = (shift: any) => {
    if (!canEdit) return;
    const rawShift = shift.rawShift || shift;

    modalsRef.current?.openEditShift(rawShift, {
      mode: activeMode,
      launchSource: 'edit',
      date: rawShift.shift_date,
      organizationId: rawShift.organization_id || selectedOrganizationId || undefined,
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
      rosterId: rawShift.roster_id || selectedRosterId || undefined,
      roleId: rawShift.role_id || undefined,
      employeeId: rawShift.assigned_employee_id || undefined,
      group_type: rawShift.group_type || undefined,
      sub_group_name: rawShift.sub_group_name || undefined,
    });
  };

  // ==================== RENDER ====================
  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50 dark:bg-[#030405] overflow-hidden">
      {/* Scope Filter */}
      <ScopeFilterBanner
        mode="managerial"
        onScopeChange={setScope}
        hidden={isGammaLocked}
        multiSelect={false}
        className="m-4 mb-2 relative z-[40]"
      />

      {/* Function Bar */}
      <div className="relative z-[10]">
        <RosterFunctionBar
          // Context state
          selectedOrganizationId={selectedOrganizationId}
          selectedRosterId={selectedRosterId}
          selectedDepartmentId={selectedDepartmentIds[0] || null}
          selectedSubDepartmentId={selectedSubDepartmentIds[0] || null}
          // Context callbacks
          onRosterChange={setSelectedRosterId}
          // Ghost Cell Navigation - receive template date bounds
          onTemplateDatesChange={(startDate, endDate) => {
            setTemplateStartDate(startDate);
            setTemplateEndDate(endDate);
          }}
          // Date & View
          selectedDate={selectedDate}
          viewType={viewType}
          onDateChange={setSelectedDate}
          onViewTypeChange={handleViewTypeChange}
          // Toggle states
          showAvailabilities={showAvailabilities}
          showUnfilledPanel={showUnfilledPanel}
          isRefreshing={isRefreshing}
          // Toggle callbacks
          onAvailabilitiesToggle={() => setShowAvailabilities(!showAvailabilities)}
          onUnfilledPanelToggle={() => setShowUnfilledPanel(!showUnfilledPanel)}
          onRefresh={handleRefresh}
          onFiltersClick={() => setShowFilters(!showFilters)}
          canEdit={canEdit}
          // Bulk Mode
          isBulkMode={bulkModeActive}
          onBulkModeToggle={() => handleBulkModeToggle(!bulkModeActive)}
          onAutoScheduleClick={() => modalsRef.current?.openAutoScheduler()}
        />
      </div>

      {/* Mode Selector row REMOVED - now integrated into FunctionBar */}

      {/* Bulk Mode Banner — sticky amber bar shown while bulk selection is active */}
      {bulkModeActive && (
        <div className="flex-shrink-0 bg-amber-500/10 border-b border-amber-500/30 px-6 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3 text-amber-700 dark:text-amber-300 text-sm font-medium">
            <span>Bulk selection active — click shifts to select</span>
            {selectedShiftIds.length > 0 && (
              <span className="bg-amber-500/20 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full text-xs font-bold">
                {selectedShiftIds.length} selected
              </span>
            )}
          </div>
          <button
            onClick={() => { setBulkModeActive(false); clearSelection(); }}
            className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
          >
            Press Esc to exit
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex relative">
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-2" />
              <p className="text-white/80 dark:text-white/80 font-medium">Loading shifts...</p>
            </div>
          </div>
        )}

        {/* Grid Area - Using global background/layout */}
        <div
          className={cn(
            'min-h-0 overflow-hidden transition-all duration-300 ease-in-out relative',
            showUnfilledPanel ? 'flex-1' : 'w-full'
          )}
        >
          {activeMode === 'people' && (
            <PeopleModeGrid

              employees={employeesWithShifts}
              dates={dates}
              canEdit={canEdit}
              showAvailabilities={showAvailabilities}
              bulkModeActive={bulkModeActive}
              selectedShifts={selectedShiftIds}
              onToggleShiftSelection={handleToggleShiftSelection}
              onAddShift={(employee, date) => {
                const context: ShiftContext = {
                  mode: 'people',
                  launchSource: 'grid', // Date will be locked
                  date: format(date || selectedDate, 'yyyy-MM-dd'),
                  organizationId: selectedOrganizationId || undefined,
                  rosterId: selectedRosterId || undefined,
                  departmentIds: selectedDepartmentIds,
                  subDepartmentIds: selectedSubDepartmentIds,
                  employeeId: employee?.id,
                };
                modalsRef.current?.openAddShift(context);
              }}
              onViewShift={(shift: EmployeeShift) => {
                handleEditShift(shift);
              }}
              onBidShift={handleBidShift}
              onSwapShift={handleSwapShift}
              onCancelShift={handleCancelSingleShift}
              onUnpublishShift={handleUnpublishShift}
              onViewAudit={(id) => modalsRef.current?.openAudit(id)}
            />
          )}

          {activeMode === 'group' && (
            <GroupModeView

              selectedDate={selectedDate}
              viewType={viewType}
              canEdit={canEdit}
              organizationId={selectedOrganizationId || undefined}
              organizationName={undefined} // TODO: Get from context
              rosterId={selectedRosterId || undefined}
              departmentId={selectedDepartmentIds[0] || undefined}
              departmentName={undefined} // TODO: Get from RosterFunctionBar
              subDepartmentId={selectedSubDepartmentIds[0] || undefined}
              subDepartmentName={undefined}
              // Ghost Cell Navigation props
              templateStartDate={templateStartDate}
              templateEndDate={templateEndDate}
              onNavigateToMonth={handleNavigateToMonth}
              onAddShift={handleAddShiftWithGroup}
              // Bulk Mode
              isBulkMode={bulkModeActive}
              onBulkModeToggle={handleBulkModeToggle}
              selectedShiftIds={selectedShiftIds}
              // Day zoom
              dayZoom={dayZoom}
              // Data from unified hook
              shifts={shifts}
              isShiftsLoading={isLoading}
              showLegend={true}
              projection={projection.group ?? undefined}
            />
          )}

          {activeMode === 'events' && (
            <EventsModeView

              selectedDate={selectedDate}
              viewType={viewType}
              shifts={shifts}
              isShiftsLoading={isLoading}
              organizationId={selectedOrganizationId || undefined}
              projection={projection.events ?? undefined}
              onEditShift={handleEditShift}
            />
          )}

          {activeMode === 'roles' && (
            <RolesModeView
              selectedDate={selectedDate}
              viewType={viewType}
              canEdit={canEdit}
              organizationId={selectedOrganizationId || undefined}
              departmentIds={selectedDepartmentIds}
              subDepartmentIds={selectedSubDepartmentIds}
              rosterId={selectedRosterId || undefined}
              shifts={shifts}
              projection={projection.roles ?? undefined}
              onEditShift={handleEditShift}
              selectedShiftIds={selectedShiftIds}
            />
          )}
        </div>

        {/* Unfilled Shifts Panel */}
        <div
          className={cn(
            'min-h-0 overflow-hidden border-l border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/10 backdrop-blur-md transition-all duration-300 ease-in-out',
            showUnfilledPanel ? 'w-80' : 'w-0 border-l-0'
          )}
        >
          <div
            className={cn(
              'w-80 h-full overflow-auto transition-opacity duration-300',
              showUnfilledPanel ? 'opacity-100' : 'opacity-0'
            )}
          >
            <UnfilledShiftsPanel
              unfilledShifts={unfilledShifts}
              onPickShift={handlePickUnfilled}
            />
          </div>
        </div>
      </div>

      {/* Bulk Toolbar */}
      {bulkModeActive && selectedShiftIds.length > 0 && (
        <BulkActionsToolbar
          selectedCount={selectedCount}
          selectedShiftIds={selectedShiftIds}
          stateCounts={stateCounts}
          onClearSelection={handleClearSelection}
          onSelectAll={handleSelectAll}
          onDelete={handleBulkDelete}
          onPublish={handleBulkPublish}
          onUnpublish={handleBulkUnpublish}
          onAssign={() => modalsRef.current?.openBulkAssign()}
          onUnassign={handleBulkUnassign}
          allowedActions={{
            canPublish: stateCounts.draftCount > 0,
            canUnpublish: stateCounts.publishedCount > 0,
          }}
        />
      )}

      {/* Modals (audit, add/edit shift, bulk assign, auto-scheduler) */}
      <RosterModals
        ref={modalsRef}
        selectedShiftIds={selectedShiftIds}
        employees={employees.map((e) => ({
          id: e.id,
          name: `${e.first_name} ${e.last_name}`.trim() || e.id,
          avatarUrl: (e as any).avatar_url ?? undefined,
          role: (e as any).role_name ?? undefined,
        }))}
        autoSchedulerShifts={shifts
          .filter((s) => !s.assigned_employee_id && !s.is_cancelled && !s.deleted_at)
          .map((s) => ({
            id: s.id,
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            role_id: (s as any).role_id ?? null,
            unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
          }))}
        autoSchedulerEmployees={employees.map((e) => ({
          id: e.id,
          name: `${e.first_name} ${e.last_name}`.trim() || e.id,
        }))}
        onShiftSaved={handleShiftCreated}
        onAssignComplete={() => { clearSelection(); setBulkModeActive(false); }}
        onAutoScheduleComplete={() => {}}
      />

      {/* Footer Summary */}
      <div className="border-t border-slate-200 dark:border-white/5 bg-white dark:bg-black/20 backdrop-blur-md px-6 py-3 flex-shrink-0">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between text-sm gap-3">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-muted-foreground/60">Total Shifts:</span>
              <span className="ml-2 font-medium text-foreground">{totalShifts}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-slate-200 dark:bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Assigned:</span>
              <span className="ml-2 font-medium text-emerald-400">{totalAssignedShifts}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-slate-200 dark:bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Unfilled:</span>
              <span className="ml-2 font-medium text-amber-400">{totalUnfilledShifts}</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Redundant Auto-Schedule button removed (now in Function Bar) */}
            <div>
              <span className="text-muted-foreground/60">Est. Cost:</span>
              <span className="ml-2 font-medium text-foreground">${estimatedCost.toFixed(2)}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-slate-200 dark:bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Budget:</span>
              <span className="ml-2 font-medium text-foreground">${budget.toFixed(2)}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-slate-200 dark:bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Remaining:</span>
              <span
                className={cn(
                  'ml-2 font-medium',
                  remainingBudget >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                ${remainingBudget.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewRostersPage;
