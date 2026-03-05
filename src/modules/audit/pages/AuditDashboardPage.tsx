import { useState, useMemo, useCallback } from 'react';
import { Search, Calendar, Filter, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { AuditTable } from '../components/AuditTable';
import { useAuditData } from '../hooks/useAuditData';
import { OrgDeptSelector } from '../components/OrgDeptSelector';
import type { AuditFilters, PaginationState } from '../types/audit-types';

const dateRangeOptions = [
    { label: 'Last 7 Days', days: 7 },
    { label: 'Last 30 Days', days: 30 },
    { label: 'Last 90 Days', days: 90 },
    { label: 'All Time', days: 365 },
];

const eventTypeOptions = [
    { value: '', label: 'All Events' },
    { value: 'shift_created_draft', label: 'Created (Draft)' },
    { value: 'shift_created_published', label: 'Created & Published' },
    { value: 'published', label: 'Published' },
    { value: 'employee_assigned', label: 'Assigned' },
    { value: 'employee_unassigned', label: 'Unassigned' },
    { value: 'pushed_to_bidding', label: 'Pushed to Bidding' },
    { value: 'removed_from_bidding', label: 'Removed from Bidding' },
    { value: 'field_updated', label: 'Field Updated' },
    { value: 'status_changed', label: 'Status Changed' },
    { value: 'shift_deleted', label: 'Deleted' },
];

const pageSizeOptions = [10, 25, 50, 100];

function AuditDashboardPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDateRange, setSelectedDateRange] = useState(7);
    const [selectedEventType, setSelectedEventType] = useState('');
    const [pagination, setPagination] = useState<PaginationState>({
        page: 0,
        pageSize: 25,
        total: 0,
    });

    // Organization/Department/Sub-Department state
    const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
    const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
    const [selectedSubDepartmentId, setSelectedSubDepartmentId] = useState<string | null>(null);

    const filters: AuditFilters = useMemo(() => {
        const now = new Date();
        const start = new Date();
        start.setDate(now.getDate() - selectedDateRange);

        return {
            dateRange: { start, end: now },
            eventType: (selectedEventType || undefined) as any,
            searchQuery: searchQuery || undefined,
            organizationId: selectedOrganizationId || undefined,
            departmentId: selectedDepartmentId || undefined,
            subDepartmentId: selectedSubDepartmentId || undefined,
        };
    }, [searchQuery, selectedDateRange, selectedEventType, selectedOrganizationId, selectedDepartmentId, selectedSubDepartmentId]);

    const { groupedShifts, loading, totalCount } = useAuditData(filters, pagination);

    // Calculate total pages
    const totalPages = Math.ceil(totalCount / pagination.pageSize);

    // Pagination handlers
    const goToPage = useCallback((page: number) => {
        if (page >= 0 && page < totalPages) {
            setPagination(prev => ({ ...prev, page }));
        }
    }, [totalPages]);

    const handlePageSizeChange = useCallback((size: number) => {
        setPagination(prev => ({ ...prev, pageSize: size, page: 0 }));
    }, []);

    // Generate page numbers to display
    const getVisiblePages = () => {
        const pages: (number | 'ellipsis')[] = [];
        const current = pagination.page;

        if (totalPages <= 7) {
            // Show all pages if 7 or fewer
            for (let i = 0; i < totalPages; i++) pages.push(i);
        } else {
            // Always show first page
            pages.push(0);

            if (current > 2) {
                pages.push('ellipsis');
            }

            // Show pages around current
            for (let i = Math.max(1, current - 1); i <= Math.min(totalPages - 2, current + 1); i++) {
                if (!pages.includes(i)) pages.push(i);
            }

            if (current < totalPages - 3) {
                pages.push('ellipsis');
            }

            // Always show last page
            if (totalPages > 1) pages.push(totalPages - 1);
        }

        return pages;
    };

    // Calculate display range
    const startItem = pagination.page * pagination.pageSize + 1;
    const endItem = Math.min((pagination.page + 1) * pagination.pageSize, totalCount);

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* Header with Org/Dept/Sub-Dept Dropdowns */}
            <OrgDeptSelector
                selectedOrganizationId={selectedOrganizationId}
                selectedDepartmentId={selectedDepartmentId}
                selectedSubDepartmentId={selectedSubDepartmentId}
                onOrganizationChange={setSelectedOrganizationId}
                onDepartmentChange={setSelectedDepartmentId}
                onSubDepartmentChange={setSelectedSubDepartmentId}
            />

            <div className="p-8 max-w-[1600px] mx-auto">
                {/* Page Title */}
                <div className="mb-10 relative">
                    <div className="absolute -left-4 top-0 bottom-0 w-1 bg-primary rounded-full opacity-50 shadow-[0_0_15px_rgba(var(--primary),0.5)]" />
                    <h1 className="text-4xl font-black text-foreground tracking-tight leading-none">
                        Audit Dashboard
                    </h1>
                    <p className="text-sm text-muted-foreground/60 mt-3 font-medium">
                        Track all shift changes, assignments, and system events
                    </p>
                </div>

                {/* Filters Card */}
                <div className="bg-card border border-border rounded-[2rem] p-5 mb-8 shadow-2xl shadow-primary/5 transition-all hover:shadow-primary/10">
                    <div className="flex flex-wrap items-center gap-4">
                        {/* Date Range */}
                        <div className="relative group">
                            <select
                                value={selectedDateRange}
                                onChange={(e) => {
                                    setSelectedDateRange(Number(e.target.value));
                                    setPagination(prev => ({ ...prev, page: 0 }));
                                }}
                                className="appearance-none bg-muted/30 border border-border rounded-xl pl-11 pr-10 py-3 text-sm text-foreground font-black uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer hover:bg-muted/50 hover:border-primary/30 min-w-[180px]"
                            >
                                {dateRangeOptions.map((option) => (
                                    <option key={option.days} value={option.days} className="bg-card text-foreground">
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                        </div>

                        {/* Event Type */}
                        <div className="relative group">
                            <select
                                value={selectedEventType}
                                onChange={(e) => {
                                    setSelectedEventType(e.target.value);
                                    setPagination(prev => ({ ...prev, page: 0 }));
                                }}
                                className="appearance-none bg-muted/30 border border-border rounded-xl pl-11 pr-10 py-3 text-sm text-foreground font-black uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer hover:bg-muted/50 hover:border-primary/30 min-w-[200px]"
                            >
                                {eventTypeOptions.map((option) => (
                                    <option key={option.value} value={option.value} className="bg-card text-foreground">
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary group-hover:rotate-12 transition-transform" />
                        </div>

                        {/* Search */}
                        <div className="flex-1 min-w-[300px] relative group">
                            <input
                                type="text"
                                placeholder="Search by Shift ID or Actor..."
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setPagination(prev => ({ ...prev, page: 0 }));
                                }}
                                className="w-full bg-muted/30 border border-border rounded-xl pl-12 pr-6 py-3 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all hover:bg-muted/50 font-medium"
                            />
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                        </div>

                        {/* Export Button */}
                        <button className="px-6 py-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all text-[11px] font-black uppercase tracking-[0.2em] flex items-center gap-3 shadow-lg shadow-primary/20">
                            <Download className="w-4 h-4" />
                            Export Data
                        </button>
                    </div>
                </div>

                {/* Table Card */}
                <div className="bg-card border border-border rounded-[2.5rem] overflow-hidden shadow-2xl shadow-primary/5">
                    <AuditTable groupedShifts={groupedShifts} loading={loading} />
                </div>

                {/* Pagination */}
                <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
                    {/* Left: Count info */}
                    <div className="text-muted-foreground/50 font-mono text-[11px] font-black uppercase tracking-widest">
                        {totalCount > 0 ? (
                            <>
                                Showing <span className="text-foreground tracking-normal">{startItem}</span>
                                <span className="text-primary/30 mx-1">–</span>
                                <span className="text-foreground tracking-normal">{endItem}</span>
                                {' '}of <span className="text-foreground tracking-normal">{totalCount}</span> events
                            </>
                        ) : (
                            'No events found'
                        )}
                    </div>

                    {/* Right: Pagination controls */}
                    <div className="flex items-center gap-4">
                        {/* Rows per page */}
                        <div className="flex items-center gap-3">
                            <span className="text-muted-foreground/40 font-black uppercase tracking-widest text-[10px]">Rows per page:</span>
                            <select
                                value={pagination.pageSize}
                                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                                className="bg-muted/30 border border-border rounded-xl px-4 py-2 text-xs text-foreground font-black focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer hover:bg-muted/50 transition-all"
                            >
                                {pageSizeOptions.map(size => (
                                    <option key={size} value={size} className="bg-card text-foreground">{size}</option>
                                ))}
                            </select>
                        </div>

                        {/* Page navigation */}
                        {totalPages > 1 && (
                            <div className="flex items-center gap-1">
                                {/* Previous */}
                                <button
                                    onClick={() => goToPage(pagination.page - 1)}
                                    disabled={pagination.page === 0}
                                    className="p-3 rounded-xl bg-muted/30 hover:bg-muted/50 disabled:opacity-20 disabled:cursor-not-allowed transition-all border border-border text-primary"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>

                                {/* Page numbers */}
                                <div className="flex items-center gap-1 mx-1">
                                    {getVisiblePages().map((page, idx) => (
                                        page === 'ellipsis' ? (
                                            <span key={`ellipsis-${idx}`} className="px-2 py-1 text-muted-foreground/30 font-black">…</span>
                                        ) : (
                                            <button
                                                key={page}
                                                onClick={() => goToPage(page)}
                                                className={`min-w-[40px] h-10 rounded-xl text-xs font-black transition-all ${pagination.page === page
                                                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-110'
                                                    : 'bg-muted/30 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 border border-border'
                                                    }`}
                                            >
                                                {page + 1}
                                            </button>
                                        )
                                    ))}
                                </div>

                                {/* Next */}
                                <button
                                    onClick={() => goToPage(pagination.page + 1)}
                                    disabled={pagination.page >= totalPages - 1}
                                    className="p-3 rounded-xl bg-muted/30 hover:bg-muted/50 disabled:opacity-20 disabled:cursor-not-allowed transition-all border border-border text-primary"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AuditDashboardPage;
