import React, { useState, useMemo } from "react";
import { ArrowUp, ArrowDown, XCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useTheme } from "@/modules/core/contexts/ThemeContext";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { TimesheetRow } from "../../model/timesheet.types";
import { TimesheetRow as TimesheetRowComponent } from "./TimesheetRow";
import { TimesheetMobileView } from "./TimesheetMobileView";
import { TimesheetTimecardView } from "./TimesheetTimecardView";
import { TimesheetFunctionBar } from "./TimesheetHeader";
import {
    ActiveFilters,
    EMPTY_FILTERS,
    countActiveFilters,
    applyTimesheetFilters,
} from "./TimesheetFilterDrawer";
import { exportTimesheetXLSX, exportTimesheetPDF } from "./timesheet.export";
import { isShiftFinished } from "./TimesheetTable.utils";

// ── Props ─────────────────────────────────────────────────────────────────────

interface TimesheetTableProps {
    entries: TimesheetRow[];
    selectedDate: Date;
    readOnly?: boolean;
    viewMode: "table" | "timecard";
    onViewChange: (view: "table" | "timecard") => void;
    searchQuery?: string;
    setSearchQuery?: (q: string) => void;
    onSaveEntry?: (id: string, updates: Partial<TimesheetRow>) => void;
    onBulkAction?: (ids: string[], action: "approve" | "reject") => void;
    onMarkNoShow?: (id: string) => void;
    onDateChange?: (date: Date) => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const TimesheetTable: React.FC<TimesheetTableProps> = ({
    entries,
    selectedDate,
    readOnly = false,
    viewMode,
    onViewChange,
    searchQuery = "",
    setSearchQuery,
    onSaveEntry,
    onBulkAction,
    onMarkNoShow,
    onDateChange,
    onRefresh,
    isRefreshing,
}) => {
    // ── Filter state (owned here, shared to both mobile + desktop) ─────────────
    const [appliedFilters, setAppliedFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
    const activeFilterCount = useMemo(() => countActiveFilters(appliedFilters), [appliedFilters]);

    // ── Sort state ─────────────────────────────────────────────────────────────
    const [sortField, setSortField] = useState<keyof TimesheetRow | null>(null);
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

    // ── Bulk selection state ───────────────────────────────────────────────────
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isSelectMode, setIsSelectMode] = useState(false);

    useTheme();
    const { toast } = useToast();

    // ── Filtering (shared logic from TimesheetFilterDrawer) ────────────────────
    const filteredEntries = useMemo(
        () => applyTimesheetFilters(entries, appliedFilters, searchQuery),
        [entries, appliedFilters, searchQuery],
    );

    // ── Sorting ────────────────────────────────────────────────────────────────
    const handleSort = (field: keyof TimesheetRow) => {
        setSortField(f => {
            if (f === field) {
                setSortDirection(d => (d === "asc" ? "desc" : "asc"));
                return f;
            }
            setSortDirection("asc");
            return field;
        });
    };

    const getSortIndicator = (field: keyof TimesheetRow) => {
        if (sortField !== field) return null;
        return sortDirection === "asc"
            ? <ArrowUp className="inline h-3 w-3 ml-1" />
            : <ArrowDown className="inline h-3 w-3 ml-1" />;
    };

    const sortedEntries = useMemo(() => {
        if (!sortField) return filteredEntries;
        return [...filteredEntries].sort((a, b) => {
            const av = a[sortField], bv = b[sortField];
            if (typeof av === "string" && typeof bv === "string")
                return sortDirection === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
            if (typeof av === "number" && typeof bv === "number")
                return sortDirection === "asc" ? av - bv : bv - av;
            return 0;
        });
    }, [filteredEntries, sortField, sortDirection]);

    // ── Export handlers (operate on the currently filtered + sorted view) ──────
    const handleExportXLSX = () => exportTimesheetXLSX(sortedEntries, selectedDate);
    const handleExportPDF  = () => exportTimesheetPDF(sortedEntries, selectedDate);

    // ── Selection helpers ──────────────────────────────────────────────────────
    const selectableIds = useMemo(
        () =>
            sortedEntries
                .filter(e => {
                    const s = (e.timesheetStatus || "").toLowerCase();
                    if (s !== "draft" && s !== "submitted") return false;
                    return isShiftFinished(e.date, e.scheduledStart, e.scheduledEnd, e.clockOut);
                })
                .map(e => String(e.id)),
        [sortedEntries],
    );

    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const handleSelectAll = () => {
        if (selectedIds.length === selectableIds.length && selectableIds.length > 0) {
            setSelectedIds([]);
        } else {
            setSelectedIds(selectableIds);
        }
    };

    const handleToggleSelectMode = () => {
        setIsSelectMode(v => {
            if (v) setSelectedIds([]);
            return !v;
        });
    };

    const handleBulkApprove = () => {
        if (selectedIds.length === 0) {
            toast({ title: "No entries selected", description: "Select at least one pending entry.", variant: "destructive" });
            return;
        }
        onBulkAction?.(selectedIds, "approve");
        toast({ title: "Bulk Approval", description: `${selectedIds.length} timesheet(s) approved.` });
        setSelectedIds([]);
    };

    const handleBulkReject = () => {
        if (selectedIds.length === 0) {
            toast({ title: "No entries selected", description: "Select at least one pending entry.", variant: "destructive" });
            return;
        }
        onBulkAction?.(selectedIds, "reject");
        toast({ title: "Bulk Rejection", description: `${selectedIds.length} timesheet(s) rejected.` });
        setSelectedIds([]);
    };

    // ── Table helpers ──────────────────────────────────────────────────────────
    const SortableHeader: React.FC<{
        field: keyof TimesheetRow;
        label: string;
        className?: string;
    }> = ({ field, label, className = "" }) => (
        <th
            className={`text-left p-2.5 text-[10px] font-black uppercase tracking-widest text-foreground/70 cursor-pointer hover:bg-muted/50 whitespace-nowrap transition-colors border-b border-border/50 ${className}`}
            onClick={() => handleSort(field)}
        >
            <div className="flex items-center">{label} {getSortIndicator(field)}</div>
        </th>
    );

    const headerGroupStyles = {
        select:       "bg-muted/50 border-r border-border/30",
        employeeInfo: "bg-primary/5 border-r border-border/30",
        hierarchy2:   "bg-muted/50 border-r border-border/30",
        scheduled:    "bg-primary/5 border-r border-border/30",
        geofenced:    "bg-muted/50 border-r border-border/30",
        adjusted:     "bg-primary/5 border-r border-border/30",
        payroll:      "bg-muted/50 border-r border-border/30",
        statuses:     "bg-primary/5 border-r border-border/30",
        actions:      "bg-muted/50",
    };

    const pendingCount = sortedEntries.filter(e => {
        const s = (e.timesheetStatus || "").toLowerCase();
        return s === "draft" || s === "submitted";
    }).length;

    const attendanceSummary = useMemo(() => ({
        late: sortedEntries.filter(e => e.attendanceStatus === "late").length,
        noShow: sortedEntries.filter(e => e.attendanceStatus === "no_show").length,
        missing: sortedEntries.filter(e => {
            const isActiveOrComplete = e.liveStatus === "InProgress" || e.liveStatus === "Completed";
            const noCheckIn = !e.clockIn || e.clockIn === "-";
            return isActiveOrComplete && noCheckIn && e.attendanceStatus !== "no_show";
        }).length,
    }), [sortedEntries]);

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="md:mt-8 mt-0">

            {/* ── Mobile view (< md) ── */}
            <div className="block md:hidden">
                <TimesheetMobileView
                    entries={entries}
                    selectedDate={selectedDate}
                    readOnly={readOnly}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    appliedFilters={appliedFilters}
                    onApplyFilters={setAppliedFilters}
                    activeFilterCount={activeFilterCount}
                    onSaveEntry={onSaveEntry}
                    onBulkAction={onBulkAction}
                    onMarkNoShow={onMarkNoShow}
                    onDateChange={onDateChange}
                    onRefresh={onRefresh}
                    isRefreshing={isRefreshing}
                    onExportPDF={handleExportPDF}
                    onExportSpreadsheet={handleExportXLSX}
                />
            </div>

            {/* ── Desktop view (≥ md) ── */}
            <div className="hidden md:block space-y-5">

                {/* Unified function bar */}
                <TimesheetFunctionBar
                    viewMode={viewMode}
                    onViewChange={onViewChange}
                    selectedDate={selectedDate}
                    onDateChange={onDateChange ?? (() => {})}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery ?? (() => {})}
                    entries={entries}
                    appliedFilters={appliedFilters}
                    onApplyFilters={setAppliedFilters}
                    activeFilterCount={activeFilterCount}
                    onExportPDF={handleExportPDF}
                    onExportSpreadsheet={handleExportXLSX}
                    onRefresh={onRefresh ?? (() => {})}
                    isRefreshing={isRefreshing ?? false}
                    isSelectMode={isSelectMode}
                    onToggleSelectMode={handleToggleSelectMode}
                    selectedCount={selectedIds.length}
                    onBulkApprove={handleBulkApprove}
                    onBulkReject={handleBulkReject}
                />

                {/* Table View */}
                {viewMode === "table" && (
                    <div className="overflow-x-auto">

                        {/* Attendance issues bar */}
                        {(attendanceSummary.late > 0 || attendanceSummary.noShow > 0 || attendanceSummary.missing > 0) && (
                            <div className="px-5 py-2.5 border-b border-border bg-amber-500/5 flex items-center gap-3 flex-wrap">
                                <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />Attendance Flags:
                                </span>
                                {attendanceSummary.late > 0 && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                        Late In · {attendanceSummary.late}
                                    </span>
                                )}
                                {attendanceSummary.noShow > 0 && (
                                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                                        <XCircle size={12} className="shrink-0" />
                                        <span className="text-[10px] font-black uppercase tracking-tight">{attendanceSummary.noShow} No Show</span>
                                    </div>
                                )}
                                {attendanceSummary.missing > 0 && (
                                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                                        <AlertTriangle size={12} className="shrink-0" />
                                        <span className="text-[10px] font-black uppercase tracking-tight">{attendanceSummary.missing} Missing Check-in</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Entry count row */}
                        <div className="px-5 py-3 border-b border-border/50 flex items-center gap-2 bg-muted/5">
                            <span className="text-sm text-muted-foreground">
                                <span className="font-black text-primary">{sortedEntries.length}</span> entries
                                {pendingCount > 0 && (
                                    <> · <span className="font-black text-amber-500">{pendingCount}</span> pending</>
                                )}
                                <span className="text-muted-foreground/50 ml-2">
                                    — {format(selectedDate, "MMMM d, yyyy")}
                                </span>
                            </span>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse min-w-[2200px]">
                                <thead>
                                    <tr className="border-b border-border/50">
                                        <th className={`p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ${headerGroupStyles.select}`} />
                                        <th colSpan={2} className={`p-3 text-[10px] font-black uppercase tracking-widest text-primary text-center border-b-2 border-primary/20 ${headerGroupStyles.employeeInfo}`}>Employee Info</th>
                                        <th colSpan={4} className={`p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 ${headerGroupStyles.hierarchy2}`}>Hierarchy</th>
                                        <th colSpan={2} className={`p-3 text-[10px] font-black uppercase tracking-widest text-primary text-center border-b-2 border-primary/20 ${headerGroupStyles.scheduled}`}>Scheduled</th>
                                        <th colSpan={2} className={`p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 ${headerGroupStyles.geofenced}`}>Attendance (Actual)</th>
                                        <th colSpan={6} className={`p-3 text-[10px] font-black uppercase tracking-widest text-primary text-center border-b-2 border-primary/20 ${headerGroupStyles.adjusted}`}>Adjusted (Billable)</th>
                                        <th colSpan={2} className={`p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 ${headerGroupStyles.payroll}`}>Payroll</th>
                                        <th colSpan={3} className={`p-3 text-[10px] font-black uppercase tracking-widest text-primary text-center border-b-2 border-primary/20 ${headerGroupStyles.statuses}`}>Status</th>
                                        <th className={`p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center border-b-2 border-border/50 ${headerGroupStyles.actions}`}>Actions</th>
                                    </tr>
                                    <tr className="bg-muted/30">
                                        <th className="p-3 text-center border-b border-border/50 border-r border-border/30">
                                            {isSelectMode && (
                                                <input
                                                    type="checkbox"
                                                    onChange={handleSelectAll}
                                                    checked={selectedIds.length > 0 && selectedIds.length === selectableIds.length}
                                                    className="rounded border-border bg-background"
                                                    disabled={selectableIds.length === 0}
                                                />
                                            )}
                                        </th>
                                        <SortableHeader field="employeeId"        label="Employee ID" />
                                        <SortableHeader field="employee"          label="Employee" />
                                        <SortableHeader field="group"             label="Group" />
                                        <SortableHeader field="subGroup"          label="Sub-Group" />
                                        <SortableHeader field="role"              label="Role" />
                                        <SortableHeader field="remunerationLevel" label="Remuneration Level" />
                                        <SortableHeader field="scheduledStart"    label="Scheduled Start" />
                                        <SortableHeader field="scheduledEnd"      label="Scheduled End" />
                                        <SortableHeader field="clockIn"           label="Clock-In" />
                                        <SortableHeader field="clockOut"          label="Clock-Out" />
                                        <SortableHeader field="adjustedStart"     label="Adjusted Start" />
                                        <SortableHeader field="adjustedEnd"       label="Adjusted End" />
                                        <SortableHeader field="length"            label="Length" />
                                        <SortableHeader field="paidBreak"         label="Paid Break" />
                                        <SortableHeader field="unpaidBreak"       label="Unpaid Break" />
                                        <SortableHeader field="netLength"         label="Net Length" />
                                        <SortableHeader field="approximatePay"    label="Approximate Pay" />
                                        <SortableHeader field="differential"      label="Differential" />
                                        <th className="p-2.5 text-[10px] font-black uppercase tracking-widest text-foreground/70 border-b border-border/50 text-center w-8">●</th>
                                        <SortableHeader field="liveStatus"        label="Lifecycle" />
                                        <SortableHeader field="timesheetStatus"   label="Timesheet" />
                                        <th className="p-3 text-[10px] font-black uppercase tracking-widest text-foreground/70 text-center border-b border-border/50">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedEntries.map((entry) => (
                                        <TimesheetRowComponent
                                            key={entry.id}
                                            entry={entry}
                                            readOnly={readOnly}
                                            isSelected={selectedIds.includes(String(entry.id))}
                                            onToggleSelect={isSelectMode ? () => handleToggleSelect(String(entry.id)) : undefined}
                                            onSave={onSaveEntry}
                                            onMarkNoShow={onMarkNoShow}
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
                )}

                {/* Timecard View */}
                {viewMode === "timecard" && (
                    <TimesheetTimecardView
                        entries={sortedEntries}
                        selectedIds={selectedIds}
                        isSelectMode={isSelectMode}
                        onToggleSelect={handleToggleSelect}
                        onSelectAll={handleSelectAll}
                        onClearSelection={() => setSelectedIds([])}
                        totalSelectable={selectableIds.length}
                        onSaveEntry={onSaveEntry}
                        onMarkNoShow={onMarkNoShow}
                        readOnly={readOnly}
                        onClearFilters={() => setAppliedFilters(EMPTY_FILTERS)}
                    />
                )}
            </div>
        </div>
    );
};
