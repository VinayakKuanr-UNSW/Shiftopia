import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import { formatInTimezone, parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { Clock, CheckCircle, XCircle, UserX, Shield } from 'lucide-react';

const TIMESHEET_STATUS_TABS = [
    { id: 'all', label: 'All', icon: Shield, accent: 'slate' },
    { id: 'pending', label: 'Pending', icon: Clock, accent: 'amber' },
    { id: 'approved', label: 'Approved', icon: CheckCircle, accent: 'emerald' },
    { id: 'rejected', label: 'Rejected', icon: XCircle, accent: 'red' },
    { id: 'no_show', label: 'No-Show', icon: UserX, accent: 'slate' },
] as const;

const timesheetAccentMap: Record<string, { bg: string; text: string; ring: string }> = {
    amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400',     ring: 'ring-amber-500/20' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-500/20' },
    red:     { bg: 'bg-rose-500/10',    text: 'text-rose-600 dark:text-rose-400',       ring: 'ring-rose-500/20' },
    slate:   { bg: 'bg-muted/50',       text: 'text-muted-foreground',                 ring: 'ring-border' },
};

import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { UnifiedRosterNavigator, ViewType, DateRange, computeRange } from '@/modules/rosters/ui/components/UnifiedRosterNavigator';
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
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import {
    computeAttendanceMetrics,
    type AttendanceInput,
} from '@/modules/rosters/domain/attendance-metrics';
import { AttendanceMetricsBar } from '@/modules/rosters/ui/components/AttendanceMetricsBar';
import { AutoPilotControl, type AutoPilotDecision } from '@/modules/core/autopilot';
import { createTimesheetAutoPilotAdapter } from '../api/timesheetAutoPilot.api';

/**
 * TimesheetPage
 *
 * Owns: scope, date, search query, raw data fetch.
 * Categorical filters (group, subgroup, role, status) are managed inside TimesheetTable.
 */
export const TimesheetPage: React.FC = () => {
    const { isDark } = useTheme();
    const { isManagerOrAbove, hasPermission, user } = useAuth();

    const scopeMode: ScopeMode = isManagerOrAbove() ? 'managerial' : 'personal';
    const canEdit = hasPermission('timesheet-edit');

    const { scope, setScope, isGammaLocked } = useScopeFilter(scopeMode);

    const selectedOrganizationId = scope.org_ids?.[0] || null;
    const selectedDepartmentId   = scope.dept_ids?.[0] || null;
    const selectedSubDepartmentId = scope.subdept_ids?.[0] || null;

    // AutoPilot (auto-verify) — shadow-first policy control, managers only.
    const autoPilotAdapter = useMemo(
        () => (selectedOrganizationId
            ? createTimesheetAutoPilotAdapter({ organizationId: selectedOrganizationId, userId: user?.id })
            : null),
        [selectedOrganizationId, user?.id],
    );

    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [viewType, setViewType] = useState<ViewType>('day');
    const [range, setRange] = useState<DateRange>(computeRange(new Date(), 'day'));
    const [viewMode, setViewMode] = useState<'table' | 'timecard'>('timecard');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'no_show'>('all');
    const EMPTY_DECISIONS_MAP = useMemo(() => new Map<string, AutoPilotDecision>(), []);
    const [shifts, setShifts] = useState<TimesheetShiftRow[]>([]);
    const [loading, setLoading] = useState(false);
    // AutoPilot bot decisions, keyed by shift id — drives the per-row chip.
    const [autoDecisions, setAutoDecisions] = useState<Map<string, AutoPilotDecision>>(EMPTY_DECISIONS_MAP);

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

            // Overlay AutoPilot decisions (best-effort; feature may be un-provisioned).
            if (autoPilotAdapter?.getDecisionsForEntities && data.length > 0) {
                autoPilotAdapter
                    .getDecisionsForEntities(data.map(s => s.shiftId))
                    .then(m => setAutoDecisions(m.size === 0 ? EMPTY_DECISIONS_MAP : m))
                    .catch(() => setAutoDecisions(EMPTY_DECISIONS_MAP));
            } else {
                setAutoDecisions(EMPTY_DECISIONS_MAP);
            }
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
    }, [range, selectedOrganizationId, selectedDepartmentId, selectedSubDepartmentId, searchQuery, toast, autoPilotAdapter]);

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

            if (statusFilter === 'pending') return tsStatus === 'draft' || tsStatus === 'submitted';
            if (statusFilter === 'approved') return tsStatus === 'approved';
            if (statusFilter === 'rejected') return tsStatus === 'rejected';
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
        paidBreak: String(shift.paidBreakMinutes),
        unpaidBreak: String(shift.unpaidBreakMinutes),
        approximatePay: shift.estimatedPay ? `$${shift.estimatedPay.toFixed(2)}` : '-',
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
    })), [shifts, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Status counts for filter tabs ──────────────────────────────────────────
    const statusCounts = useMemo(() => {
        const counts = { all: 0, pending: 0, approved: 0, rejected: 0, no_show: 0 };
        for (const shift of shifts) {
            const isDraft = shift.lifecycleStatus === 'Draft';
            const isUnassigned = !shift.employeeId || shift.employeeName?.toLowerCase().includes('unassigned');
            if (isDraft || isUnassigned) continue;
            counts.all++;

            const tsStatus = shift.timesheetStatus?.toLowerCase() || 'draft';
            const attStatus = shift.attendanceStatus?.toLowerCase() || null;

            if (tsStatus === 'draft' || tsStatus === 'submitted') counts.pending++;
            else if (tsStatus === 'approved') counts.approved++;
            else if (tsStatus === 'rejected') counts.rejected++;

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
        const success = await updateTimesheetEntry(id, {
            ...updates,
            status: updates.timesheetStatus?.toLowerCase(),
        });
        if (success) {
            toast({ title: 'Entry Updated' });
        } else {
            toast({
                title: 'Update failed',
                description: 'This entry could not be saved — if you were approving it, it likely still has a missing clock-in/out that needs an adjusted time first.',
                variant: 'destructive',
            });
        }
        await loadShifts();
    };

    const handleBulkAction = async (ids: string[], action: 'approve' | 'reject') => {
        if (!canEdit) return;
        const result = await bulkUpdateTimesheetStatus(
            ids, user?.id || '',
            action === 'approve' ? 'approved' : 'rejected',
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
        if (result.success || result.failed) await loadShifts();
    };

    const handleMarkNoShow = async (shiftId: string) => {
        if (!canEdit) return;
        const success = await markShiftAsNoShow(shiftId, user?.id || '');
        if (success) { toast({ title: 'Shift marked as No-Show' }); await loadShifts(); }
    };



    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
            <GoldStandardHeader
                title="Timesheets"
                Icon={Clock}
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                mode={scopeMode}
                // Row 3 Structured Props
                viewMode={viewMode === 'timecard' ? 'card' : 'table'}
                onViewModeChange={(mode) => setViewMode(mode === 'card' ? 'timecard' : 'table')}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onRefresh={handleRefresh}
                isLoading={loading}
                leftContent={
                    <UnifiedRosterNavigator
                        variant="full"
                        date={selectedDate}
                        viewType={viewType}
                        onChange={(date, newRange) => {
                            setSelectedDate(date);
                            setRange(newRange);
                        }}
                        onViewTypeChange={(view) => {
                            let newDate = selectedDate;
                            if (view === 'week') {
                                newDate = startOfWeek(selectedDate, { weekStartsOn: 1 });
                            } else if (view === 'month') {
                                newDate = startOfMonth(selectedDate);
                            }
                            setSelectedDate(newDate);
                            setViewType(view);
                            setRange(computeRange(newDate, view));
                        }}
                    />
                }
                functionBarChildren={
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {canEdit && autoPilotAdapter && (
                            <AutoPilotControl adapter={autoPilotAdapter} onChanged={handleRefresh} />
                        )}
                        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-muted/30 border border-border flex-nowrap overflow-x-auto scrollbar-hide">
                            {TIMESHEET_STATUS_TABS.map(tab => {
                                const isActive = statusFilter === tab.id;
                                const colors = timesheetAccentMap[tab.accent];
                                const TabIcon = tab.icon;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setStatusFilter(tab.id as any)}
                                        className={cn(
                                            'relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-[11px] font-black transition-all duration-300',
                                            isActive
                                                ? `${colors.bg} ${colors.text} shadow-sm`
                                                : 'text-muted-foreground/50 hover:text-foreground hover:bg-muted/50'
                                        )}
                                    >
                                        <TabIcon className="h-3.5 w-3.5" />
                                        <span className="hidden sm:inline">{tab.label}</span>
                                        <span className={cn(
                                            'min-w-[18px] h-[18px] rounded-full text-[9px] font-black flex items-center justify-center px-1',
                                            isActive ? `${colors.bg} ${colors.text} ring-1 ${colors.ring}` : 'bg-muted text-muted-foreground/40'
                                        )}>
                                            {statusCounts[tab.id as keyof typeof statusCounts]}
                                        </span>
                                        {isActive && (
                                            <motion.div
                                                layoutId="activeTimesheetTab"
                                                className={`absolute inset-0 rounded-xl ring-1 ${colors.ring}`}
                                                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                            />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                }
            />

            {/* ── ROW 3: CONTENT AREA ───────────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6">
                <div className={cn(
                    "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-none">
                        {shifts.length > 0 && (
                            <AttendanceMetricsBar metrics={attendanceMetrics} className="mb-4" />
                        )}
                        <TimesheetTable
                            entries={entries}
                            autoDecisions={autoDecisions}
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
                            hideTopControls
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TimesheetPage;
