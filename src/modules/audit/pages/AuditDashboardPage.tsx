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
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
            {/* Header with Org/Dept/Sub-Dept Dropdowns */}
            <OrgDeptSelector
                selectedOrganizationId={selectedOrganizationId}
                selectedDepartmentId={selectedDepartmentId}
                selectedSubDepartmentId={selectedSubDepartmentId}
                onOrganizationChange={setSelectedOrganizationId}
                onDepartmentChange={setSelectedDepartmentId}
                onSubDepartmentChange={setSelectedSubDepartmentId}
            />

            <div className="p-6 max-w-[1600px] mx-auto">
                {/* Page Title */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        Audit Dashboard
                    </h1>
                    <p className="text-sm text-gray-400 mt-2">
                        Track all shift changes, assignments, and system events
                    </p>
                </div>

                {/* Filters Card */}
                <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4 mb-6 shadow-xl">
                    <div className="flex flex-wrap items-center gap-3">
                        {/* Date Range */}
                        <div className="relative">
                            <select
                                value={selectedDateRange}
                                onChange={(e) => {
                                    setSelectedDateRange(Number(e.target.value));
                                    setPagination(prev => ({ ...prev, page: 0 }));
                                }}
                                className="appearance-none bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-8 py-2.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all cursor-pointer hover:border-slate-500"
                            >
                                {dateRangeOptions.map((option) => (
                                    <option key={option.days} value={option.days}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 pointer-events-none" />
                        </div>

                        {/* Event Type */}
                        <div className="relative">
                            <select
                                value={selectedEventType}
                                onChange={(e) => {
                                    setSelectedEventType(e.target.value);
                                    setPagination(prev => ({ ...prev, page: 0 }));
                                }}
                                className="appearance-none bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-8 py-2.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all cursor-pointer hover:border-slate-500"
                            >
                                {eventTypeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-400 pointer-events-none" />
                        </div>

                        {/* Search */}
                        <div className="flex-1 min-w-[200px] relative">
                            <input
                                type="text"
                                placeholder="Search by Shift ID or Actor..."
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setPagination(prev => ({ ...prev, page: 0 }));
                                }}
                                className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all hover:border-slate-500"
                            />
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        </div>

                        {/* Export Button */}
                        <button className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 transition-all text-sm flex items-center gap-2 font-medium shadow-lg shadow-blue-500/20">
                            <Download className="w-4 h-4" />
                            Export
                        </button>
                    </div>
                </div>

                {/* Table Card */}
                <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden shadow-xl">
                    <AuditTable groupedShifts={groupedShifts} loading={loading} />
                </div>

                {/* Pagination */}
                <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
                    {/* Left: Count info */}
                    <div className="text-gray-400">
                        {totalCount > 0 ? (
                            <>
                                Showing <span className="text-white font-medium">{startItem}</span>
                                -<span className="text-white font-medium">{endItem}</span>
                                {' '}of <span className="text-white font-medium">{totalCount}</span> events
                            </>
                        ) : (
                            'No events found'
                        )}
                    </div>

                    {/* Right: Pagination controls */}
                    <div className="flex items-center gap-4">
                        {/* Rows per page */}
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400">Rows per page:</span>
                            <select
                                value={pagination.pageSize}
                                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                                className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer hover:border-slate-500 transition-all"
                            >
                                {pageSizeOptions.map(size => (
                                    <option key={size} value={size}>{size}</option>
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
                                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-slate-600 hover:border-slate-500 disabled:hover:border-slate-600"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>

                                {/* Page numbers */}
                                <div className="flex items-center gap-1 mx-1">
                                    {getVisiblePages().map((page, idx) => (
                                        page === 'ellipsis' ? (
                                            <span key={`ellipsis-${idx}`} className="px-2 py-1 text-gray-500">…</span>
                                        ) : (
                                            <button
                                                key={page}
                                                onClick={() => goToPage(page)}
                                                className={`min-w-[36px] h-9 rounded-lg text-sm font-medium transition-all ${pagination.page === page
                                                        ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/30'
                                                        : 'bg-slate-800 text-gray-300 hover:bg-slate-700 border border-slate-600 hover:border-slate-500'
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
                                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-slate-600 hover:border-slate-500 disabled:hover:border-slate-600"
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
