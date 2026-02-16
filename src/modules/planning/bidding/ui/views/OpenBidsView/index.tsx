import React, { useState, useMemo } from 'react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { supabase } from '@/platform/realtime/client';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';

// Types
import type { FilterState, EmployeeBid } from './types';

// Utils
import { filterShifts, getStatusCounts } from './utils';

// Hooks
import { useHierarchyData } from './useHierarchyData';
import { useOpenShifts } from './useOpenShifts';
import { useShiftBids } from './useShiftBids';
import { useTimeTicker } from './useTimeTicker';

// Components
import { FunctionBar } from './FunctionBar';
import { ShiftsList } from './ShiftsList';
import { ShiftDetailsHeader } from './ShiftDetailsHeader';
import { BidsList } from './BidsList';
import { EmptySelectionState } from './EmptySelectionState';


export const OpenBidsView: React.FC = () => {
  const { toast } = useToast();
  const orgSelection = useOrgSelection();

  // Time ticker for updating countdown displays
  useTimeTicker(60000);

  // State
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>({
    orgId: '',
    deptId: '',
    subDeptId: '',
    status: 'all',
  });
  const [isBulkMode, setIsBulkMode] = useState(false);

  // Sync filters with OrgSelectionContext
  React.useEffect(() => {
    if (!orgSelection.organizationId) return;

    setFilters(prev => {
      let newFilters = { ...prev };
      let changed = false;

      if (orgSelection.organizationId && newFilters.orgId !== orgSelection.organizationId) {
        newFilters.orgId = orgSelection.organizationId;
        changed = true;
      }

      // Use the selected/locked department from context
      if (orgSelection.departmentId && newFilters.deptId !== orgSelection.departmentId) {
        newFilters.deptId = orgSelection.departmentId;
        changed = true;
      } else if (!orgSelection.departmentId && newFilters.deptId) {
        newFilters.deptId = '';
        changed = true;
      }

      // Use the selected/locked subdepartment from context
      if (orgSelection.subDepartmentId && newFilters.subDeptId !== orgSelection.subDepartmentId) {
        newFilters.subDeptId = orgSelection.subDepartmentId;
        changed = true;
      } else if (!orgSelection.subDepartmentId && newFilters.subDeptId) {
        newFilters.subDeptId = '';
        changed = true;
      }

      return changed ? newFilters : prev;
    });
  }, [orgSelection.organizationId, orgSelection.departmentId, orgSelection.subDepartmentId]);

  // Locking is managed by OrgSelectionContext based on access level
  const isOrgLocked = orgSelection.isOrgLocked;
  const isDeptLocked = orgSelection.isDeptLocked;
  const isSubDeptLocked = orgSelection.isSubDeptLocked;

  // Data fetching hooks
  const { organizations, departments, subDepartments } = useHierarchyData();
  // Pass organizationId from context to scope the query
  const { shifts, setShifts, isLoading: isLoadingShifts } = useOpenShifts(orgSelection.organizationId || undefined);
  const { bids, isLoading: isLoadingBids, refetch: refetchBids } = useShiftBids(selectedShiftId);

  // Computed values
  const filteredShifts = useMemo(
    () => filterShifts(shifts, searchQuery, filters),
    [shifts, searchQuery, filters]
  );

  const statusCounts = useMemo(() => getStatusCounts(shifts), [shifts]);

  const selectedShift = useMemo(
    () => shifts.find((s) => s.id === selectedShiftId),
    [shifts, selectedShiftId]
  );

  // Handlers
  const handleAssign = async (bid: EmployeeBid) => {
    if (!selectedShiftId) return;

    try {
      const { error } = await (supabase as any).rpc('sm_select_bid_winner', {
        p_shift_id: selectedShiftId,
        p_winner_id: bid.employeeId,
        p_user_id: (await supabase.auth.getUser()).data.user?.id
      });

      if (error) throw error;

      toast({
        title: "Shift Assigned",
        description: `Successfully assigned to ${bid.employeeName}.`
      });

      // Optimistic update: remove shift from list
      if (setShifts) {
        setShifts(prev => prev.filter(s => s.id !== selectedShiftId));
      }
      setSelectedShiftId(null);

    } catch (error: any) {
      console.error('Assign error:', error);
      toast({
        title: "Assignment Failed",
        description: error.message || "Failed to assign shift",
        variant: "destructive"
      });
    }
  };

  const handleWithdraw = async () => {
    if (!selectedShiftId) return;
    try {
      const { error } = await (supabase as any).rpc('sm_close_bidding', {
        p_shift_id: selectedShiftId,
        p_user_id: (await supabase.auth.getUser()).data.user?.id,
        p_reason: 'Manager withdrew from bidding'
      });

      if (error) throw error;

      toast({
        title: "Shift Withdrawn",
        description: "Shift has been reverted to draft and removed from bidding."
      });

      // Optimistic update
      if (setShifts) {
        setShifts(prev => prev.filter(s => s.id !== selectedShiftId));
      }
      setSelectedShiftId(null);

    } catch (error: any) {
      console.error('Withdraw error:', error);
      toast({
        title: "Withdraw Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const toggleBulkMode = () => setIsBulkMode((prev) => !prev);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-[#0d1424]">


      {/* Function Bar */}
      <FunctionBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filters={filters}
        setFilters={setFilters}
        organizations={organizations}
        departments={departments}
        subDepartments={subDepartments}
        isBulkMode={isBulkMode}
        toggleBulkMode={toggleBulkMode}
        counts={statusCounts}
        isOrgLocked={isOrgLocked}
        isDeptLocked={isDeptLocked}
        isSubDeptLocked={isSubDeptLocked}
      />

      {/* Main Content: Split Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Shifts List */}
        <ShiftsList
          shifts={filteredShifts}
          isLoading={isLoadingShifts}
          selectedShiftId={selectedShiftId}
          onSelectShift={setSelectedShiftId}
        />

        {/* Right Panel: Details & Bids */}
        <div className="flex-1 flex flex-col bg-[#0d1424] relative">
          {selectedShift ? (
            <>
              <ShiftDetailsHeader shift={selectedShift} onWithdraw={handleWithdraw} />
              <BidsList bids={bids} isLoading={isLoadingBids} onAssign={handleAssign} />
            </>
          ) : (
            <EmptySelectionState />
          )}
        </div>
      </div>
    </div>
  );
};

export default OpenBidsView;
