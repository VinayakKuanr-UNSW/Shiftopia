import React, { useState, useMemo } from "react";
import {
    ArrowUp,
    ArrowDown,
    CheckCircle,
    XCircle,
    AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { useTheme } from "@/modules/core/contexts/ThemeContext";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@/modules/core/ui/primitives/tabs';
import type { TimesheetRow, TimesheetEntry } from "../../model/timesheet.types";
import { TimesheetRow as TimesheetRowComponent } from "./TimesheetRow";

interface TimesheetTableProps {
    entries: TimesheetRow[];
    selectedDate: Date;
    statusFilter: string | null;
    viewMode: 'table' | 'group';
    onViewChange: (view: 'table' | 'group') => void;
    searchQuery?: string;
    departmentFilter?: string;
    subGroupFilter?: string;
    roleFilter?: string;
    tierFilter?: string;
    readOnly?: boolean;
    onSaveEntry?: (id: string, updates: Partial<TimesheetRow>) => void;
    onBulkAction?: (ids: string[], action: 'approve' | 'reject') => void;
}

export const TimesheetTable: React.FC<TimesheetTableProps> = ({
    entries,
    selectedDate,
    statusFilter,
    viewMode,
    onViewChange,
    searchQuery = '',
    departmentFilter = 'all',
    subGroupFilter = 'all',
    roleFilter = 'all',
    tierFilter = 'all',
    readOnly = false,
    onSaveEntry,
    onBulkAction,
}) => {
    const [sortField, setSortField] = useState<keyof TimesheetRow | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const { theme } = useTheme();
    const { toast } = useToast();

    const handleSort = (field: keyof TimesheetRow) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const getSortIndicator = (field: keyof TimesheetRow) => {
        if (sortField !== field) return null;
        return sortDirection === 'asc' ?
            <ArrowUp className="inline h-3 w-3 ml-1" /> :
            <ArrowDown className="inline h-3 w-3 ml-1" />;
    };

    const filteredEntries = useMemo(() => {
        return entries.filter(entry => {
            if (statusFilter && entry.liveStatus !== statusFilter) return false;
            if (departmentFilter !== 'all' && entry.department !== departmentFilter) return false;
            if (subGroupFilter !== 'all' && entry.subGroup !== subGroupFilter) return false;
            if (roleFilter !== 'all' && entry.role !== roleFilter) return false;
            if (tierFilter !== 'all' && entry.remunerationLevel !== tierFilter) return false;
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                return (
                    entry.employee.toLowerCase().includes(query) ||
                    entry.employeeId.toLowerCase().includes(query) ||
                    entry.role.toLowerCase().includes(query) ||
                    entry.department.toLowerCase().includes(query) ||
                    entry.subGroup.toLowerCase().includes(query) ||
                    entry.liveStatus.toLowerCase().includes(query)
                );
            }
            return true;
        });
    }, [entries, statusFilter, departmentFilter, subGroupFilter, roleFilter, tierFilter, searchQuery]);

    const sortedEntries = useMemo(() => {
        if (!sortField) return filteredEntries;
        return [...filteredEntries].sort((a, b) => {
            const aValue = a[sortField];
            const bValue = b[sortField];
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
            }
            if (typeof aValue === 'number' && typeof bValue === 'number') {
                return sortDirection === 'asc' ? (aValue as number) - (bValue as number) : (bValue as number) - (aValue as number);
            }
            return 0;
        });
    }, [filteredEntries, sortField, sortDirection]);

    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleSelectAll = () => {
        const selectableIds: string[] = sortedEntries
            .filter(e => e.timesheetStatus === 'DRAFT' || e.timesheetStatus === 'SUBMITTED')
            .map(e => String(e.id));
        if (selectedIds.length === selectableIds.length && selectableIds.length > 0) {
            setSelectedIds([]);
        } else {
            setSelectedIds(selectableIds);
        }
    };

    const handleBulkApprove = () => {
        if (selectedIds.length === 0) {
            toast({
                title: 'No entries selected',
                description: 'Please select at least one pending entry to approve.',
                variant: 'destructive',
            });
            return;
        }
        onBulkAction?.(selectedIds, 'approve');
        toast({
            title: 'Bulk Approval',
            description: `${selectedIds.length} timesheet(s) have been approved.`,
        });
        setSelectedIds([]);
    };

    const handleBulkReject = () => {
        if (selectedIds.length === 0) {
            toast({
                title: 'No entries selected',
                description: 'Please select at least one pending entry to reject.',
                variant: 'destructive',
            });
            return;
        }
        onBulkAction?.(selectedIds, 'reject');
        toast({
            title: 'Bulk Rejection',
            description: `${selectedIds.length} timesheet(s) have been rejected.`,
        });
        setSelectedIds([]);
    };

    const SortableHeader: React.FC<{ field: keyof TimesheetRow; label: string; className?: string }> = ({ field, label, className = '' }) => (
        <th
            className={`text-left p-2.5 text-[10px] font-black uppercase tracking-widest text-foreground/70 cursor-pointer hover:bg-muted/50 whitespace-nowrap transition-colors border-b border-border/50 ${className}`}
            onClick={() => handleSort(field)}
        >
            <div className="flex items-center">
                {label} {getSortIndicator(field)}
            </div>
        </th>
    );

    const getContainerBgClass = () => {
        return 'bg-card border-border shadow-2xl';
    };

    // Header group colors - Premium theme-aware palette
    const headerGroupStyles = {
        select: 'bg-muted/50 border-r border-border/30',
        employeeInfo: 'bg-primary/5 border-r border-border/30',
        hierarchy2: 'bg-muted/50 border-r border-border/30',
        scheduled: 'bg-primary/5 border-r border-border/30',
        geofenced: 'bg-muted/50 border-r border-border/30',
        adjusted: 'bg-primary/5 border-r border-border/30',
        payroll: 'bg-muted/50 border-r border-border/30',
        statuses: 'bg-primary/5 border-r border-border/30',
        actions: 'bg-muted/50',
    };

    const pendingCount = sortedEntries.filter(e => e.timesheetStatus === 'DRAFT' || e.timesheetStatus === 'SUBMITTED').length;

    const attendanceSummary = useMemo(() => ({
        late: sortedEntries.filter(e => e.attendanceStatus === 'late').length,
        noShow: sortedEntries.filter(e => e.attendanceStatus === 'no_show').length,
        missing: sortedEntries.filter(e => {
            const isActiveOrComplete = e.liveStatus === 'InProgress' || e.liveStatus === 'Completed';
            const noCheckIn = !e.clockIn || e.clockIn === '-';
            return isActiveOrComplete && noCheckIn && e.attendanceStatus !== 'no_show';
        }).length,
    }), [sortedEntries]);

    return (
        <div className="overflow-x-auto mt-8">
            <Tabs value={viewMode} onValueChange={(v) => onViewChange(v as 'table' | 'group')}>
                <TabsList className="mb-6 bg-muted/30 border border-border p-1 h-11 rounded-xl w-fit">
                    <TabsTrigger
                        value="table"
                        className="data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg px-6 font-bold"
                    >
                        Table View
                    </TabsTrigger>
                    <TabsTrigger
                        value="group"
                        disabled
                        className="rounded-lg px-6 font-bold"
                    >
                        Grouped View (WIP)
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="table" className="mt-0">
                    <div className={`overflow-x-auto rounded-lg border ${getContainerBgClass()}`}>
                        {/* Header with counts and bulk actions */}
                        <div className="p-6 border-b border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-muted/10">
                            <div>
                                <div className="text-xl font-black tracking-tight text-foreground">Timesheets for {format(selectedDate, 'MMMM d, yyyy')}</div>
                                <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                                    <span className="font-bold text-primary">{sortedEntries.length}</span> entries found
                                    <span className="h-1 w-1 rounded-full bg-border" />
                                    <span className="font-bold text-amber-500">{pendingCount}</span> pending approval
                                </div>
                            </div>

                            {/* Bulk Actions Toolbar */}
                            {selectedIds.length > 0 && !readOnly && (
                                <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 px-4 py-2.5 rounded-2xl animate-in fade-in slide-in-from-right-4 duration-300">
                                    <span className="text-sm font-black text-primary uppercase tracking-tighter">
                                        {selectedIds.length} Selected
                                    </span>
                                    <div className="h-4 w-px bg-primary/20 mx-1" />
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={handleBulkApprove}
                                        className="text-green-600 dark:text-green-400 hover:bg-green-500/20 font-black text-xs uppercase tracking-tight h-9 rounded-xl"
                                    >
                                        <CheckCircle className="mr-1.5 h-4 w-4" />
                                        Approve All
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={handleBulkReject}
                                        className="text-red-600 dark:text-red-400 hover:bg-red-500/20 font-black text-xs uppercase tracking-tight h-9 rounded-xl"
                                    >
                                        <XCircle className="mr-1.5 h-4 w-4" />
                                        Reject All
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Attendance issues summary bar */}
                        {(attendanceSummary.late > 0 || attendanceSummary.noShow > 0 || attendanceSummary.missing > 0) && (
                            <div className="px-6 py-2.5 border-b border-border bg-amber-500/5 flex items-center gap-3 flex-wrap">
                                <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3" />Attendance Flags:
                                </span>
                                {attendanceSummary.late > 0 && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                        Late In · {attendanceSummary.late}
                                    </span>
                                )}
                                {attendanceSummary.noShow > 0 && (
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 shadow-sm animate-in fade-in slide-in-from-left-2">
                                        <XCircle size={14} className="shrink-0" />
                                        <span className="text-xs font-black uppercase tracking-tighter">{attendanceSummary.noShow} No Show</span>
                                    </div>
                                )}
                                {attendanceSummary.missing > 0 && (
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 shadow-sm animate-in fade-in slide-in-from-left-2">
                                        <AlertTriangle size={14} className="shrink-0" />
                                        <span className="text-xs font-black uppercase tracking-tighter">{attendanceSummary.missing} Missing Check-in</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse min-w-[2200px]">
                                <thead>
                                    {/* Row 1: Grouped Headers */}
                                    <tr className="border-b border-border/50">
                                        <th className={`p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ${headerGroupStyles.select}`}>
                                            {/* Select */}
                                        </th>
                                        <th colSpan={2} className={`p-3 text-[10px] font-black uppercase tracking-widest text-primary text-center border-b-2 border-primary/20 ${headerGroupStyles.employeeInfo}`}>
                                            Employee Info
                                        </th>
                                        <th colSpan={4} className={`p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 ${headerGroupStyles.hierarchy2}`}>
                                            Hierarchy
                                        </th>
                                        <th colSpan={2} className={`p-3 text-[10px] font-black uppercase tracking-widest text-primary text-center border-b-2 border-primary/20 ${headerGroupStyles.scheduled}`}>
                                            Scheduled
                                        </th>
                                        <th colSpan={2} className={`p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 ${headerGroupStyles.geofenced}`}>
                                            Attendance (Actual)
                                        </th>
                                        <th colSpan={6} className={`p-3 text-[10px] font-black uppercase tracking-widest text-primary text-center border-b-2 border-primary/20 ${headerGroupStyles.adjusted}`}>
                                            Adjusted (Inline Edit)
                                        </th>
                                        <th colSpan={2} className={`p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 ${headerGroupStyles.payroll}`}>
                                            Payroll
                                        </th>
                                        <th colSpan={3} className={`p-3 text-[10px] font-black uppercase tracking-widest text-primary text-center border-b-2 border-primary/20 ${headerGroupStyles.statuses}`}>
                                            Statuses
                                        </th>
                                        <th className={`p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 ${headerGroupStyles.actions}`}>
                                            Actions
                                        </th>
                                    </tr>

                                    {/* Row 2: Individual Headers */}
                                    <tr className="bg-muted/30">
                                        {/* Select */}
                                        <th className="p-3 text-center border-b border-border/50 border-r border-border/30">
                                            <input
                                                type="checkbox"
                                                onChange={handleSelectAll}
                                                checked={selectedIds.length > 0 && selectedIds.length === sortedEntries.filter(e => e.timesheetStatus === 'DRAFT' || e.timesheetStatus === 'SUBMITTED').length}
                                                className="rounded border-border bg-background"
                                                disabled={pendingCount === 0}
                                            />
                                        </th>
                                        {/* Employee Info */}
                                        <SortableHeader field="employeeId" label="Employee ID" />
                                        <SortableHeader field="employee" label="Employee" />
                                        {/* Hierarchy */}
                                        <SortableHeader field="group" label="Group" />
                                        <SortableHeader field="subGroup" label="Sub-Group" />
                                        <SortableHeader field="role" label="Role" />
                                        <SortableHeader field="remunerationLevel" label="Remuneration Level" />
                                        {/* Scheduled */}
                                        <SortableHeader field="scheduledStart" label="Scheduled Start" />
                                        <SortableHeader field="scheduledEnd" label="Scheduled End" />
                                        {/* Geofenced */}
                                        <SortableHeader field="clockIn" label="Clock-In" />
                                        <SortableHeader field="clockOut" label="Clock-Out" />
                                        {/* Adjusted */}
                                        <SortableHeader field="adjustedStart" label="Adjusted Start" />
                                        <SortableHeader field="adjustedEnd" label="Adjusted End" />
                                        <SortableHeader field="length" label="Length" />
                                        <SortableHeader field="paidBreak" label="Paid Break" />
                                        <SortableHeader field="unpaidBreak" label="Unpaid Break" />
                                        <SortableHeader field="netLength" label="Net Length" />
                                        {/* Payroll */}
                                        <SortableHeader field="approximatePay" label="Approximate Pay" />
                                        <SortableHeader field="differential" label="Differential" />
                                        {/* Statuses */}
                                        <SortableHeader field="liveStatus" label="Lifecycle" />
                                        <SortableHeader field="attendanceStatus" label="Attendance" />
                                        <SortableHeader field="timesheetStatus" label="Timesheet Status" />
                                        {/* Actions */}
                                        <th className="p-3 text-[10px] font-black uppercase tracking-widest text-foreground/70 text-center border-b border-border/50">
                                            History / Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedEntries.map((entry) => (
                                        <TimesheetRowComponent
                                            key={entry.id}
                                            entry={entry}
                                            readOnly={readOnly}
                                            isSelected={selectedIds.includes(String(entry.id))}
                                            onToggleSelect={() => handleToggleSelect(String(entry.id))}
                                            onSave={onSaveEntry}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {sortedEntries.length === 0 && (
                            <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
                                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-2">
                                    <ArrowUp className="h-6 w-6 opacity-20" />
                                </div>
                                <p className="font-bold">No entries found</p>
                                <p className="text-xs">Try adjusting your filters or search query.</p>
                            </div>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="group">
                    <div className={`rounded-lg border p-6 ${getContainerBgClass()}`}>
                        <p className="text-white/60">Grouped view coming soon...</p>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
};
