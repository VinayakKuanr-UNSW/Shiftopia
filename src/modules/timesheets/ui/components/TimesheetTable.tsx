import React, { useState, useMemo } from "react";
import {
    ArrowUp,
    ArrowDown,
    CheckCircle,
    XCircle,
} from "lucide-react";
import { format } from "date-fns";
import { useTheme } from "@/modules/core/contexts/ThemeContext";
import { useToast } from "@/hooks/use-toast";
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
            className={`text-left p-2 text-xs font-medium text-white/90 cursor-pointer hover:bg-white/5 whitespace-nowrap ${className}`}
            onClick={() => handleSort(field)}
        >
            {label} {getSortIndicator(field)}
        </th>
    );

    const getContainerBgClass = () => {
        if (theme === 'light') {
            return 'bg-white border-gray-200';
        } else if (theme === 'dark') {
            return 'bg-gray-900 border-gray-700';
        } else {
            return 'bg-transparent backdrop-blur-md border-white/10';
        }
    };

    // Header group colors - Updated to dark headers
    const headerGroupStyles = {
        select: 'bg-slate-950',
        employeeInfo: 'bg-slate-900',
        hierarchy2: 'bg-slate-950',
        scheduled: 'bg-slate-900',
        geofenced: 'bg-slate-950',
        adjusted: 'bg-slate-900',
        payroll: 'bg-slate-950',
        statuses: 'bg-slate-900',
        actions: 'bg-slate-950',
    };

    const pendingCount = sortedEntries.filter(e => e.timesheetStatus === 'DRAFT' || e.timesheetStatus === 'SUBMITTED').length;

    return (
        <div className="overflow-x-auto mt-6 text-white">
            <Tabs value={viewMode} onValueChange={(v) => onViewChange(v as 'table' | 'group')}>
                <TabsList className="mb-4">
                    <TabsTrigger value="table">Table View</TabsTrigger>
                    <TabsTrigger value="group" disabled>Grouped View (WIP)</TabsTrigger>
                </TabsList>

                <TabsContent value="table" className="mt-0">
                    <div className={`overflow-x-auto rounded-lg border ${getContainerBgClass()}`}>
                        {/* Header with counts and bulk actions */}
                        <div className="p-4 border-b border-white/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                            <div>
                                <div className="text-lg font-semibold">Timesheets for {format(selectedDate, 'MMMM d, yyyy')}</div>
                                <div className="text-sm text-white/60 mt-1">
                                    {sortedEntries.length} entries found • {pendingCount} pending approval
                                </div>
                            </div>

                            {/* Bulk Actions Toolbar */}
                            {selectedIds.length > 0 && !readOnly && (
                                <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-lg">
                                    <span className="text-sm font-medium">
                                        {selectedIds.length} selected
                                    </span>
                                    <div className="h-4 w-px bg-white/20" />
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={handleBulkApprove}
                                        className="text-green-400 hover:text-green-300 hover:bg-green-500/20"
                                    >
                                        <CheckCircle className="mr-1.5 h-4 w-4" />
                                        Approve All
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={handleBulkReject}
                                        className="text-red-400 hover:text-red-300 hover:bg-red-500/20"
                                    >
                                        <XCircle className="mr-1.5 h-4 w-4" />
                                        Reject All
                                    </Button>
                                </div>
                            )}
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse min-w-[2200px]">
                                <thead>
                                    {/* Row 1: Grouped Headers */}
                                    <tr>
                                        <th className={`p-2 text-xs font-semibold text-white ${headerGroupStyles.select}`}>
                                            {/* Select */}
                                        </th>
                                        <th colSpan={2} className={`p-2 text-xs font-semibold text-white text-center ${headerGroupStyles.employeeInfo}`}>
                                            Employee Info
                                        </th>
                                        <th colSpan={4} className={`p-2 text-xs font-semibold text-white text-center ${headerGroupStyles.hierarchy2}`}>
                                            Hierarchy
                                        </th>
                                        <th colSpan={2} className={`p-2 text-xs font-semibold text-white text-center ${headerGroupStyles.scheduled}`}>
                                            Scheduled
                                        </th>
                                        <th colSpan={2} className={`p-2 text-xs font-semibold text-white text-center ${headerGroupStyles.geofenced}`}>
                                            Geofenced
                                        </th>
                                        <th colSpan={6} className={`p-2 text-xs font-semibold text-white text-center ${headerGroupStyles.adjusted}`}>
                                            Adjusted
                                        </th>
                                        <th colSpan={2} className={`p-2 text-xs font-semibold text-white text-center ${headerGroupStyles.payroll}`}>
                                            Payroll
                                        </th>
                                        <th colSpan={2} className={`p-2 text-xs font-semibold text-white text-center ${headerGroupStyles.statuses}`}>
                                            Statuses
                                        </th>
                                        <th className={`p-2 text-xs font-semibold text-white text-center ${headerGroupStyles.actions}`}>
                                            Actions
                                        </th>
                                    </tr>

                                    {/* Row 2: Individual Headers */}
                                    <tr className="bg-black/40">
                                        {/* Select */}
                                        <th className="p-2 text-xs font-medium text-white/90">
                                            <input
                                                type="checkbox"
                                                onChange={handleSelectAll}
                                                checked={selectedIds.length > 0 && selectedIds.length === sortedEntries.filter(e => e.timesheetStatus === 'DRAFT' || e.timesheetStatus === 'SUBMITTED').length}
                                                className="rounded"
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
                                        <SortableHeader field="liveStatus" label="Live Status" />
                                        <SortableHeader field="timesheetStatus" label="Timesheet Status" />
                                        {/* Actions */}
                                        <th className="p-2 text-xs font-medium text-white/90 text-center whitespace-nowrap">
                                            Audit Trail / Approve / Reject
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
                            <div className="p-8 text-center text-white/60">
                                No timesheet entries found for the selected filters.
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
