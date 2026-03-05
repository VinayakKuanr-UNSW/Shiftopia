import React, { useState, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { TimesheetHeader } from './components/TimesheetHeader';
import { TimesheetTable } from './components/TimesheetTable';
import {
    getShiftsForTimesheet,
    updateTimesheetEntry,
    bulkUpdateTimesheetStatus,
    TimesheetShiftRow,
    TimesheetFilters,
} from '../api/timesheets.supabase.api';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useEffect } from 'react';

const TimesheetPageInner: React.FC = () => {
    // Scope filter — single-select like rosters
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');

    // Derived IDs from scope
    const selectedOrganizationId = scope.org_ids?.[0] || null;
    const selectedDepartmentId = scope.dept_ids?.[0] || null;
    const selectedSubDepartmentId = scope.subdept_ids?.[0] || null;

    // Date and view state
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [viewMode, setViewMode] = useState<'table' | 'group'>('table');

    // Secondary filters
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [groupTypeFilter, setGroupTypeFilter] = useState('all');
    const [subGroupFilter, setSubGroupFilter] = useState('all');
    const [tierFilter, setTierFilter] = useState('all');

    // Data state
    const [shifts, setShifts] = useState<TimesheetShiftRow[]>([]);
    const [loading, setLoading] = useState(false);

    const { toast } = useToast();
    const { hasPermission, user } = useAuth();
    const { theme } = useTheme();

    // Load shifts when filters change
    const loadShifts = useCallback(async () => {
        if (!selectedOrganizationId) return;

        setLoading(true);
        try {
            const dateString = format(selectedDate, 'yyyy-MM-dd');
            const filters: TimesheetFilters = {
                organizationId: selectedOrganizationId,
                departmentId: selectedDepartmentId,
                subDepartmentId: selectedSubDepartmentId,
                searchQuery: searchQuery || undefined,
                shiftStatus: statusFilter || undefined,
                groupType: groupTypeFilter !== 'all' ? groupTypeFilter : undefined,
                roleId: roleFilter !== 'all' ? roleFilter : undefined,
            };

            const data = await getShiftsForTimesheet(dateString, filters);
            setShifts(data);
        } catch (error) {
            console.error('Error loading shifts:', error);
            toast({
                title: 'Error loading data',
                description: 'Failed to load timesheet data. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }, [selectedDate, selectedOrganizationId, selectedDepartmentId, selectedSubDepartmentId,
        searchQuery, statusFilter, groupTypeFilter, roleFilter, toast]);

    useEffect(() => {
        if (selectedOrganizationId) {
            loadShifts();
        }
    }, [loadShifts, selectedOrganizationId]);

    // Transform shifts to table entries format
    const entries = useMemo(() => {
        return shifts.map(shift => ({
            id: shift.id,
            shiftId: shift.shiftId,

            date: shift.shiftDate,
            employeeId: shift.employeeId || 'N/A',
            employee: shift.employeeName,

            // Now removed from table (in global filter)
            organization: shift.organizationName,
            department: shift.departmentName,
            subDepartment: shift.subDepartmentName,

            group: shift.groupType || 'General',
            subGroup: shift.subGroupName || 'General',
            role: shift.roleName,
            remunerationLevel: shift.remunerationLevel,

            scheduledStart: shift.scheduledStart,
            scheduledEnd: shift.scheduledEnd,

            clockIn: shift.clockIn || '-',
            clockOut: shift.clockOut || '-',

            adjustedStart: shift.adjustedStart || shift.scheduledStart,
            adjustedEnd: shift.adjustedEnd || shift.scheduledEnd,

            length: formatMinutes(shift.scheduledLengthMinutes),
            paidBreak: String(shift.paidBreakMinutes),
            unpaidBreak: String(shift.unpaidBreakMinutes),
            netLength: formatMinutes(shift.netLengthMinutes),

            approximatePay: shift.estimatedPay ? `$${shift.estimatedPay.toFixed(2)}` : '-',
            differential: '0.00',

            liveStatus: shift.lifecycleStatus || shift.shiftStatus || 'Active',
            timesheetStatus: shift.timesheetStatus?.toUpperCase() || 'DRAFT',
        }));
    }, [shifts]);

    // Calculate active filter count
    const activeFilterCount = [
        searchQuery ? 1 : 0,
        groupTypeFilter !== 'all' ? 1 : 0,
        subGroupFilter !== 'all' ? 1 : 0,
        roleFilter !== 'all' ? 1 : 0,
        tierFilter !== 'all' ? 1 : 0,
        statusFilter ? 1 : 0
    ].reduce((a, b) => a + b, 0);

    const handleRefresh = async () => {
        await loadShifts();
        toast({
            title: 'Timesheets refreshed',
            description: 'Latest timesheet data has been loaded.',
        });
    };

    const handleExportPDF = () => {
        toast({
            title: 'Exporting as PDF',
            description: 'Your timesheet data is being prepared for PDF download.',
        });
    };

    const handleExportSpreadsheet = () => {
        toast({
            title: 'Exporting as Spreadsheet',
            description: 'Your timesheet data is being prepared for spreadsheet download.',
        });
    };

    const handleClearFilters = () => {
        setSearchQuery('');
        setGroupTypeFilter('all');
        setSubGroupFilter('all');
        setRoleFilter('all');
        setTierFilter('all');
        setStatusFilter(null);
        toast({
            title: 'Filters cleared',
            description: 'All filters have been reset.',
        });
    };

    const handleSaveEntry = async (id: string, updates: any) => {
        try {
            const success = await updateTimesheetEntry(id, {
                adjustedStart: updates.adjustedStart,
                adjustedEnd: updates.adjustedEnd,
                clockIn: updates.clockIn,
                clockOut: updates.clockOut,
                status: updates.timesheetStatus?.toLowerCase(),
            });

            if (success) {
                toast({
                    title: 'Entry Updated',
                    description: 'Timesheet entry has been updated successfully.',
                });
                await loadShifts();
            } else {
                throw new Error('Update failed');
            }
        } catch (error: any) {
            toast({
                title: 'Update Failed',
                description: error.message || 'Failed to update timesheet entry.',
                variant: 'destructive',
            });
        }
    };

    const handleBulkAction = async (ids: string[], action: 'approve' | 'reject') => {
        if (ids.length === 0) {
            toast({
                title: 'No Entries Selected',
                description: 'Please select at least one entry to perform this action.',
                variant: 'destructive'
            });
            return;
        }

        try {
            const result = await bulkUpdateTimesheetStatus(
                ids,
                action === 'approve' ? 'approved' : 'rejected',
                user?.id || ''
            );

            toast({
                title: `Entries ${action === 'approve' ? 'Approved' : 'Rejected'}`,
                description: `${result.success} entries updated successfully.${result.failed > 0 ? ` ${result.failed} failed.` : ''}`,
            });

            await loadShifts();
        } catch (error: any) {
            toast({
                title: 'Bulk Action Failed',
                description: error.message || `Failed to ${action} some entries.`,
                variant: 'destructive',
            });
        }
    };

    const getContainerBgClass = () => {
        return 'bg-card border-border shadow-2xl';
    };

    return (
        <div className="p-4 md:p-6 lg:p-8 max-w-full min-h-screen bg-transparent">
            <ScopeFilterBanner
                mode="managerial"
                onScopeChange={setScope}
                hidden={isGammaLocked}
                multiSelect={false}
                className="mb-6"
            />
            <div className={`rounded-[2rem] p-6 md:p-8 border ${getContainerBgClass()} transition-all duration-300`}>
                <TimesheetHeader
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    onViewChange={setViewMode}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                    onExportPDF={handleExportPDF}
                    onExportSpreadsheet={handleExportSpreadsheet}
                    onRefresh={handleRefresh}
                    isRefreshing={loading}
                    // Secondary filters
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    departmentFilter={groupTypeFilter}
                    setDepartmentFilter={setGroupTypeFilter}
                    subGroupFilter={subGroupFilter}
                    setSubGroupFilter={setSubGroupFilter}
                    roleFilter={roleFilter}
                    setRoleFilter={setRoleFilter}
                    tierFilter={tierFilter}
                    setTierFilter={setTierFilter}
                    onClearFilters={handleClearFilters}
                    activeFilterCount={activeFilterCount}
                />

                <TimesheetTable
                    entries={entries}
                    selectedDate={selectedDate}
                    readOnly={!hasPermission('update')}
                    statusFilter={statusFilter}
                    viewMode={viewMode}
                    onViewChange={setViewMode}
                    searchQuery={searchQuery}
                    departmentFilter={groupTypeFilter}
                    subGroupFilter={subGroupFilter}
                    roleFilter={roleFilter}
                    tierFilter={tierFilter}
                    onSaveEntry={handleSaveEntry}
                    onBulkAction={handleBulkAction}
                />
            </div>
        </div>
    );
};

function formatMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
}

export default TimesheetPageInner;
