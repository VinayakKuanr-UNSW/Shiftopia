import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';

import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { TimesheetTable } from './components/TimesheetTable';
import {
    getShiftsForTimesheet,
    updateTimesheetEntry,
    bulkUpdateTimesheetStatus,
    TimesheetShiftRow,
    TimesheetFilters,
    markShiftAsNoShow,
} from '../api/timesheets.supabase.api';
import { useScopeFilter, ScopeMode } from '@/platform/auth/useScopeFilter';
import { getStatusDotInfo } from '@/modules/rosters/domain/shift-ui';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';

/**
 * TimesheetPage
 *
 * Owns: scope, date, search query, raw data fetch.
 * Categorical filters (group, subgroup, role, status) are managed inside TimesheetTable.
 */
export const TimesheetPage: React.FC = () => {
    const { isManagerOrAbove, hasPermission, user } = useAuth();

    const scopeMode: ScopeMode = isManagerOrAbove() ? 'managerial' : 'personal';
    const canEdit = hasPermission('timesheet-edit');

    const { scope, setScope, isGammaLocked } = useScopeFilter(scopeMode);

    const selectedOrganizationId = scope.org_ids?.[0] || null;
    const selectedDepartmentId   = scope.dept_ids?.[0] || null;
    const selectedSubDepartmentId = scope.subdept_ids?.[0] || null;

    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [viewMode, setViewMode] = useState<'table' | 'timecard'>('table');
    const [searchQuery, setSearchQuery] = useState('');

    const [shifts, setShifts] = useState<TimesheetShiftRow[]>([]);
    const [loading, setLoading] = useState(false);

    const { toast } = useToast();

    // ── Data load (scope + date + search only; categorical filters are client-side) ──
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
    }, [selectedDate, selectedOrganizationId, selectedDepartmentId, selectedSubDepartmentId, searchQuery, toast]);

    useEffect(() => {
        if (selectedOrganizationId) loadShifts();
    }, [loadShifts, selectedOrganizationId]);

    // ── Formatting helpers ─────────────────────────────────────────────────────
    const formatMinutes = (minutes: number): string => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h}:${m.toString().padStart(2, '0')}`;
    };

    const formatClockDisplay = (value: string | null | undefined): string => {
        if (!value || value === '-') return '-';
        const d = new Date(value);
        if (!isNaN(d.getTime())) return format(d, 'h:mm a');
        const parts = value.split(':').map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            const h = parts[0], m = parts[1];
            return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
        }
        return value;
    };

    // ── Data transform ─────────────────────────────────────────────────────────
    const entries = useMemo(() => shifts.map(shift => ({
        id: shift.id,
        shiftId: shift.shiftId,
        timesheetId: shift.timesheetId || undefined,
        date: shift.shiftDate,
        employeeId: shift.employeeId || '',
        employee: shift.employeeName,
        organization: shift.organizationName,
        department: shift.departmentName,
        subDepartment: shift.subDepartmentName,
        group: shift.groupType || '',
        subGroup: shift.subGroupName || '',
        role: shift.roleName,
        remunerationLevel: shift.remunerationLevel || '',
        scheduledStart: shift.scheduledStart,
        scheduledEnd: shift.scheduledEnd,
        clockIn: formatClockDisplay(shift.clockIn),
        clockOut: formatClockDisplay(shift.clockOut),
        adjustedStart: shift.adjustedStart || '',
        adjustedEnd: shift.adjustedEnd || '',
        adjustedStartSource: shift.adjustedStartSource,
        adjustedEndSource: shift.adjustedEndSource,
        isAdjustedManual: shift.isAdjustedManual,
        length: formatMinutes(shift.scheduledLengthMinutes),
        netLength: formatMinutes(shift.netLengthMinutes),
        paidBreak: String(shift.paidBreakMinutes),
        unpaidBreak: String(shift.unpaidBreakMinutes),
        approximatePay: shift.estimatedPay ? `$${shift.estimatedPay.toFixed(2)}` : '-',
        differential: shift.varianceMinutes ? String(shift.varianceMinutes) : '0',
        varianceMinutes: shift.varianceMinutes,
        clockInVarianceMinutes: shift.clockInVarianceMinutes,
        clockOutVarianceMinutes: shift.clockOutVarianceMinutes,
        timesheetStatus: shift.timesheetStatus?.toLowerCase() || 'draft',
        attendanceStatus: shift.attendanceStatus || null,
        liveStatus: shift.lifecycleStatus || '',
        notes: shift.notes,
        rejectedReason: shift.rejectedReason,
        statusDot: getStatusDotInfo({
            lifecycle_status: shift.lifecycleStatus,
            assignment_outcome: shift.attendanceStatus,
            actual_start: shift.clockIn,
            actual_end: shift.clockOut,
            start_at: shift.rawStartAt,
            end_at: shift.rawEndAt,
            shift_date: shift.shiftDate,
            start_time: shift.scheduledStart,
            end_time: shift.scheduledEnd,
        }),
    })), [shifts]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Actions ────────────────────────────────────────────────────────────────
    const handleRefresh = () => loadShifts();

    const handleSaveEntry = async (id: string, updates: any) => {
        if (!canEdit) return;
        const success = await updateTimesheetEntry(id, {
            ...updates,
            status: updates.timesheetStatus?.toLowerCase(),
        });
        if (success) { toast({ title: 'Entry Updated' }); await loadShifts(); }
    };

    const handleBulkAction = async (ids: string[], action: 'approve' | 'reject') => {
        if (!canEdit) return;
        const result = await bulkUpdateTimesheetStatus(
            ids, user?.id || '',
            action === 'approve' ? 'approved' : 'rejected',
        );
        if (result.success) { toast({ title: 'Bulk action complete' }); await loadShifts(); }
    };

    const handleMarkNoShow = async (shiftId: string) => {
        if (!canEdit) return;
        const success = await markShiftAsNoShow(shiftId, user?.id || '');
        if (success) { toast({ title: 'Shift marked as No-Show' }); await loadShifts(); }
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="p-4 md:p-8 space-y-8">
            <PersonalPageHeader
                title="Timesheets"
                Icon={Clock}
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                mode={scopeMode}
            />

            <div className="bg-card border rounded-[2rem] p-6 md:p-10 shadow-xl">
                <TimesheetTable
                    entries={entries}
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    readOnly={!canEdit}
                    viewMode={viewMode}
                    onViewChange={setViewMode}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    onSaveEntry={handleSaveEntry}
                    onBulkAction={handleBulkAction}
                    onMarkNoShow={handleMarkNoShow}
                    onRefresh={handleRefresh}
                    isRefreshing={loading}
                />
            </div>
        </div>
    );
};

export default TimesheetPage;
