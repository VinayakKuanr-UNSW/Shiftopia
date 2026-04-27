import React, { useState, useMemo } from "react";
import { ArrowUp, ArrowDown, XCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useTheme } from "@/modules/core/contexts/ThemeContext";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { TimesheetRow } from "../../model/timesheet.types";

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
    hideTopControls?: boolean;
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
    hideTopControls = false,
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
