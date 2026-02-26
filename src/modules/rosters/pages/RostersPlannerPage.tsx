import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfWeek } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/modules/core/ui/primitives/toggle-group';
import { Calendar, Users, CalendarDays, Briefcase } from 'lucide-react';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { cn } from '@/modules/core/lib/utils';

// Components
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
import {
  EnhancedAddShiftModal,
  ShiftContext,
} from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import { BulkActionsToolbar } from '@/modules/rosters/ui/components/BulkActionsToolbar';

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
  useAcceptOffer,
  useRequestTrade,
  useCancelShift,
  useUnpublishShift,
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
  } = useRosterUI();

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

  // ==================== MODAL & BULK STATE ====================
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [addShiftContext, setAddShiftContext] = useState<ShiftContext | null>(null);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editShiftData, setEditShiftData] = useState<any>(null);
  const [editShiftContext, setEditShiftContext] = useState<ShiftContext | null>(null);

  const [bulkModeActive, setBulkModeActive] = useState(false);
  const [selectedShifts, setSelectedShifts] = useState<string[]>([]);

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

  // ==================== LOCK STATUS ====================
  // Fetch Rosters for Lock Status
  const { data: rosters = [] } = useRostersByDateRange(
    startDate || '',
    endDate || '',
    selectedDepartmentIds[0] || ''
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

  // Roster Actions

  const publishRosterMutation = usePublishRoster();


  // Employees lookup
  const { data: employees = [] } = useEmployees(selectedOrganizationId || undefined);

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
    setAddShiftContext(context);
    setIsAddShiftOpen(true);
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
    setAddShiftContext(context);
    setIsAddShiftOpen(true);
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
    setAddShiftContext(context);
    setIsAddShiftOpen(true);
  };

  const handleShiftCreated = () => {
    // Mutation hooks auto-invalidate; no manual refresh needed
    toast({
      title: 'Success',
      description: 'Shift created successfully.',
    });
  };

  const handleRefresh = () => {
    refetch();
  };

  const handlePublishRoster = async () => {
    if (!startDate || !endDate || !selectedOrganizationId || !selectedDepartmentIds[0]) {
      toast({ title: "Error", description: "Missing required selection details", variant: "destructive" });
      return;
    }

    try {
      await publishRosterMutation.mutateAsync({
        organizationId: selectedOrganizationId,
        departmentId: selectedDepartmentIds[0],
        subDepartmentId: selectedSubDepartmentIds[0] || null,
        startDate,
        endDate
      });
      // Toast is handled in mutation onSuccess
    } catch (error) {
      // Error handled in mutation onError
    }
  };

  // Lock toggle handler removed

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
    setSelectedShifts((prev) =>
      prev.includes(shiftId)
        ? prev.filter((id) => id !== shiftId)
        : [...prev, shiftId]
    );
  };



  const handleBulkPublish = async (shiftIds: string[]) => {
    try {
      const result = await bulkPublish.mutateAsync(shiftIds);

      // result matches { success_count: number, failure_count: number, results: ... }
      // but type might be inferred as 'any' or the shape from commands.
      // We'll safely access it.
      const count = (result as any).success_count ?? shiftIds.length;

      toast({
        title: 'Published',
        description: `Published ${count} shifts successfully.`,
      });
      setSelectedShifts([]);
      setBulkModeActive(false);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to publish shifts', variant: 'destructive' });
    }
  };



  const handleBulkDelete = async () => {
    if (selectedShifts.length === 0) return;
    try {
      const successCount = await bulkDelete.mutateAsync(selectedShifts);

      if (successCount > 0) {
        toast({
          title: 'Deleted',
          description: `Deleted ${successCount} shifts.`,
        });
        setSelectedShifts([]);
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
    try {
      await unpublishShiftMutation.mutateAsync({ shiftId, reason: 'Unpublished via Roster' });
      toast({ title: 'Shift Unpublished', description: 'Shift reverted to Draft.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to unpublish shift', variant: 'destructive' });
    }
  };

  const handleEditShift = (shift: any) => {
    if (!canEdit) return;
    const rawShift = shift.rawShift || shift;

    setEditShiftContext({
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
    setEditShiftData(rawShift);
    setIsEditModalOpen(true);
  };

  // ==================== RENDER ====================
  return (
    <div className="flex flex-col h-full min-h-0 bg-[#030405] overflow-hidden">
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
          // Actions
          onPublishRoster={handlePublishRoster}
          canEdit={canEdit}
          // Bulk Mode
          isBulkMode={bulkModeActive}
          onBulkModeToggle={() => setBulkModeActive(!bulkModeActive)}
        />
      </div>

      {/* Mode Selector row REMOVED - now integrated into FunctionBar */}

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex relative">
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-2" />
              <p className="text-white/80 font-medium">Loading shifts...</p>
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
              selectedShifts={selectedShifts}
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
                setAddShiftContext(context);
                setIsAddShiftOpen(true);
              }}
              onViewShift={(shift: EmployeeShift) => {
                handleEditShift(shift);
              }}
              onBidShift={handleBidShift}
              onSwapShift={handleSwapShift}
              onCancelShift={handleCancelSingleShift}
              onUnpublishShift={handleUnpublishShift}
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
              onBulkModeToggle={setBulkModeActive}
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
            />
          )}
        </div>

        {/* Unfilled Shifts Panel */}
        <div
          className={cn(
            'min-h-0 overflow-hidden border-l border-white/5 bg-black/10 backdrop-blur-md transition-all duration-300 ease-in-out',
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

      {/* Shift Modal */}
      <EnhancedAddShiftModal
        isOpen={isAddShiftOpen}
        onClose={() => setIsAddShiftOpen(false)}
        onSuccess={handleShiftCreated}
        context={addShiftContext}
      />

      <EnhancedAddShiftModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSuccess={handleShiftCreated}
        context={editShiftContext}
        editMode={true}
        existingShift={editShiftData}
      />

      {/* Bulk Toolbar */}
      {bulkModeActive && selectedShifts.length > 0 && (
        <BulkActionsToolbar
          selectedCount={selectedShifts.length}
          selectedShiftIds={selectedShifts}
          onClearSelection={() => setSelectedShifts([])}

          onDelete={handleBulkDelete}
          onPublish={handleBulkPublish}
          allowedActions={{
            canPublish: true,
          }}
        />
      )}

      {/* Footer Summary */}
      <div className="border-t border-white/5 bg-black/20 backdrop-blur-md px-6 py-3 flex-shrink-0">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between text-sm gap-3">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-muted-foreground/60">Total Shifts:</span>
              <span className="ml-2 font-medium text-foreground">{totalShifts}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Assigned:</span>
              <span className="ml-2 font-medium text-emerald-400">{totalAssignedShifts}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Unfilled:</span>
              <span className="ml-2 font-medium text-amber-400">{totalUnfilledShifts}</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div>
              <span className="text-muted-foreground/60">Est. Cost:</span>
              <span className="ml-2 font-medium text-foreground">${estimatedCost.toFixed(2)}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-white/10" />
            <div>
              <span className="text-muted-foreground/60">Budget:</span>
              <span className="ml-2 font-medium text-foreground">${budget.toFixed(2)}</span>
            </div>
            <Separator orientation="vertical" className="h-4 hidden md:block bg-white/10" />
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
