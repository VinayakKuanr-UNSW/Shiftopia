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
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useEffect } from 'react';
import { getStatusDotInfo } from '@/modules/rosters/domain/shift-ui';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';


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

            clockIn: formatClockDisplay(shift.clockIn),
            clockOut: formatClockDisplay(shift.clockOut),

            adjustedStart: shift.adjustedStart,
            adjustedEnd: shift.adjustedEnd,
            isAdjustedManual: shift.isAdjustedManual,

            length: formatMinutes(shift.scheduledLengthMinutes),
            paidBreak: String(shift.paidBreakMinutes),
            unpaidBreak: String(shift.unpaidBreakMinutes),
            netLength: formatMinutes(shift.netLengthMinutes),

            approximatePay: shift.estimatedPay ? `$${shift.estimatedPay.toFixed(2)}` : '-',
            differential: '0.00',

            liveStatus: shift.lifecycleStatus || shift.shiftStatus || 'Active',
            timesheetStatus: shift.timesheetStatus?.toUpperCase() || 'DRAFT',
            attendanceStatus: shift.attendanceStatus || null,
            varianceMinutes: shift.varianceMinutes ?? null,
            // Adjusted-vs-Actual delta: how much did the manager's billable time differ
            // from the raw GPS clock-in? (positive = adjusted later than actual)
            adjustedVarianceMinutes: (() => {
                if (!shift.adjustedStart || !shift.clockIn) return null;
                // adjustedStart is HH:MM; clockIn may be ISO or HH:MM
                const parseHHMM = (val: string): number | null => {
                    const t = val.includes('T') ? val.split('T')[1] : val;
                    const [h, m] = t.split(':').map(Number);
                    if (isNaN(h) || isNaN(m)) return null;
                    return h * 60 + m;
                };
                const adjMins = parseHHMM(shift.adjustedStart);
                const actMins = parseHHMM(shift.clockIn);
                if (adjMins === null || actMins === null) return null;
                return adjMins - actMins;
            })(),
            statusDot: getStatusDotInfo({
                lifecycle_status: shift.lifecycleStatus,
                assignment_outcome: shift.attendanceStatus,
                attendance_status: shift.attendanceStatus,
                actual_start: shift.clockIn,
                actual_end: shift.clockOut,
                start_at: shift.rawStartAt,
                end_at: shift.rawEndAt,
                shift_date: shift.shiftDate,
                start_time: shift.scheduledStart,
                end_time: shift.scheduledEnd
            }),
            rawActualStart: shift.clockIn,
            rawActualEnd: shift.clockOut,
            notes: shift.notes || null,
            rejectedReason: shift.rejectedReason || null,
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
                notes: updates.notes,
                rejectedReason: updates.rejectedReason,
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

/**
 * Format a clock value which may be:
 *  - null / '-'          → '-'
 *  - ISO datetime string → '11:30 AM'  (from actual_start / start_at)
 *  - HH:MM[:SS] string  → '11:30 AM'  (from timesheet.clock_in)
 */
function formatClockDisplay(value: string | null | undefined): string {
    if (!value || value === '-') return '-';
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
        return format(d, 'h:mm a');
    }
    // Plain time string HH:MM or HH:MM:SS
    const parts = value.split(':').map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const h = parts[0];
        const m = parts[1];
        return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    return value;
}

export default TimesheetPageInner;
