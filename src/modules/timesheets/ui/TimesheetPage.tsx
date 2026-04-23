import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { format } from 'date-fns';
import { Clock, Calendar, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';


import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
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

// ── Motion variants ────────────────────────────────────────────────────────────
const pageVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { 
        opacity: 1, 
        y: 0,
        transition: {
            duration: 0.3,
            staggerChildren: 0.05
        }
    }
};

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
        <motion.div 
            className="h-full flex flex-col w-full text-foreground overflow-hidden" 
            variants={pageVariants} 
            initial="hidden" 
            animate="show"
        >
            {/* ── Unified Header ────────────────────────────────────────────── */}
            <div className="sticky top-0 z-30 pt-4 pb-4 lg:pb-6">
                <div className={cn(
                    "rounded-[32px] p-4 lg:p-6 transition-all border",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    {/* Row 1: Identity & Clock + Row 2: Scope Filter */}
                    <PersonalPageHeader
                        title="Timesheets"
                        Icon={Clock}
                        scope={scope}
                        setScope={setScope}
                        isGammaLocked={isGammaLocked}
                        mode={scopeMode}
                        className="mb-4 lg:mb-6"
                    />

                    {/* Row 3: Function Bar */}
                    <div className="flex flex-row items-center gap-2 w-full transition-all p-1.5 rounded-2xl overflow-hidden mt-1">
                        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
                            {/* Date Picker (Simplified for Row 3) */}
                            <div className={cn(
                                "h-10 lg:h-11 px-4 rounded-xl flex items-center gap-2 flex-shrink-0",
                                isDark ? "bg-[#111827]/60" : "bg-white shadow-sm border border-slate-200/50"
                            )}>
                                <Calendar className="h-4 w-4 text-primary" />
                                <input 
                                    type="date" 
                                    value={format(selectedDate, 'yyyy-MM-dd')}
                                    onChange={(e) => setSelectedDate(new Date(e.target.value))}
                                    className="bg-transparent border-none text-[10px] font-black uppercase tracking-widest text-foreground focus:ring-0"
                                />
                            </div>

                            <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

                            {/* Search Input */}
                            <div className={cn(
                                "h-10 lg:h-11 px-4 rounded-xl flex items-center gap-3 flex-1 min-w-[200px]",
                                isDark ? "bg-[#111827]/60" : "bg-white shadow-sm border border-slate-200/50"
                            )}>
                                <Clock className="h-4 w-4 text-muted-foreground/40" />
                                <input
                                    type="text"
                                    placeholder="SEARCH EMPLOYEES..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="bg-transparent border-none w-full text-[10px] font-black uppercase tracking-widest placeholder:text-muted-foreground/20 focus:ring-0"
                                />
                            </div>

                            <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

                            {/* View Toggle */}
                            <div className={cn(
                                "flex items-center p-1 rounded-xl",
                                isDark ? "bg-[#111827]/60" : "bg-slate-200/50"
                            )}>
                                <button
                                    onClick={() => setViewMode('table')}
                                    className={cn(
                                        "px-3 h-8 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                                        viewMode === 'table' 
                                            ? "bg-primary text-primary-foreground shadow-sm" 
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    Table
                                </button>
                                <button
                                    onClick={() => setViewMode('timecard')}
                                    className={cn(
                                        "px-3 h-8 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                                        viewMode === 'timecard' 
                                            ? "bg-primary text-primary-foreground shadow-sm" 
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    Cards
                                </button>
                            </div>

                            <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

                            {/* Refresh Button */}
                            <button
                                onClick={handleRefresh}
                                disabled={loading}
                                className={cn(
                                    "h-10 w-10 lg:h-11 lg:w-11 rounded-xl flex items-center justify-center transition-all",
                                    isDark 
                                        ? "bg-[#111827]/60 text-muted-foreground hover:text-white" 
                                        : "bg-slate-200/50 text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                                )}
                            >
                                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Main Content Area ─────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden pt-2 lg:pt-4">
                <div className={cn(
                    "h-full rounded-[32px] transition-all border flex flex-col overflow-hidden",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    <div className="flex-1 overflow-y-auto p-4 lg:p-8 scrollbar-none">
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
                            hideTopControls // We've moved these to Row 3
                        />
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default TimesheetPage;
