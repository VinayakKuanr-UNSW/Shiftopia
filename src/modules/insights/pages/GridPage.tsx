import React, { useMemo, useState } from 'react';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { format, eachDayOfInterval, startOfYear, endOfYear, getISOWeek } from 'date-fns';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useEmployees, useShiftsByDateRange } from '@/modules/rosters/state/useRosterShifts';
import {
    Loader2, Activity, Users, CalendarDays,
    GraduationCap, RefreshCw, ShieldAlert, CheckCircle2, AlertTriangle,
    Search,
} from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from '@/modules/core/ui/primitives/pagination';
import { calculateMinutesBetweenTimes } from '@/modules/rosters/domain/shift.entity';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { supabase } from '@/platform/supabase/client';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import {
    computeEmpComp,
    EBA_WEEKLY_LIMIT,
    type ShiftPillData,
    type CompV8Severity,
    type EmpComp,
    type GridContractType,
} from '@/modules/insights/model/grid-compliance';

// ── Cell class helpers ────────────────────────────────────────────────────────

const getInitials = (first: string, last: string) =>
    `${(first || '').charAt(0)}${(last || '').charAt(0)}`.toUpperCase();

function getDailyCellClass(hours: number, isViol: boolean, isWarn: boolean, isDraft?: boolean): string {
    if (hours === 0) return 'text-muted-foreground/20';
    
    const draftBase = isDraft ? 'border-dashed shadow-none opacity-70' : '';
    
    if (isViol)
        return `bg-red-500/60 text-white border border-red-500/40 shadow-[0_0_12px_-2px_rgba(239,68,68,0.4)] ${draftBase}`;
    if (isWarn)
        return `bg-amber-500/40 text-amber-800 dark:text-amber-200 border border-amber-500/30 shadow-[0_0_10px_-2px_rgba(245,158,11,0.3)] ${draftBase}`;
    
    // Normal hours (emerald)
    if (hours < 4)  return `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/10 shadow-[0_0_8px_-2px_rgba(16,185,129,0.1)] ${draftBase}`;
    if (hours < 8)  return `bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_-2px_rgba(16,185,129,0.2)] ${draftBase}`;
    if (hours < 10) return `bg-emerald-500/40 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_-2px_rgba(16,185,129,0.3)] ${draftBase}`;
    
    return `bg-emerald-500/60 text-white border border-emerald-500/40 shadow-[0_0_15px_-2px_rgba(16,185,129,0.4)] ${draftBase}`;
}

const weeklyBg = (s: CompV8Severity) =>
    s === 'violation' ? 'bg-red-500/15 border-l border-red-500/30'
    : s === 'warning'  ? 'bg-amber-500/10 border-l border-amber-500/20'
    : 'bg-primary/[0.02] border-l border-border/30';

const weeklyTextCls = (s: CompV8Severity) =>
    s === 'violation' ? 'text-red-600 dark:text-red-400'
    : s === 'warning'  ? 'text-amber-600 dark:text-amber-400'
    : 'text-primary/80';

const winBadgeCls = (s: CompV8Severity) =>
    s === 'violation'
        ? 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30'
        : 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30';

const avatarCls = (s: CompV8Severity) =>
    s === 'violation'
        ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
        : s === 'warning'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
        : 'bg-primary/10 text-primary border border-primary/5';

// ── GridPage ──────────────────────────────────────────────────────────────────

const GridPage: React.FC = () => {
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const queryClient = useQueryClient();
    const isMobile = useIsMobile();
    const { isDark } = useTheme();

    const today = new Date();
    const [year, setYear] = useState(today.getFullYear());
    const [viewMode, setViewMode] = useState<'hours' | 'compliance'>('hours');

    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);

    React.useEffect(() => {
        setPage(1);
    }, [scope, year, searchTerm]);

    const startDate = useMemo(() => format(startOfYear(new Date(year, 0, 1)), 'yyyy-MM-dd'), [year]);
    const endDate   = useMemo(() => format(endOfYear(new Date(year, 0, 1)),  'yyyy-MM-dd'), [year]);

    const { data: employeesByContract = [], isLoading: isLoadingEmployees } = useEmployees(
        scope.org_ids[0], undefined, undefined,
    );

    const shiftFilters = useMemo(() => ({
        departmentIds:    scope.dept_ids.length    > 0 ? scope.dept_ids    : undefined,
        subDepartmentIds: scope.subdept_ids.length > 0 ? scope.subdept_ids : undefined,
    }), [scope.dept_ids, scope.subdept_ids]);

    const { data: shifts = [], isLoading: isLoadingShifts, refetch: refetchShifts } =
        useShiftsByDateRange(scope.org_ids[0] || null, startDate, endDate, shiftFilters);

    const daysOfYear = useMemo(() =>
        eachDayOfInterval({ start: new Date(year, 0, 1), end: new Date(year, 11, 31) }),
    [year]);

    const weeks = useMemo(() => {
        const weekMap = new Map<number, Date[]>();
        daysOfYear.forEach(day => {
            const wn = getISOWeek(day);
            if (!weekMap.has(wn)) weekMap.set(wn, []);
            weekMap.get(wn)!.push(day);
        });
        return Array.from(weekMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([weekNum, days]) => ({ weekNum, days }));
    }, [daysOfYear]);

    const sortedWeekNums = useMemo(() => weeks.map(w => w.weekNum), [weeks]);

    const { aggregatedData, finalEmployees } = useMemo(() => {
        const data: Record<string, { 
            byDate: Record<string, ShiftPillData[]>; 
            byWeek: Record<number, number>;
            draftDates: Set<string>;
        }> = {};
        const empMap = new Map<string, { 
            id: string; 
            first_name: string; 
            last_name: string;
            contract_type?: GridContractType;
            contracted_weekly_hours?: number;
        }>();

        employeesByContract.forEach(emp => {
            empMap.set(emp.id, { 
                id: emp.id, 
                first_name: emp.first_name, 
                last_name: emp.last_name,
                contract_type: (emp as any).contract_type,
                contracted_weekly_hours: (emp as any).contracted_weekly_hours,
            });
            data[emp.id] = { byDate: {}, byWeek: {}, draftDates: new Set() };
        });

        shifts.forEach(shift => {
            if (!shift.assigned_employee_id) return;
            const eid = shift.assigned_employee_id;

            if (!empMap.has(eid)) {
                empMap.set(eid, {
                    id: eid,
                    first_name: shift.assigned_profiles?.first_name || 'Employee',
                    last_name:  shift.assigned_profiles?.last_name  || eid.split('-')[0],
                });
                data[eid] = { byDate: {}, byWeek: {}, draftDates: new Set() };
            }

            const shiftDate = shift.shift_date;
            let netMins = shift.net_length_minutes
                || shift.scheduled_length_minutes
                || (shift.total_hours ? shift.total_hours * 60 : 0);
            if (netMins === 0 && shift.start_time && shift.end_time) {
                netMins = calculateMinutesBetweenTimes(shift.start_time, shift.end_time)
                    - (shift.break_minutes || 0);
            }
            const netHours = Math.max(0, netMins / 60);
            
            if (!data[eid].byDate[shiftDate]) {
                data[eid].byDate[shiftDate] = [];
            }
            const isDraft = shift.lifecycle_status === 'Draft' || shift.is_draft;
            data[eid].byDate[shiftDate].push({
                id: shift.id,
                netHours,
                orgName: shift.organizations?.name,
                deptName: shift.departments?.name,
                subDeptName: shift.sub_departments?.name,
                roleName: shift.roles?.name,
                isDraft,
            });

            const wn = getISOWeek(new Date(shiftDate));
            data[eid].byWeek[wn] = (data[eid].byWeek[wn] || 0) + netHours;

            if (isDraft) {
                data[eid].draftDates.add(shiftDate);
            }
        });

        return {
            aggregatedData: data,
            finalEmployees: Array.from(empMap.values()).sort((a, b) => a.last_name.localeCompare(b.last_name)),
        };
    }, [shifts, employeesByContract]);

    const isLoading = isLoadingEmployees || isLoadingShifts;
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);

    // Filter employees by searchTerm
    const filteredEmployees = useMemo(() => {
        if (!searchTerm) return finalEmployees;
        const query = searchTerm.toLowerCase();
        return finalEmployees.filter(emp => {
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
            return fullName.includes(query) || emp.id.toLowerCase().includes(query);
        });
    }, [finalEmployees, searchTerm]);

    const totalCount = filteredEmployees.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const currentPage = Math.min(page, totalPages);

    const paginatedEmployees = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return filteredEmployees.slice(startIndex, startIndex + pageSize);
    }, [filteredEmployees, currentPage, pageSize]);

    const paginatedEmployeeIds = useMemo(() => paginatedEmployees.map(e => e.id), [paginatedEmployees]);

    // Student visa - query only for visible page
    const { data: studentVisaStatusData = [] } = useQuery({
        queryKey: ['employees-student-visa', paginatedEmployeeIds],
        queryFn: async () => {
            if (paginatedEmployeeIds.length === 0) return [];
            const { data, error } = await supabase
                .from('employee_licenses')
                .select('employee_id, has_restricted_work_limit, license:license_id ( name )')
                .eq('status', 'Active')
                .in('employee_id', paginatedEmployeeIds);
            if (error) throw error;
            return data;
        },
        enabled: paginatedEmployeeIds.length > 0,
        staleTime: 5 * 60_000,
    });

    const studentVisaMap = useMemo(() => {
        const map: Record<string, boolean> = {};
        studentVisaStatusData.forEach((wr: any) => {
            if (wr.license?.name?.includes('Subclass 500'))
                map[wr.employee_id] = !!wr.has_restricted_work_limit;
        });
        return map;
    }, [studentVisaStatusData]);

    // Compliance map (computed once per page/data change, only for visible page)
    const complianceMap = useMemo(() => {
        const map: Record<string, EmpComp> = {};
        for (const emp of paginatedEmployees) {
            const d = aggregatedData[emp.id];
            if (d) map[emp.id] = computeEmpComp(d.byWeek, d.byDate, sortedWeekNums, emp.contract_type, emp.contracted_weekly_hours);
        }
        return map;
    }, [paginatedEmployees, aggregatedData, sortedWeekNums]);

    // Auto-scroll to today
    React.useEffect(() => {
        if (!isLoading && paginatedEmployees.length > 0) {
            const todayStr = format(new Date(), 'yyyy-MM-dd');
            const el = document.getElementById(`col-${todayStr}`);
            if (el && scrollContainerRef.current)
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, [isLoading, paginatedEmployees.length]);

    const handleRefresh = () => {
        queryClient.invalidateQueries({ queryKey: ['shifts', 'list'] });
        queryClient.invalidateQueries({ queryKey: ['shifts', 'lookup', 'employees'] });
        refetchShifts();
    };

    const getPageNumbers = () => {
        const pages: Array<number | 'ellipsis'> = [];
        const maxVisible = 5;
        
        if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            pages.push(1);
            
            if (currentPage > 3) {
                pages.push('ellipsis');
            }
            
            const start = Math.max(2, currentPage - 1);
            const end = Math.min(totalPages - 1, currentPage + 1);
            
            for (let i = start; i <= end; i++) {
                pages.push(i);
            }
            
            if (currentPage < totalPages - 2) {
                pages.push('ellipsis');
            }
            
            pages.push(totalPages);
        }
        return pages;
    };

    const compMode = viewMode === 'compliance';

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            <GoldStandardHeader
                title="Annual Shift Grid"
                Icon={Activity}
                mode="managerial"
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                functionBar={
                    <div className="flex flex-wrap items-center justify-between gap-4 w-full">
                        <div className="flex items-center gap-3 flex-wrap animate-in fade-in duration-300">
                            <div className="flex items-center gap-4 px-4 py-2 bg-muted/30 rounded-2xl border border-border/40">
                                <div className="flex items-center gap-2">
                                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-[11px] font-bold text-foreground">
                                        {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : totalCount} PERSONNEL
                                    </span>
                                </div>
                                <div className="h-3 w-[1px] bg-border/40" />
                                <div className="flex items-center gap-2">
                                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-[11px] font-bold text-foreground">
                                        {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : shifts.length} SHIFTS
                                    </span>
                                </div>
                            </div>

                            <div className="relative w-48 sm:w-64">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/45" />
                                <Input
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search personnel..."
                                    className="pl-8 h-9 text-[11px] font-bold tracking-wider rounded-xl bg-muted/20 border-border/40 focus:bg-background/80 transition-colors placeholder:text-muted-foreground/30 focus-visible:ring-1 focus-visible:ring-primary/20"
                                />
                            </div>

                            <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/40">
                                {(['hours', 'compliance'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => setViewMode(mode)}
                                        className={cn(
                                            "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                            viewMode === mode
                                                ? "bg-background text-primary shadow-sm ring-1 ring-border/20"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleRefresh}
                                className="p-2.5 hover:bg-muted rounded-xl transition-colors text-muted-foreground hover:text-foreground border border-transparent hover:border-border/40"
                                title="Refresh Data"
                            >
                                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                            </button>

                            <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/40">
                                {[2024, 2025, 2026].map(y => (
                                    <button
                                        key={y}
                                        onClick={() => setYear(y)}
                                        className={cn(
                                            "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                            year === y
                                                ? "bg-background text-primary shadow-sm ring-1 ring-border/20"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        {y}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                }
            />

            {/* ── BODY ── */}
            <div className={cn(
                "flex-1 min-h-0 mx-4 lg:mx-6 mb-4 lg:mb-6 bg-card border border-border/50 rounded-[32px] shadow-2xl shadow-black/5 overflow-hidden flex flex-col relative",
                isDark ? "bg-[#1c2333]/40" : "bg-white/70 backdrop-blur-md"
            )}>
                {isLoading && (
                    <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] z-[100] flex items-center justify-center flex-col gap-3">
                        <div className="p-4 bg-background rounded-2xl shadow-2xl border border-border/50 flex flex-col items-center gap-4">
                            <Loader2 className="h-8 w-8 text-primary animate-spin" />
                            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground animate-pulse">Syncing Matrix...</span>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto overflow-y-auto custom-scrollbar" ref={scrollContainerRef}>
                    <table className="w-full border-collapse min-w-max">
                        <thead>
                            <tr className="bg-muted/50">
                                {/* Left sticky: Employee label */}
                                <th className="sticky left-0 z-40 bg-muted/95 backdrop-blur-md w-48 min-w-[12rem] p-4 text-left border-b border-r border-border/60">
                                    <span className="text-[10px] uppercase tracking-widest font-extrabold text-muted-foreground">Employee</span>
                                </th>

                                {weeks.map(week => (
                                    <React.Fragment key={week.weekNum}>
                                        {week.days.map(day => {
                                            const dateStr = format(day, 'yyyy-MM-dd');
                                            const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                                            return (
                                                <th
                                                    key={dateStr}
                                                    id={`col-${dateStr}`}
                                                    className={`w-12 min-w-[3rem] p-2 text-center border-b border-border/30 transition-colors ${isToday ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : ''}`}
                                                >
                                                    <div className={`text-[9px] uppercase font-bold ${isToday ? 'text-primary' : 'text-muted-foreground/60'}`}>
                                                        {format(day, 'eee')}
                                                    </div>
                                                    <div className={`text-xs font-mono font-bold mt-0.5 ${isToday ? 'text-primary' : 'text-foreground/80'}`}>
                                                        {format(day, 'MMM d')}
                                                    </div>
                                                </th>
                                            );
                                        })}
                                        {/* Weekly total header */}
                                        <th className="w-20 min-w-[5rem] bg-primary/[0.03] p-2 text-center border-b border-l border-border/40">
                                            <div className="text-[8px] uppercase font-black text-primary/40 tracking-tighter">W{week.weekNum}</div>
                                            <div className="text-[9px] font-mono font-bold text-primary/60 mt-0.5">Total</div>
                                        </th>
                                    </React.Fragment>
                                ))}

                                {/* Right sticky: compliance column */}
                                <th className="sticky right-0 z-40 bg-muted/95 backdrop-blur-md w-44 min-w-[11rem] p-4 text-center border-b border-l border-border/60">
                                    <span className="text-[10px] uppercase tracking-widest font-extrabold text-muted-foreground">Compliance</span>
                                </th>
                            </tr>
                        </thead>

                        <tbody>
                            {paginatedEmployees.map(emp => {
                                const empComp = complianceMap[emp.id];
                                const ovSev   = empComp?.overallV8Severity ?? 'ok';

                                return (
                                    <tr key={emp.id} className="group hover:bg-muted/30 transition-colors border-b border-border/20 last:border-0 text-center">
                                        {/* Left sticky: employee */}
                                        <td className="sticky left-0 z-30 bg-card/95 backdrop-blur-md p-3 border-r border-border/40 group-hover:bg-muted/50 transition-colors text-left">
                                            <div className="flex items-center gap-3">
                                                <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 shadow-inner transition-colors ${avatarCls(ovSev)}`}>
                                                    {getInitials(emp.first_name, emp.last_name)}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="text-xs font-semibold text-foreground/90 truncate">
                                                            {emp.first_name} {emp.last_name}
                                                        </span>
                                                        {studentVisaMap[emp.id] && (
                                                            <Badge variant="warning" className="h-3.5 px-1 text-[8px] font-extrabold gap-0.5 uppercase tracking-tighter shrink-0 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                                                                <GraduationCap className="h-2 w-2" />
                                                                Visa
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <span className="text-[9px] text-muted-foreground font-mono truncate">{emp.id.split('-')[0]}</span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Week columns */}
                                        {weeks.map(week => {
                                            const weekComp = empComp?.weeks[week.weekNum];
                                            const wkSev    = weekComp?.worstV8Severity ?? 'ok';
                                            const wkHours  = weekComp?.weekHours ?? (aggregatedData[emp.id]?.byWeek[week.weekNum] || 0);
                                            const wkDisplay = wkHours > 0
                                                ? parseFloat(wkHours.toFixed(1)).toString()
                                                : '';

                                            return (
                                                <React.Fragment key={week.weekNum}>
                                                    {/* Daily cells */}
                                                    {week.days.map(day => {
                                                        const dateStr = format(day, 'yyyy-MM-dd');
                                                        const shifts   = aggregatedData[emp.id]?.byDate[dateStr] || [];
                                                        const isDraft = aggregatedData[emp.id]?.draftDates.has(dateStr) ?? false;
                                                        const isViol  = empComp?.dailyViolations.has(dateStr) ?? false;
                                                        const isWarn  = empComp?.dailyWarnings.has(dateStr) ?? false;
                                                        
                                                        const hours = shifts.reduce((sum, s) => sum + s.netHours, 0);
                                                        const cellCls = getDailyCellClass(hours, isViol, isWarn, isDraft);

                                                        return (
                                                            <td key={`${emp.id}-${dateStr}`} className="p-1 relative group/cell align-middle">
                                                                <div className={`w-full h-[2.1rem] rounded flex items-center justify-center p-[2px] transition-all duration-200 ${cellCls}`}>
                                                                    {shifts.length > 0 ? (
                                                                        compMode ? (
                                                                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                                                                        ) : (
                                                                            <Popover>
                                                                                <PopoverTrigger asChild>
                                                                                    <div role="button" className="w-full h-full flex flex-col items-center justify-center gap-[2px] cursor-pointer hover:bg-background/20 rounded-sm transition-colors overflow-hidden">
                                                                                        <div className="flex items-center justify-center px-1 py-[2px] w-full max-w-[95%] rounded-[3px] bg-background/60 hover:bg-background/95 shadow-sm transition-colors text-[9px] font-extrabold tracking-tight border border-foreground/10 text-current truncate leading-none">
                                                                                            {shifts.map(s => {
                                                                                                const h = s.netHours % 1 === 0 ? s.netHours : s.netHours.toFixed(1);
                                                                                                return `${h}${s.isDraft ? 'd' : ''}`;
                                                                                            }).join('+')}
                                                                                        </div>
                                                                                    </div>
                                                                                </PopoverTrigger>
                                                                                <PopoverContent side="right" align="start" className="w-64 p-0 z-[200] shadow-xl border-border/40 overflow-hidden">
                                                                                    <div className="p-3 bg-muted/30 border-b border-border/40">
                                                                                        <h4 className="text-xs font-bold">{format(day, 'EEEE, MMM d, yyyy')}</h4>
                                                                                        <p className="text-[10px] text-muted-foreground">{shifts.length} shift{shifts.length > 1 ? 's' : ''} • {hours}h total</p>
                                                                                    </div>
                                                                                    <div className="flex flex-col overflow-y-auto max-h-[300px] p-2 gap-1.5">
                                                                                        {shifts.map((s, idx) => (
                                                                                            <div key={s.id || idx} className="flex flex-col p-2.5 rounded-md border border-border/30 bg-card hover:bg-muted/50 transition-colors">
                                                                                                <div className="flex items-center justify-between mb-1.5">
                                                                                                    <span className="text-xs font-bold">{s.roleName || 'Unassigned Role'}</span>
                                                                                                    <Badge variant="secondary" className="text-[9px] px-1.5 shadow-none font-bold">
                                                                                                        {s.netHours}h
                                                                                                    </Badge>
                                                                                                </div>
                                                                                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap">
                                                                                                    <span>{s.deptName || 'Unknown Dept'}</span>
                                                                                                    <span className="opacity-40 text-[8px]">▶</span>
                                                                                                    <span>{s.subDeptName || 'Unknown SubDept'}</span>
                                                                                                </div>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                </PopoverContent>
                                                                            </Popover>
                                                                        )
                                                                    ) : (
                                                                        hours === 0 ? <span className="opacity-30 text-muted-foreground font-black text-[10px] select-none">—</span> : <span className="w-0.5 h-0.5 my-auto rounded-full bg-muted-foreground/20 group-hover/cell:bg-muted-foreground/40 transition-colors" />
                                                                    )}
                                                                </div>
                                                                {hours > 0 && (isViol || isWarn) && (
                                                                    <div className="absolute inset-x-1 -top-7 bg-foreground text-background text-[9px] px-2 py-0.5 rounded shadow-xl opacity-0 group-hover/cell:opacity-100 transition-opacity pointer-events-none z-[100] whitespace-nowrap text-center font-bold">
                                                                        {hours.toFixed(1)}h
                                                                        {isViol ? ' ⚠ cap!' : isWarn ? ' ~ cap' : ''}
                                                                    </div>
                                                                )}
                                                            </td>
                                                        );
                                                    })}

                                                    {/* Weekly total cell */}
                                                    <td className={`${weeklyBg(wkSev)} p-1 align-middle transition-all relative group/wt`}>
                                                        <div className="flex flex-col items-center gap-0.5">
                                                            {/* Rolling window violation badges */}
                                                            {weekComp && weekComp.windows.length > 0 && (
                                                                <div className="flex items-center gap-0.5 flex-wrap justify-center">
                                                                    {weekComp.windows.map(w => (
                                                                        <span
                                                                            key={w.weeks}
                                                                            className={`text-[7px] font-black px-1 py-0.5 rounded leading-none ${winBadgeCls(w.severity)}`}
                                                                        >
                                                                            {w.weeks}W
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {/* Hours number */}
                                                            {wkHours > 0 && (
                                                                <span className={`text-[11px] font-bold leading-none ${weeklyTextCls(wkSev)}`}>
                                                                    {compMode && wkSev !== 'ok'
                                                                        ? (wkSev === 'violation' ? '✕' : '~')
                                                                        : wkDisplay}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Hover tooltip */}
                                                        {weekComp && wkHours > 0 && (
                                                            <div className="hidden group-hover/wt:block absolute bottom-full left-0 mb-1 bg-background border border-border/60 text-foreground text-[9px] px-2.5 py-2 rounded-lg shadow-2xl pointer-events-none z-50 whitespace-nowrap min-w-[14rem]">
                                                                <div className="font-black uppercase tracking-wider text-[8px] text-muted-foreground mb-1.5">
                                                                    W{week.weekNum} — {wkHours.toFixed(1)}h this week
                                                                </div>
                                                                {weekComp.windows.length === 0 ? (
                                                                    <div className="text-emerald-500 font-bold">All rolling windows OK</div>
                                                                ) : (
                                                                    weekComp.windows.map(w => (
                                                                        <div
                                                                            key={w.weeks}
                                                                            className={`flex items-center justify-between gap-4 py-0.5 font-semibold ${w.severity === 'violation' ? 'text-red-500' : 'text-amber-500'}`}
                                                                        >
                                                                            <span>{w.weeks}-week window:</span>
                                                                            <span className="font-black tabular-nums">{w.hours}h / {w.limit}h</span>
                                                                        </div>
                                                                    ))
                                                                )}
                                                                {(empComp?.dailyViolations.size ?? 0) > 0 && (
                                                                    <div className="mt-1 pt-1 border-t border-border/30 text-red-500 font-semibold">
                                                                        Daily cap exceeded: {empComp?.dailyViolations.size} day(s)
                                                                    </div>
                                                                )}
                                                                <div className="mt-1.5 pt-1.5 border-t border-border/30 text-[8px] text-muted-foreground">
                                                                    EBA: {EBA_WEEKLY_LIMIT}h/wk → 76 / 114 / 152h limits
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                </React.Fragment>
                                            );
                                        })}

                                        {/* Right sticky: compliance summary */}
                                        <td className="sticky right-0 z-30 bg-card/95 backdrop-blur-md p-3 border-l border-border/40 group-hover:bg-muted/50 transition-colors">
                                            <div className="flex items-start gap-2 min-w-0">
                                                {ovSev === 'violation'
                                                    ? <ShieldAlert className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                                                    : ovSev === 'warning'
                                                    ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                                                    : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                                                }
                                                <div className="flex flex-col min-w-0">
                                                    <span className={`text-[10px] font-extrabold uppercase tracking-tight leading-none mb-0.5 ${
                                                        ovSev === 'violation' ? 'text-red-600 dark:text-red-400'
                                                        : ovSev === 'warning'  ? 'text-amber-600 dark:text-amber-400'
                                                        : 'text-emerald-600 dark:text-emerald-400'
                                                    }`}>
                                                        {ovSev === 'violation' ? 'Violation' : ovSev === 'warning' ? 'Near Limit' : 'OK'}
                                                    </span>
                                                    <span
                                                        className="text-[9px] text-muted-foreground leading-tight truncate max-w-[8.5rem]"
                                                        title={empComp?.worstDesc}
                                                    >
                                                        {empComp?.worstDesc || '—'}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}

                            {totalCount === 0 && !isLoading && (
                                <tr>
                                    <td colSpan={100} className="p-20 text-center">
                                        <div className="flex flex-col items-center gap-4 max-w-sm mx-auto animate-in fade-in duration-300">
                                            <div className="bg-muted/30 p-4 rounded-full">
                                                <Users className="w-8 h-8 text-muted-foreground/40" />
                                            </div>
                                            <div className="space-y-2">
                                                <p className="text-sm font-semibold text-foreground/80">
                                                    {!scope.org_ids[0] ? 'Organization Required' : 'No matches found'}
                                                </p>
                                                <p className="text-xs text-muted-foreground leading-relaxed">
                                                    {!scope.org_ids[0]
                                                        ? 'Please select an organization from the banner above to load data.'
                                                        : `No personnel recorded for the selected filters or search terms in ${year}. Try adjusting your scope, search query or year.`}
                                                </p>
                                            </div>
                                            <div className="mt-4 flex gap-4 text-[9px] font-mono opacity-20 uppercase tracking-widest border-t border-border/50 pt-4">
                                                <span>S:{shifts.length}</span>
                                                <span>P:{totalCount}</span>
                                                <span>O:{scope.org_ids[0]?.split('-')[0] || 'NONE'}</span>
                                                <span>D:{scope.dept_ids.length}</span>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls Footer */}
                {!isLoading && totalCount > 0 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 border-t border-border/40 bg-card/50">
                        <div className="text-xs text-muted-foreground font-mono">
                            Showing <span className="text-foreground font-bold">{Math.min(totalCount, (currentPage - 1) * pageSize + 1)}</span> to{' '}
                            <span className="text-foreground font-bold">{Math.min(totalCount, currentPage * pageSize)}</span> of{' '}
                            <span className="text-foreground font-bold">{totalCount}</span> users
                        </div>

                        <div className="flex items-center gap-2">
                            <Pagination className="justify-end w-auto mx-0">
                                <PaginationContent>
                                    <PaginationItem>
                                        <PaginationPrevious 
                                            href="#" 
                                            onClick={(e) => {
                                                e.preventDefault();
                                                if (currentPage > 1) setPage(currentPage - 1);
                                            }}
                                            className={cn(
                                                "cursor-pointer",
                                                currentPage === 1 && "pointer-events-none opacity-50"
                                            )}
                                        />
                                    </PaginationItem>

                                    {getPageNumbers().map((p, idx) => (
                                        <PaginationItem key={idx}>
                                            {p === 'ellipsis' ? (
                                                <PaginationEllipsis />
                                            ) : (
                                                <PaginationLink
                                                    href="#"
                                                    isActive={currentPage === p}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        setPage(p);
                                                    }}
                                                    className="cursor-pointer"
                                                >
                                                    {p}
                                                </PaginationLink>
                                            )}
                                        </PaginationItem>
                                    ))}

                                    <PaginationItem>
                                        <PaginationNext 
                                            href="#" 
                                            onClick={(e) => {
                                                e.preventDefault();
                                                if (currentPage < totalPages) setPage(currentPage + 1);
                                            }}
                                            className={cn(
                                                "cursor-pointer",
                                                currentPage === totalPages && "pointer-events-none opacity-50"
                                            )}
                                        />
                                    </PaginationItem>
                                </PaginationContent>
                            </Pagination>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: hsl(var(--border) / 0.5);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: hsl(var(--border));
                }
            `}</style>
        </div>
    );

};

export default GridPage;
