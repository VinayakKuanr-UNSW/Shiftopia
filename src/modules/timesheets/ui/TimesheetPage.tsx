import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { format, startOfMonth } from 'date-fns';
import { startOfWeekAU } from '@/modules/core/lib/date/week';
import { formatInTimezone, parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { Clock } from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';
import { ViewType, DateRange, computeRange } from '@/modules/rosters/ui/components/UnifiedRosterNavigator';
import { TimesheetTable } from './components/TimesheetTable';
import {
    ActiveFilters,
    EMPTY_FILTERS,
    countActiveFilters,
} from './components/TimesheetFilterDrawer';
import {
    TimesheetFunctionBar,
    TIMESHEET_STATUS_TABS,
} from './components/TimesheetFunctionBar';
import type { RowGroupBy } from '@/modules/core/lib/row-grouping';
import {
    getShiftsForTimesheet,
    updateTimesheetEntry,
    TimesheetConflictError,
    bulkUpdateTimesheetStatus,
    TimesheetShiftRow,
    TimesheetFilters,
    markShiftAsNoShow,
} from '../api/timesheets.supabase.api';
import { useScopeFilter, ScopeMode } from '@/platform/auth/useScopeFilter';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import {
    computeAttendanceMetrics,
    type AttendanceInput,
} from '@/modules/rosters/domain/attendance-metrics';
import { AttendanceMetricsBar } from '@/modules/rosters/ui/components/AttendanceMetricsBar';

/**
 * TimesheetPage
 *
 * Owns: scope, date, search query, filter state, raw data fetch.
 */
export const TimesheetPage: React.FC = () => {
    const { hasPermission, user } = useAuth();

    // Everyone here holds the page (route gate `timesheet-view`): the places are
    // what their managerial contracts reach plus each Team Lead contract's
    // sub-department. Beta used the personal tree, which also listed the
    // sub-departments where they are ordinary staff.
    const scopeMode: ScopeMode = 'timesheet';
    const canEdit = hasPermission('timesheet-edit');

    const { scope, setScope, isGammaLocked } = useScopeFilter(scopeMode);

    const selectedOrganizationId = scope.org_ids?.[0] || null;
    const selectedDepartmentId   = scope.dept_ids?.[0] || null;
    const selectedSubDepartmentId = scope.subdept_ids?.[0] || null;

    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [viewType, setViewType] = useState<ViewType>('day');
    const [range, setRange] = useState<DateRange>(computeRange(new Date(), 'day'));
    const [viewMode, setViewMode] = useState<'table' | 'timecard'>('timecard');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'auto_approved' | 'approved' | 'denied' | 'no_show'>('all');
    const [groupBy, setGroupBy] = useState<RowGroupBy>('date');
    const [appliedFilters, setAppliedFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
    const activeFilterCount = useMemo(() => countActiveFilters(appliedFilters) + (statusFilter !== 'all' ? 1 : 0), [appliedFilters, statusFilter]);
    const [shifts, setShifts] = useState<TimesheetShiftRow[]>([]);
    const [loading, setLoading] = useState(false);

    const { toast } = useToast();

    // ── Data load (scope + date range + search only; categorical filters are client-side) ──
    const loadShifts = useCallback(async () => {
        if (!selectedOrganizationId) return;
        setLoading(true);
        try {
            const startStr = format(range.start, 'yyyy-MM-dd');
            const endStr = format(range.end, 'yyyy-MM-dd');
            const filters: TimesheetFilters = {
                organizationId: selectedOrganizationId,
                departmentId: selectedDepartmentId,
                subDepartmentId: selectedSubDepartmentId,
                searchQuery: searchQuery || undefined,
            };
            const data = await getShiftsForTimesheet(startStr, filters, endStr);
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
    }, [range, selectedOrganizationId, selectedDepartmentId, selectedSubDepartmentId, searchQuery, toast]);

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
        // ISO timestamps render as VENUE wall-clock (Sydney) so every viewer
        // sees the same clock times the schedule columns are expressed in.
        if (!isNaN(d.getTime())) return formatInTimezone(d, SYDNEY_TZ, 'h:mm a');
        const parts = value.split(':').map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            const h = parts[0], m = parts[1];
            return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
        }
        return value;
    };

    // ── Data transform ─────────────────────────────────────────────────────────
    const entries = useMemo(() => shifts
        .filter(shift => {
            const isDraft = shift.lifecycleStatus === 'Draft';
            const isUnassigned = !shift.employeeId || shift.employeeName?.toLowerCase().includes('unassigned');
            if (isDraft || isUnassigned) return false;

            const tsStatus = shift.timesheetStatus?.toLowerCase() || 'draft';
            const attStatus = shift.attendanceStatus?.toLowerCase() || null;

            if (statusFilter === 'pending') return tsStatus === 'draft' || tsStatus === 'submitted' || tsStatus === 'pending';
            if (statusFilter === 'auto_approved') return tsStatus === 'auto_approved' || tsStatus === 'auto_verified';
            if (statusFilter === 'approved') return tsStatus === 'approved';
            if (statusFilter === 'denied') return tsStatus === 'denied' || tsStatus === 'rejected';
            if (statusFilter === 'no_show') return attStatus === 'no_show' || tsStatus === 'no_show';
            
            return true;
        })
        .map(shift => ({
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
        remunerationLevelNumber: shift.remunerationLevelNumber,
        payTerms: shift.payTerms,
        scheduledStart: shift.scheduledStart,
        scheduledEnd: shift.scheduledEnd,
        clockIn: formatClockDisplay(shift.clockIn),
        clockOut: formatClockDisplay(shift.clockOut),
        // Raw ISO timestamps — the Live Rules engine and review gate MUST get
        // these (not the formatted display strings) or overnight shifts and
        // non-Sydney viewers are misclassified.
        rawActualStart: shift.clockIn,
        rawActualEnd: shift.clockOut,
        rawStartAt: shift.rawStartAt,
        rawEndAt: shift.rawEndAt,
        adjustedStart: shift.adjustedStart || '',
        adjustedEnd: shift.adjustedEnd || '',
        adjustedStartSource: shift.adjustedStartSource,
        adjustedEndSource: shift.adjustedEndSource,
        isAdjustedManual: shift.isAdjustedManual,
        length: formatMinutes(shift.scheduledLengthMinutes),
        netLength: formatMinutes(shift.netLengthMinutes),
        netLengthMinutes: shift.netLengthMinutes,
        paidBreak: String(shift.paidBreakMinutes),
        unpaidBreak: String(shift.unpaidBreakMinutes),
        approximatePay: shift.payBasis === 'salary'
            ? 'Salaried'
            : shift.estimatedPay ? `$${shift.estimatedPay.toFixed(2)}` : '-',
        differential: shift.varianceMinutes ? String(shift.varianceMinutes) : '0',
        varianceMinutes: shift.varianceMinutes,
        clockInVarianceMinutes: shift.clockInVarianceMinutes,
        clockOutVarianceMinutes: shift.clockOutVarianceMinutes,
        timesheetStatus: shift.timesheetStatus?.toLowerCase() || 'draft',
        attendanceStatus: shift.attendanceStatus || null,
        attendanceNote: shift.attendanceNote || null,
        liveStatus: shift.lifecycleStatus || '',
        notes: shift.notes,
        rejectedReason: shift.rejectedReason,
        arrivalVarianceReason: shift.arrivalVarianceReason,
        departureVarianceReason: shift.departureVarianceReason,
        isTraining: shift.isTraining,
        wasToppedUpToMinEngagement: shift.wasToppedUpToMinEngagement,
        requiredEngagementMinutes: shift.requiredEngagementMinutes,
        employmentType: shift.employmentType,
        isSecurityRole: shift.isSecurityRole,
    })), [shifts, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Status counts for filter tabs ──────────────────────────────────────────
    const statusCounts = useMemo(() => {
        const counts = { all: 0, pending: 0, auto_approved: 0, approved: 0, denied: 0, no_show: 0 };
        for (const shift of shifts) {
            const isDraft = shift.lifecycleStatus === 'Draft';
            const isUnassigned = !shift.employeeId || shift.employeeName?.toLowerCase().includes('unassigned');
            if (isDraft || isUnassigned) continue;
            counts.all++;

            const tsStatus = shift.timesheetStatus?.toLowerCase() || 'draft';
            const attStatus = shift.attendanceStatus?.toLowerCase() || null;

            if (tsStatus === 'draft' || tsStatus === 'submitted' || tsStatus === 'pending') counts.pending++;
            else if (tsStatus === 'auto_approved' || tsStatus === 'auto_verified') counts.auto_approved++;
            else if (tsStatus === 'approved') counts.approved++;
            else if (tsStatus === 'denied' || tsStatus === 'rejected') counts.denied++;

            if (attStatus === 'no_show' || tsStatus === 'no_show') counts.no_show++;
        }
        return counts;
    }, [shifts]);

    // ── Attendance scorecard ─────────────────────────────────────────────────────
    // Same 9 metrics/definitions as My Attendance + Insights, aggregated over the
    // full loaded set (assigned, non-draft) — independent of the status toggle.
    const attendanceMetrics = useMemo(() => {
        const now = Date.now();
        const inputs: AttendanceInput[] = shifts
            .filter((s) => {
                const isDraft = s.lifecycleStatus === 'Draft';
                const isUnassigned = !s.employeeId || s.employeeName?.toLowerCase().includes('unassigned');
                return !isDraft && !isUnassigned;
            })
            .map((s) => {
                const endMs = s.rawEndAt
                    ? new Date(s.rawEndAt).getTime()
                    : (() => {
                          const end = parseZonedDateTime(s.shiftDate, s.scheduledEnd, SYDNEY_TZ);
                          if (s.scheduledEnd < s.scheduledStart) end.setDate(end.getDate() + 1);
                          return end.getTime();
                      })();
                return {
                    clockInVarianceMin: s.clockInVarianceMinutes,
                    clockOutVarianceMin: s.clockOutVarianceMinutes,
                    attendanceStatus: s.attendanceStatus,
                    hasEnded: s.lifecycleStatus === 'Completed' || endMs < now || !!s.clockOut,
                };
            });
        return computeAttendanceMetrics(inputs);
    }, [shifts]);


    // ── Actions ────────────────────────────────────────────────────────────────
    const handleRefresh = () => loadShifts();

    const handleSaveEntry = async (id: string, updates: any) => {
        if (!canEdit) return;
        // Optimistic-lock (F18): pass the version this row was loaded with so a
        // concurrent edit by another manager is caught instead of clobbered.
        const loaded = shifts.find((s) => String(s.id) === String(id));
        try {
            const success = await updateTimesheetEntry(
                id,
                { ...updates, status: updates.timesheetStatus?.toLowerCase() },
                { expectedVersion: loaded?.version ?? null, actorId: user?.id ?? null },
            );
            if (success) {
                toast({ title: 'Entry Updated' });
            } else {
                toast({
                    title: 'Update failed',
                    description: 'This entry could not be saved — if you were approving it, it likely still has a missing clock-in/out that needs an adjusted time first.',
                    variant: 'destructive',
                });
            }
        } catch (err) {
            if (err instanceof TimesheetConflictError) {
                toast({
                    title: 'Changed by someone else',
                    description: 'This timesheet was updated by another manager. Refreshing to the latest — review and re-apply your change.',
                    variant: 'destructive',
                });
            } else {
                toast({ title: 'Update failed', description: 'Something went wrong saving this entry.', variant: 'destructive' });
            }
        }
        await loadShifts();
    };

    const handleBulkAction = async (ids: string[], action: 'approve' | 'reject') => {
        if (!canEdit) return;
        // Audit M-14: pass each row's loaded version so bulk actions get the
        // same optimistic-lock CAS protection single-row edits already have —
        // previously a bulk action could silently clobber a concurrent edit.
        const expectedVersions: Record<string, number | null | undefined> = {};
        for (const id of ids) {
            const loaded = shifts.find((s) => String(s.id) === String(id));
            expectedVersions[id] = loaded?.version ?? null;
        }
        const result = await bulkUpdateTimesheetStatus(
            ids, user?.id || '',
            action === 'approve' ? 'approved' : 'rejected',
            expectedVersions,
        );
        if (result.success) { toast({ title: 'Bulk action complete', description: `${result.success} shift(s) updated.` }); }
        // A failure here is most often the completeness guard refusing to approve
        // a shift with a missing clock-in/out — surface it instead of going quiet,
        // since a silent skip would look identical to success from the manager's seat.
        if (result.failed > 0) {
            toast({
                title: 'Some shifts were not updated',
                description: `${result.failed} shift(s) could not be ${action === 'approve' ? 'approved' : 'rejected'} — likely a missing clock-in/out that needs an adjusted time first.`,
                variant: 'destructive',
            });
        }
        if (result.conflicted > 0) {
            toast({
                title: 'Some shifts changed since you loaded them',
                description: `${result.conflicted} shift(s) were updated by another manager — refreshing to the latest; review and re-apply if still needed.`,
                variant: 'destructive',
            });
        }
        if (result.success || result.failed || result.conflicted) await loadShifts();
    };

    const handleMarkNoShow = async (shiftId: string) => {
        if (!canEdit) return;
        const success = await markShiftAsNoShow(shiftId, user?.id || '');
        if (success) { toast({ title: 'Shift marked as No-Show' }); await loadShifts(); }
    };


    // ── View type change handler (shared desktop & mobile) ──────────────────
    const handleViewTypeChange = useCallback((view: ViewType) => {
        let newDate = selectedDate;
        if (view === 'week') {
            newDate = startOfWeekAU(selectedDate);
        } else if (view === 'month') {
            newDate = startOfMonth(selectedDate);
        }
        setSelectedDate(newDate);
        setViewType(view);
        setRange(computeRange(newDate, view));
    }, [selectedDate]);



    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <PageLayout>
            {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
            <GoldStandardHeader
                title="Timesheets"
                Icon={Clock}
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                mode={scopeMode}
                functionBar={
                    <TimesheetFunctionBar
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                        selectedDate={selectedDate}
                        viewType={viewType}
                        onDateChange={setSelectedDate}
                        onViewTypeChange={handleViewTypeChange}
                        onRangeChange={setRange}
                        onRefresh={handleRefresh}
                        isLoading={loading}
                        entries={entries}
                        appliedFilters={appliedFilters}
                        onApplyFilters={setAppliedFilters}
                        activeFilterCount={activeFilterCount}
                        groupBy={groupBy}
                        onGroupByChange={setGroupBy}
                        statusFilter={statusFilter}
                        onStatusFilterChange={(s) => setStatusFilter(s as any)}
                        statusCounts={statusCounts}
                        compactOnMobile
                    />
                }
            />

            {/* ── ROW 3: CONTENT AREA ───────────────────────────────────────── */}
            <div className={cn(
                "flex-1 min-h-0 overflow-hidden flex flex-col",
                surface.bodyCard
            )}>
                <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-none">
                    <TimesheetTable
                        entries={entries}
                        selectedDate={selectedDate}
                        onDateChange={setSelectedDate}
                        readOnly={!canEdit}
                        viewMode={viewMode}
                        onViewChange={setViewMode}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        appliedFilters={appliedFilters}
                        onApplyFilters={setAppliedFilters}
                        activeFilterCount={activeFilterCount}
                        groupBy={groupBy}
                        onSaveEntry={handleSaveEntry}
                        onBulkAction={handleBulkAction}
                        onMarkNoShow={handleMarkNoShow}
                        onRefresh={handleRefresh}
                        isRefreshing={loading}
                        hideTopControls
                    />
                </div>
            </div>

            {/* Disconnected Attendance Metrics Footer */}
            <PageLayout.Footer>
                <AttendanceMetricsBar metrics={attendanceMetrics} />
            </PageLayout.Footer>
        </PageLayout>
    );
};

export default TimesheetPage;
