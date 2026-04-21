import React, { useState, useEffect } from 'react';
import {
    Download, RefreshCw, ChevronLeft, ChevronRight,
    FileSpreadsheet, FileText, Search, Filter, X,
    LayoutGrid, Table2, CheckCircle, XCircle, CheckSquare,
} from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import { format, addDays, subDays } from 'date-fns';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import {
    Popover, PopoverContent, PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { Calendar as CalendarComponent } from '@/modules/core/ui/primitives/calendar';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import {
    TooltipProvider, Tooltip, TooltipTrigger, TooltipContent,
} from '@/modules/core/ui/primitives/tooltip';
import {
    FilterContent,
    ActiveFilters,
    EMPTY_FILTERS,
} from './TimesheetFilterDrawer';
import type { TimesheetRow } from '../../model/timesheet.types';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface TimesheetFunctionBarProps {
    // View
    viewMode: 'table' | 'timecard';
    onViewChange: (view: 'table' | 'timecard') => void;
    // Date
    selectedDate: Date;
    onDateChange: (date: Date) => void;
    // Search
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    // Filters — shared state owned by TimesheetTable
    entries: TimesheetRow[];
    appliedFilters: ActiveFilters;
    onApplyFilters: (f: ActiveFilters) => void;
    activeFilterCount: number;
    // Export + Refresh
    onExportPDF: () => void;
    onExportSpreadsheet: () => void;
    onRefresh: () => void;
    isRefreshing: boolean;
    // Bulk selection
    isSelectMode: boolean;
    onToggleSelectMode: () => void;
    selectedCount: number;
    onBulkApprove: () => void;
    onBulkReject: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const TimesheetFunctionBar: React.FC<TimesheetFunctionBarProps> = ({
    viewMode, onViewChange,
    selectedDate, onDateChange,
    searchQuery, setSearchQuery,
    entries, appliedFilters, onApplyFilters, activeFilterCount,
    onExportPDF, onExportSpreadsheet,
    onRefresh, isRefreshing,
    isSelectMode, onToggleSelectMode,
    selectedCount, onBulkApprove, onBulkReject,
}) => {
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [draftFilters, setDraftFilters] = useState<ActiveFilters>(EMPTY_FILTERS);

    const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

    // Sync draft to applied state whenever the popover opens
    useEffect(() => {
        if (isFilterOpen) setDraftFilters(appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isFilterOpen]);

    return (
        <div className="flex items-center gap-2 min-h-[44px]">

            {/* ── View switch ── */}
            <div className="flex items-center rounded-xl border border-border/60 bg-muted/30 p-0.5 shrink-0 gap-0.5">
                {([
                    { id: 'table',    label: 'Table', Icon: Table2 },
                    { id: 'timecard', label: 'Cards', Icon: LayoutGrid },
                ] as const).map(({ id, label, Icon }) => (
                    <button
                        key={id}
                        onClick={() => onViewChange(id)}
                        className={cn(
                            'flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all whitespace-nowrap',
                            viewMode === id
                                ? 'bg-background text-primary shadow-sm border border-border/40'
                                : 'text-muted-foreground/70 hover:text-foreground',
                        )}
                    >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="hidden sm:inline">{label}</span>
                    </button>
                ))}
            </div>

            {/* ── Date navigator ── */}
            <div className="flex items-center bg-muted/30 border border-border/50 rounded-xl p-0.5 shrink-0 gap-0.5">
                <button
                    onClick={() => onDateChange(subDays(selectedDate, 1))}
                    className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                    <PopoverTrigger asChild>
                        <button className="flex items-center gap-1.5 px-2.5 h-8 font-black text-[12px] text-foreground hover:text-primary rounded-lg transition-colors min-w-[118px] justify-center">
                            {isToday && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                            {format(selectedDate, 'EEE, MMM d')}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 bg-popover border-border rounded-2xl shadow-2xl" align="start">
                        <CalendarComponent
                            mode="single"
                            selected={selectedDate}
                            onSelect={(d) => { if (d) { onDateChange(d); setIsCalendarOpen(false); } }}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
                <button
                    onClick={() => onDateChange(addDays(selectedDate, 1))}
                    className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>

            {/* ── Center: search or bulk-action bar ── */}
            {isSelectMode && selectedCount > 0 ? (
                <div className="flex-1 flex items-center gap-2 px-3 h-9 bg-primary/5 border border-primary/20 rounded-xl animate-in fade-in slide-in-from-left-2 duration-150 min-w-0 overflow-hidden">
                    <span className="text-[11px] font-black text-primary uppercase tracking-widest shrink-0">
                        {selectedCount} selected
                    </span>
                    <div className="h-3.5 w-px bg-primary/20 shrink-0" />
                    <button
                        onClick={onBulkApprove}
                        className="flex items-center gap-1 h-6 px-2.5 rounded-lg bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest shadow-sm hover:bg-emerald-600 transition-colors active:scale-95 shrink-0"
                    >
                        <CheckCircle className="h-3 w-3" />
                        Approve
                    </button>
                    <button
                        onClick={onBulkReject}
                        className="flex items-center gap-1 h-6 px-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-[10px] font-black uppercase tracking-widest hover:bg-rose-500/15 transition-colors active:scale-95 shrink-0"
                    >
                        <XCircle className="h-3 w-3" />
                        Reject
                    </button>
                </div>
            ) : (
                <div className="relative flex-1 min-w-[160px] group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 group-focus-within:text-primary transition-colors pointer-events-none" />
                    <Input
                        placeholder="Search employee, ID, role..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 h-9 bg-muted/30 border-border/60 rounded-xl text-[13px] font-medium focus-visible:ring-1 focus-visible:ring-primary/40 pr-8"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center text-muted-foreground/50 hover:text-foreground rounded-full hover:bg-muted/50 transition-all"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>
            )}

            {/* ── Right: Filters · Export · Refresh · Select ── */}
            <div className="flex items-center gap-1 shrink-0">

                {/* Filters — desktop popover using shared FilterContent */}
                <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
                    <PopoverTrigger asChild>
                        <button className={cn(
                            'flex items-center gap-1.5 h-9 px-2.5 md:px-3 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all',
                            activeFilterCount > 0
                                ? 'bg-primary/10 border-primary/30 text-primary'
                                : 'bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/60',
                        )}>
                            <Filter className="h-3.5 w-3.5 shrink-0" />
                            <span className="hidden md:inline">Filters</span>
                            {activeFilterCount > 0 && (
                                <Badge className="h-4 w-4 rounded-full p-0 flex items-center justify-center text-[9px] font-black bg-primary text-primary-foreground">
                                    {activeFilterCount}
                                </Badge>
                            )}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        className="w-80 p-5 bg-popover border-border rounded-2xl shadow-2xl"
                        align="end"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60">
                                Filters
                            </p>
                            {activeFilterCount > 0 && (
                                <button
                                    onClick={() => { onApplyFilters(EMPTY_FILTERS); setIsFilterOpen(false); }}
                                    className="text-[10px] font-black uppercase tracking-widest text-destructive hover:text-destructive/80 transition-colors"
                                >
                                    Clear all
                                </button>
                            )}
                        </div>
                        <FilterContent
                            draftFilters={draftFilters}
                            setDraftFilters={setDraftFilters}
                            entries={entries}
                            onApply={(f) => { onApplyFilters(f); setIsFilterOpen(false); }}
                            onReset={() => setDraftFilters(EMPTY_FILTERS)}
                            compact
                        />
                    </PopoverContent>
                </Popover>

                {/* Export */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-1.5 h-9 px-2.5 md:px-3 rounded-xl border bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/60 text-[11px] font-black uppercase tracking-wider transition-all">
                            <Download className="h-3.5 w-3.5 shrink-0" />
                            <span className="hidden md:inline">Export</span>
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-popover border-border rounded-xl shadow-xl">
                        <DropdownMenuItem onClick={onExportPDF} className="cursor-pointer">
                            <FileText className="mr-2 h-4 w-4" />Export as PDF
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onExportSpreadsheet} className="cursor-pointer">
                            <FileSpreadsheet className="mr-2 h-4 w-4" />Export as Spreadsheet
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Refresh */}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="h-9 w-9 flex items-center justify-center rounded-xl border bg-muted/30 border-border/50 text-primary/70 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-50"
                            >
                                <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{isRefreshing ? 'Refreshing…' : 'Refresh'}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                {/* Bulk-select toggle */}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={onToggleSelectMode}
                                className={cn(
                                    'h-9 w-9 flex items-center justify-center rounded-xl border transition-all',
                                    isSelectMode
                                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                        : 'bg-muted/30 border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60',
                                )}
                            >
                                <CheckSquare className="h-4 w-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{isSelectMode ? 'Exit Selection' : 'Bulk Select'}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
        </div>
    );
};
