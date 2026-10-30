import { PageState } from '@/modules/core/ui/components/PageState';
import { tableTokens, TableStateRow } from '@/modules/core/ui/primitives/table';
import React, { useState, useMemo } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { useTheme } from "@/modules/core/contexts/ThemeContext";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { TimesheetRow } from "../../model/timesheet.types";

import { cn } from "@/modules/core/lib/utils";
import { TimesheetMobileView } from "./TimesheetMobileView";
import { TimesheetTimecardView } from "./TimesheetTimecardView";
import { TimesheetRow as TimesheetRowComponent } from "./TimesheetRow";
import { TimesheetFunctionBar } from "./TimesheetHeader";
import {
    ActiveFilters,
    EMPTY_FILTERS,
    countActiveFilters,
    applyTimesheetFilters,
} from "./TimesheetFilterDrawer";
import { exportTimesheetXLSX, exportTimesheetPDF } from "./timesheet.export";
import { isEntryReviewable } from "./TimesheetTable.utils";
import { groupRows, isTodayBucketKey, type RowGroupBy } from "@/modules/core/lib/row-grouping";
import { extractTimesheetGroupFields, timesheetGroupLabelFor } from "../../domain/timesheet-grouping";
import { GroupSectionHeader } from "@/modules/core/ui/components/GroupSectionHeader";

// ── Props ─────────────────────────────────────────────────────────────────────

interface TimesheetTableProps {
    entries: TimesheetRow[];
    selectedDate: Date;
    readOnly?: boolean;
    viewMode: "table" | "timecard";
    onViewChange: (view: "table" | "timecard") => void;
    searchQuery?: string;
    setSearchQuery?: (q: string) => void;
    appliedFilters?: ActiveFilters;
    onApplyFilters?: (f: ActiveFilters) => void;
    activeFilterCount?: number;
    groupBy?: RowGroupBy;
    onSaveEntry?: (id: string, updates: Partial<TimesheetRow>) => void;
    onBulkAction?: (ids: string[], action: "approve" | "reject") => void;
    onMarkNoShow?: (id: string) => void;
    onDateChange?: (date: Date) => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    hideTopControls?: boolean;
    showDate?: boolean;
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
    appliedFilters: propsAppliedFilters,
    onApplyFilters: propsOnApplyFilters,
    activeFilterCount: propsActiveFilterCount,
    groupBy = "none",
    onSaveEntry,
    onBulkAction,
    onMarkNoShow,
    onDateChange,
    onRefresh,
    isRefreshing,
    hideTopControls = false,
    showDate = false,
}) => {
    // ── Filter state (can be passed from parent or owned here) ─────────────
    const [internalFilters, setInternalFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
    const appliedFilters = propsAppliedFilters ?? internalFilters;
    const setAppliedFilters = propsOnApplyFilters ?? setInternalFilters;
    const calculatedFilterCount = useMemo(() => countActiveFilters(appliedFilters), [appliedFilters]);
    const activeFilterCount = propsActiveFilterCount ?? calculatedFilterCount;

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

    // ── Group By (Date / Group / Sub-Group / Role / Timesheet Status / None) ──
    const groupedBuckets = useMemo(
        () => groupRows(sortedEntries, groupBy, extractTimesheetGroupFields, timesheetGroupLabelFor),
        [sortedEntries, groupBy],
    );

    const SortableHeader = ({ field, label, className, title }: { field: keyof TimesheetRow, label: string, className?: string, title?: string }) => {
        const isSorted = sortField === field;
        const currentSort = isSorted ? (sortDirection === "asc" ? "ascending" : "descending") : "none";
        return (
            <th
                scope="col"
                role="columnheader"
                aria-sort={currentSort}
                title={title}
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSort(field);
                    }
                }}
                onClick={() => handleSort(field)}
                aria-label={`Sort by ${label}${isSorted ? `, currently sorted ${currentSort}` : ''}`}
                className={cn(
                    tableTokens.head, "px-3 cursor-pointer group hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    className
                )}
            >
                <div className="flex items-center gap-1">
                    <span>{label}</span>
                    <div 
                        className={cn("transition-opacity", isSorted ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                        aria-hidden="true"
                    >
                        {getSortIndicator(field) || <ArrowDown className="h-3 w-3 text-muted-foreground/40" />}
                    </div>
                </div>
            </th>
        );
    };

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
                    // Only entries at a terminal attendance state (No-Show, clock-out,
                    // or auto clock-out) are eligible for bulk approve/reject.
                    return isEntryReviewable(e);
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



    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div>

            {/* ── Mobile view (< md) ── */}
            <div className="block md:hidden">
                <TimesheetMobileView
                    entries={entries}
                    readOnly={readOnly}
                    searchQuery={searchQuery}
                    appliedFilters={appliedFilters}
                    onApplyFilters={setAppliedFilters}
                    activeFilterCount={activeFilterCount}
                    groupBy={groupBy}
                    onSaveEntry={onSaveEntry}
                    onBulkAction={onBulkAction}
                    onMarkNoShow={onMarkNoShow}
                    onExportSpreadsheet={handleExportXLSX}
                />
            </div>

            {/* ── Desktop view (≥ md) ── */}
            <div className="hidden md:block space-y-5">

                {/* Unified function bar */}
                {!hideTopControls && (
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
                )}



                {/* Timecard View */}
                {viewMode === "timecard" && (
                    <TimesheetTimecardView
                        buckets={groupedBuckets}
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

                {/* Table View */}
                {viewMode === "table" && (
                    <div className="rounded-2xl border border-border/60 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className={cn(tableTokens.table, "min-w-[2200px]")} aria-label="Timesheets detailed entry table">
                                <thead className={tableTokens.header}>
                                    <tr>
                                        {/* Multi-header groups */}
                                        <th className={tableTokens.head} />
                                        {showDate && <th className={cn(tableTokens.head, "border-r border-border/30")} />}
                                        <th colSpan={2} className={cn(tableTokens.head, "text-center border-r border-border/30")}>
                                            Employee
                                        </th>
                                        <th colSpan={4} className={cn(tableTokens.head, "text-center border-r border-border/30")}>
                                            Organization & Role
                                        </th>
                                        <th colSpan={2} className={cn(tableTokens.head, "text-center border-r border-border/30")}>
                                            Scheduled
                                        </th>
                                        <th colSpan={2} className={cn(tableTokens.head, "text-center border-r border-border/30")}>
                                            Attendance (Actual)
                                        </th>
                                        <th colSpan={6} className={cn(tableTokens.head, "text-center text-primary bg-primary/5 border-r border-border/30")}>
                                            Adjusted (Inline Edit)
                                        </th>
                                        <th className={cn(tableTokens.head, "text-center border-r border-border/30")}>
                                            Diff
                                        </th>
                                        <th colSpan={3} className={cn(tableTokens.head, "text-center border-r border-border/30")}>
                                            Statuses
                                        </th>
                                        <th className={tableTokens.head} />
                                    </tr>
                                    <tr>
                                        {/* Select All */}
                                        <th className={cn(tableTokens.head, "w-10 px-3 border-r border-border/30")}>
                                            <div className="flex justify-center">
                                                <div className="h-4 w-4 rounded border-border bg-background" />
                                            </div>
                                        </th>
                                        {/* Date */}
                                        {showDate && (
                                            <SortableHeader field="date" label="Date" className="border-r border-border/30" />
                                        )}
                                        {/* Employee */}
                                        <SortableHeader field="employeeId" label="ID" />
                                        <SortableHeader field="employee" label="Name" className="border-r border-border/30" />
                                        {/* Organization */}
                                        <SortableHeader field="group" label="Group" />
                                        <SortableHeader field="subGroup" label="Sub-Group" />
                                        <SortableHeader field="role" label="Role" />
                                        <SortableHeader field="remunerationLevel" label="Level" className="border-r border-border/30" />
                                        {/* Scheduled */}
                                        <SortableHeader field="scheduledStart" label="Start" />
                                        <SortableHeader field="scheduledEnd" label="End" className="border-r border-border/30" />
                                        {/* Actual */}
                                        <SortableHeader field="clockIn" label="Clock In" />
                                        <SortableHeader field="clockOut" label="Clock Out" className="border-r border-border/30" />
                                        {/* Adjusted */}
                                        <SortableHeader field="adjustedStart" label="Start" className="bg-primary/5" />
                                        <SortableHeader field="adjustedEnd" label="End" className="bg-primary/5" />
                                        <SortableHeader field="length" label="Length" className="bg-primary/5 border-r border-border/30" />
                                        <th className={cn(tableTokens.head, "px-3 bg-primary/5")}>Paid</th>
                                        <th className={cn(tableTokens.head, "px-3 bg-primary/5")}>Unpaid</th>
                                        <SortableHeader field="netLength" label="Net" className="bg-primary/5 border-r border-border/30" />
                                        <SortableHeader field="differential" label="Diff" className="border-r border-border/30" />
                                        {/* Statuses */}
                                        <SortableHeader field="liveStatus" label="Time Rules" />
                                        <SortableHeader field="timesheetStatus" label="Live Rules" />
                                        <th className={cn(tableTokens.head, "px-3 border-r border-border/30")} title="Billable window vs roster — what payroll pays">Payroll Rules</th>
                                        {/* Actions */}
                                        <th className={cn(tableTokens.head, "px-3 text-foreground/70 text-center")}>
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedEntries.length === 0 ? (
                                        <TableStateRow colSpan={showDate ? 24 : 23}>
                                            <PageState state="empty" scope="section" title="No records found" description="Try adjusting your filters or search query." />
                                        </TableStateRow>
                                    ) : (
                                        groupedBuckets.map((bucket) => (
                                            <React.Fragment key={bucket.key}>
                                                {bucket.label && (
                                                    <tr className="border-b border-border/60">
                                                        <td colSpan={showDate ? 24 : 23} className="bg-muted/30 px-4 py-1.5">
                                                            <GroupSectionHeader
                                                                label={bucket.label}
                                                                count={bucket.items.length}
                                                                itemNoun="entry"
                                                                emphasized={isTodayBucketKey(bucket.key)}
                                                                className="mb-0"
                                                            />
                                                        </td>
                                                    </tr>
                                                )}
                                                {bucket.items.map((entry) => (
                                                    <TimesheetRowComponent
                                                        key={entry.id}
                                                        entry={entry}
                                                        readOnly={readOnly}
                                                        isSelected={selectedIds.includes(String(entry.id))}
                                                        onToggleSelect={() => handleToggleSelect(String(entry.id))}
                                                        onSave={onSaveEntry}
                                                        onMarkNoShow={onMarkNoShow}
                                                        showDate={showDate}
                                                    />
                                                ))}
                                            </React.Fragment>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
