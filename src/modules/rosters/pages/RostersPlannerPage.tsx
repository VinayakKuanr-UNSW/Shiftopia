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
import PeopleModeGrid from '@/modules/rosters/ui/modes/PeopleModeGrid';
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
import { useRosterUI, RosterMode, CalendarView } from '@/modules/rosters/contexts/RosterUIContext';
import {
  Shift,
} from '@/modules/rosters/api/shifts.api';
import {
  useShiftsByDateRange,
  useEmployees,
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
  useBulkAssignShifts,
  useBulkPublishShifts,
  useBulkDeleteShifts,
  useAcceptOffer,
  useRequestTrade,
  useCancelShift,
} from '@/modules/rosters/state/useRosterShifts';
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
  const [isLocked, setIsLocked] = useState(false);
  const [showAvailabilities, setShowAvailabilities] = useState(false);
  const [showUnfilledPanel, setShowUnfilledPanel] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  // ==================== MODAL & BULK STATE ====================
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [addShiftContext, setAddShiftContext] = useState<ShiftContext | null>(null);
  const [bulkModeActive, setBulkModeActive] = useState(false);
  const [selectedShifts, setSelectedShifts] = useState<string[]>([]);

  // ==================== DERIVED ====================
  const canEdit = hasPermission('update') && !isLocked;

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

  // Employees lookup
  const { data: employees = [] } = useEmployees(selectedOrganizationId || undefined);

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
    // No change to date for other views
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

  const handlePublishRoster = () => {
    toast({
      title: 'Publish Roster',
      description: 'This will publish the roster to all employees.',
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
    setSelectedShifts((prev) =>
      prev.includes(shiftId)
        ? prev.filter((id) => id !== shiftId)
        : [...prev, shiftId]
    );
  };



  const handleBulkPublish = async (shiftIds: string[]) => {
    try {
      await bulkPublish.mutateAsync(shiftIds);
      toast({
        title: 'Published',
        description: `Published ${shiftIds.length} shifts successfully.`,
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
      await bulkDelete.mutateAsync(selectedShifts);
      toast({
        title: 'Deleted',
        description: `Deleted ${selectedShifts.length} shifts.`,
      });
      setSelectedShifts([]);
      setBulkModeActive(false);
    } catch (error) {
      console.error(error);
      toast({ title: 'Error', description: 'Failed to delete shifts', variant: 'destructive' });
    }
  };

  // ==================== EMPLOYEES WITH SHIFTS ====================
  const employeesWithShifts = usePeopleModeData({
    employees,
    shifts,
  });

  // ==================== COMPUTED STATS ====================
  const {
    totalAssignedShifts,
    totalUnfilledShifts,
    totalShifts,
    estimatedCost,
    budget,
    remainingBudget,
  } = useMemo(() => {
    const assigned = shifts.filter((s) => s.assigned_employee_id && !s.is_cancelled).length;
    const unfilled = shifts.filter((s) => !s.assigned_employee_id && !s.is_cancelled).length;
    const total = shifts.filter((s) => !s.is_cancelled).length;

    let estCost = 0;
    shifts.forEach((s) => {
      if (!s.is_cancelled) {
        const hours = (s.net_length_minutes || 0) / 60;
        const rate = s.remuneration_rate || 25;
        estCost += hours * rate;
      }
    });

    const budgetValue = 15000;
    const remaining = budgetValue - estCost;

    return {
      totalAssignedShifts: assigned,
      totalUnfilledShifts: unfilled,
      totalShifts: total,
      estimatedCost: estCost,
      budget: budgetValue,
      remainingBudget: remaining,
    };
  }, [shifts]);

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

  // ==================== RENDER ====================
  return (
    <div className="flex flex-col h-full min-h-0 bg-transparent">
      {/* Scope Filter */}
      <ScopeFilterBanner
        mode="managerial"
        onScopeChange={setScope}
        hidden={isGammaLocked}
        className="m-3 mb-0"
      />

      {/* Function Bar */}
      <RosterFunctionBar
        // Context state
        selectedOrganizationId={selectedOrganizationId}
        selectedRosterId={selectedRosterId}
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
        isLocked={isLocked}
        showAvailabilities={showAvailabilities}
        showUnfilledPanel={showUnfilledPanel}
        isRefreshing={isRefreshing}
        // Toggle callbacks
        onLockToggle={() => setIsLocked(!isLocked)}
        onAvailabilitiesToggle={() => setShowAvailabilities(!showAvailabilities)}
        onUnfilledPanelToggle={() => setShowUnfilledPanel(!showUnfilledPanel)}
        onRefresh={handleRefresh}
        onFiltersClick={() => setShowFilters(!showFilters)}
        // Actions
        onAddShift={handleAddShift}
        onPublishRoster={handlePublishRoster}
        canEdit={canEdit}
        // Bulk Mode
        isBulkMode={bulkModeActive}
        onBulkModeToggle={() => setBulkModeActive(!bulkModeActive)}
      />

      {/* Mode Selector - Compact */}
      <div className="flex-shrink-0 border-b border-white/5 bg-black/10 px-3 py-1.5 backdrop-blur-sm">
        <div className="flex justify-center">
          <ToggleGroup
            type="single"
            value={activeMode}
            onValueChange={(v) => v && setActiveMode(v as RosterMode)}
            className="inline-flex gap-1 p-1 rounded-lg bg-black/20 border border-white/5"
          >
            <ToggleGroupItem
              value="group"
              className="data-[state=on]:bg-primary/20 data-[state=on]:text-primary-foreground data-[state=on]:shadow-glow/20 px-3 py-1.5 h-auto text-xs font-medium transition-all hover:bg-white/5"
            >
              <Calendar className="h-3.5 w-3.5 mr-1.5" />
              Group
            </ToggleGroupItem>

            <ToggleGroupItem
              value="people"
              className="data-[state=on]:bg-primary/20 data-[state=on]:text-primary-foreground data-[state=on]:shadow-glow/20 px-3 py-1.5 h-auto text-xs font-medium transition-all hover:bg-white/5"
            >
              <Users className="h-3.5 w-3.5 mr-1.5" />
              People
            </ToggleGroupItem>

            <ToggleGroupItem
              value="events"
              className="data-[state=on]:bg-primary/20 data-[state=on]:text-primary-foreground data-[state=on]:shadow-glow/20 px-3 py-1.5 h-auto text-xs font-medium transition-all hover:bg-white/5"
            >
              <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
              Events
            </ToggleGroupItem>

            <ToggleGroupItem
              value="roles"
              className="data-[state=on]:bg-primary/20 data-[state=on]:text-primary-foreground data-[state=on]:shadow-glow/20 px-3 py-1.5 h-auto text-xs font-medium transition-all hover:bg-white/5"
            >
              <Briefcase className="h-3.5 w-3.5 mr-1.5" />
              Roles
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

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
                // TODO: Open shift details
              }}
              onBidShift={handleBidShift}
              onSwapShift={handleSwapShift}
              onCancelShift={handleCancelSingleShift}
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
              departmentIds={selectedDepartmentIds}
              departmentName={undefined} // TODO: Get from RosterFunctionBar
              subDepartmentIds={selectedSubDepartmentIds}
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
            />
          )}

          {activeMode === 'events' && (
            <EventsModeView

              selectedDate={selectedDate}
              viewType={viewType}
              shifts={shifts}
              isShiftsLoading={isLoading}
              organizationId={selectedOrganizationId || undefined}
            />
          )}

          {activeMode === 'roles' && (
            <RolesModeView

              selectedDate={selectedDate}
              viewType={viewType}
              canEdit={canEdit}
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
          onAssignAll={async (employeeId, shiftIds) => {
            await bulkAssign.mutateAsync({ employeeId, shiftIds });
            setSelectedShifts([]);
            setBulkModeActive(false);
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
