import { useState, useMemo, Fragment } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { tableTokens } from '@/modules/core/ui/primitives/table';
import {
    Loader2,
    CheckCircle2,
    AlertTriangle,
    Cpu,
    Calendar as CalendarIcon,
    ChevronDown,
    Check,
    Download,
    Search,
    ArrowUpDown,
    X,
} from 'lucide-react';
import { parseISO, format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { DatePicker } from '@/modules/core/ui/calendar';
import { CommandSelector } from '@/modules/users/ui/components/CommandSelector';
import { AutoSchedulerInsights } from './AutoSchedulerInsights';
import { AutoSchedulerMobileFlow } from './AutoSchedulerMobileFlow';
import { useAutoScheduler, complianceRateOf, SCHEDULER_MODE_OPTIONS } from './useAutoScheduler';
import type { ShiftMeta, EmployeeMeta } from '@/modules/scheduling';
import { type ShiftFilters } from '@/modules/rosters/state/useRosterShifts';
import { motion, AnimatePresence } from 'framer-motion';

// =============================================================================
// TYPES & PROPS
// =============================================================================

interface AutoSchedulerModalProps {
    open: boolean;
    onClose: () => void;
    shifts: ShiftMeta[];
    employees: EmployeeMeta[];
    onComplete: () => void;
    /** Org scope for the casual fairness ledger. When omitted, the ledger is skipped. */
    organizationId?: string;
    queryFilters?: ShiftFilters;
    /** The window to open on (the roster period on screen). */
    initialRange?: { startDate: string; endDate: string };
}

const LEVEL_COLORS: Record<string, string> = {
    'L0': '#64748b',
    'L1': '#3b82f6',
    'L2': '#10b981',
    'L3': '#f59e0b',
    'L4': '#ef4444',
    'L5': '#8b5cf6',
    'L6': '#ec4899',
    'L7': '#f97316',
    'default': '#94a3b8'
};

const ROLE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const getRoleColor = (roleName: string) => {
    const match = roleName.match(/\(L([0-7])\)/i);
    if (match) return LEVEL_COLORS[`L${match[1].toUpperCase()}`] || LEVEL_COLORS.default;
    
    let hash = 0;
    for (let i = 0; i < roleName.length; i++) {
        hash = roleName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return ROLE_COLORS[Math.abs(hash) % ROLE_COLORS.length];
};

const slideVariants = {
    initial: (custom: number) => ({
        opacity: 0,
        x: custom > 0 ? 28 : -28,
    }),
    animate: {
        opacity: 1,
        x: 0,
        transition: {
            duration: 0.22,
            ease: [0.16, 1, 0.3, 1],
        },
    },
    exit: (custom: number) => ({
        opacity: 0,
        x: custom > 0 ? -28 : 28,
        transition: {
            duration: 0.18,
            ease: [0.16, 1, 0.3, 1],
        },
    }),
};

// =============================================================================
// MAIN MODAL
// =============================================================================

export function AutoSchedulerModal({
    open,
    onClose,
    shifts: initialShifts,
    employees,
    onComplete,
    organizationId,
    queryFilters,
    initialRange,
}: AutoSchedulerModalProps) {
    const {
        health,
        phase,
        result,
        isCommitting,
        isDownloading,
        elapsedTime,
        estimatedTotalSeconds: ESTIMATED_TOTAL_SECONDS,
        startDate,
        setStartDate,
        endDate,
        setEndDate,
        validationError,
        applyWindowPreset,
        activeWindowPreset,
        mode,
        setMode,
        isShiftsLoading,
        filteredShifts,
        scopedEmployees,
        scopeBreakdown,
        preRunCapacity,
        canRun,
        runBlockedReason,
        employeeGroups,
        handleRun,
        handleCancel,
        handleCommit,
        handleClose,
        handleDownloadAudit,
    } = useAutoScheduler({ open, onClose, onComplete, shifts: initialShifts, employees, organizationId, queryFilters, initialRange });

    const isMobile = useIsMobile();

    /* ── MOBILE ── */
    if (isMobile) {
        return (
            <Dialog open={open} onOpenChange={o => !o && handleClose()}>
                <DialogContent
                    hideClose
                    overlayClassName="bg-background/80 backdrop-blur-sm"
                    data-hide-bottom-nav="true"
                    className={cn(
                        'left-0 top-0 flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0',
                        'flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 text-foreground',
                        'data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0',
                        'data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0',
                        'sm:rounded-none',
                    )}
                >
                    <DialogTitle className="sr-only">Auto-Schedule</DialogTitle>
                    <DialogDescription className="sr-only">
                        Fill unassigned draft shifts with the V8 optimizer, then review and apply the result.
                    </DialogDescription>
                    <AutoSchedulerMobileFlow
                        health={health}
                        phase={phase}
                        result={result}
                        isCommitting={isCommitting}
                        isDownloading={isDownloading}
                        elapsedTime={elapsedTime}
                        estimatedTotalSeconds={ESTIMATED_TOTAL_SECONDS}
                        startDate={startDate}
                        setStartDate={setStartDate}
                        endDate={endDate}
                        setEndDate={setEndDate}
                        validationError={validationError}
                        applyWindowPreset={applyWindowPreset}
                        activeWindowPreset={activeWindowPreset}
                        mode={mode}
                        setMode={setMode}
                        isShiftsLoading={isShiftsLoading}
                        shiftsInScope={filteredShifts.length}
                        staffCount={scopedEmployees.length}
                        scopeBreakdown={scopeBreakdown}
                        preRunCapacity={preRunCapacity}
                        canRun={canRun}
                        runBlockedReason={runBlockedReason}
                        employeeGroups={employeeGroups}
                        onRun={handleRun}
                        onCancelRun={handleCancel}
                        onCommit={handleCommit}
                        onClose={handleClose}
                        onDownloadAudit={handleDownloadAudit}
                    />
                </DialogContent>
            </Dialog>
        );
    }

    const isReviewMode = ['reviewing', 'done'].includes(phase) && !!result;
    const isRunning = phase === 'optimizing' || phase === 'validating';
    const activeModeOption = SCHEDULER_MODE_OPTIONS.find(o => o.value === mode) ?? SCHEDULER_MODE_OPTIONS[0];

    const [searchQuery, setSearchQuery] = useState('');
    const [filterCompliance, setFilterCompliance] = useState<'all' | 'compliant' | 'warning'>('all');
    const [tableSortField, setTableSortField] = useState<'name' | 'shifts' | 'hours' | 'compliance' | 'fatigue'>('name');
    const [tableSortDirection, setTableSortDirection] = useState<'asc' | 'desc'>('asc');
    const [expandedStaffIds, setExpandedStaffIds] = useState<Set<string>>(new Set());

    const toggleExpandStaff = (id: string) => {
        setExpandedStaffIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleTableSort = (field: 'name' | 'shifts' | 'hours' | 'compliance' | 'fatigue') => {
        if (tableSortField === field) {
            setTableSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setTableSortField(field);
            setTableSortDirection('asc');
        }
    };

    const parseTimeToMinutes = (t: string) => {
        const parts = t.split(':').map(Number);
        return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    };

    const calculateShiftHours = (startTime: string, endTime: string) => {
        let startMin = parseTimeToMinutes(startTime);
        let endMin = parseTimeToMinutes(endTime);
        if (endMin <= startMin) endMin += 24 * 60;
        return Math.round(((endMin - startMin) / 60) * 10) / 10;
    };

    const staffGridData = useMemo(() => {
        return employeeGroups.map(group => {
            const compliancePct = Math.round(complianceRateOf(group) * 100);
            const totalHours = group.proposals.reduce(
                (sum, p) => sum + calculateShiftHours(p.startTime, p.endTime),
                0
            );
            return {
                ...group,
                compliancePct,
                totalHours,
            };
        });
    }, [employeeGroups]);

    const compliantCount = staffGridData.filter(g => g.compliancePct === 100).length;
    const warningCount = staffGridData.filter(g => g.compliancePct < 100).length;

    const filteredAndSortedStaff = useMemo(() => {
        let list = staffGridData;

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            list = list.filter(g =>
                g.name.toLowerCase().includes(q) ||
                g.employmentType.toLowerCase().includes(q) ||
                g.assignedRoles.some(r => r.toLowerCase().includes(q))
            );
        }

        if (filterCompliance === 'compliant') {
            list = list.filter(g => g.compliancePct === 100);
        } else if (filterCompliance === 'warning') {
            list = list.filter(g => g.compliancePct < 100);
        }

        return [...list].sort((a, b) => {
            let diff = 0;
            switch (tableSortField) {
                case 'name':
                    diff = a.name.localeCompare(b.name);
                    break;
                case 'shifts':
                    diff = a.proposals.length - b.proposals.length;
                    break;
                case 'hours':
                    diff = a.totalHours - b.totalHours;
                    break;
                case 'compliance':
                    diff = a.compliancePct - b.compliancePct;
                    break;
                case 'fatigue':
                    diff = a.avgFatigue - b.avgFatigue;
                    break;
                default:
                    diff = 0;
            }
            return tableSortDirection === 'asc' ? diff : -diff;
        });
    }, [staffGridData, searchQuery, filterCompliance, tableSortField, tableSortDirection]);

    return (
        <Dialog open={open} onOpenChange={o => !o && handleClose()}>
            <DialogContent
                hideClose={isReviewMode}
                size={isReviewMode ? 'full' : 'md'}
                overlayClassName="bg-black/60 dark:bg-black/75 backdrop-blur-md"
                style={isReviewMode ? {
                    width: 'min(1380px, 94vw)',
                    height: 'min(880px, 88dvh)',
                    maxHeight: '88dvh',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 0,
                    overflow: 'hidden',
                } : undefined}
                className={cn(
                    isReviewMode
                        ? "!p-0 !gap-0 !overflow-hidden flex flex-col border border-border/80 bg-card text-card-foreground shadow-2xl"
                        : "max-w-[560px] w-full rounded-3xl p-0 overflow-hidden border border-border/80 bg-card text-card-foreground shadow-2xl transition-all duration-300"
                )}
                aria-labelledby="autoscheduler-modal-title"
                aria-describedby="autoscheduler-modal-description"
            >
                <AnimatePresence mode="wait" initial={false}>
                        {/* ─────────────────────────────────────────────────────────────
                            SCREEN 1: COMPUTE SCHEDULE (Configuration & Pre-Check)
                           ───────────────────────────────────────────────────────────── */}
                        {phase === 'idle' && (
                            <motion.div
                                key="screen-config"
                                custom={-1}
                                variants={slideVariants}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                className="p-7 space-y-6"
                            >
                                {/* Header (Accessible Dialog Title & Subtitle) */}
                                <div className="space-y-1 pr-8">
                                    <DialogTitle id="autoscheduler-modal-title" className="text-[20px] font-bold tracking-tight text-foreground">
                                        Compute Schedule
                                    </DialogTitle>
                                    <DialogDescription id="autoscheduler-modal-description" className="text-[14px] text-muted-foreground leading-relaxed">
                                        Configure the scheduling period and select an employment mode.
                                    </DialogDescription>
                                </div>

                                <div className="h-px bg-border/60 w-full" aria-hidden="true" />

                                {/* Choose Mode Section (GlobalScopeFilter UI/UX via CommandSelector) */}
                                <div className="space-y-1.5">
                                    <CommandSelector
                                        label="Mode"
                                        placeholder="Select mode..."
                                        value={mode}
                                        onValueChange={(val) => setMode(val as any)}
                                        options={SCHEDULER_MODE_OPTIONS.map(opt => ({
                                            id: opt.value,
                                            name: opt.label,
                                        }))}
                                        className="w-full"
                                    />
                                </div>

                                {/* Scheduling Period Section (WCAG Accessible Fieldset) */}
                                <fieldset className="space-y-2 border-0 p-0 m-0">
                                    <legend className="text-[14px] font-bold text-foreground">Scheduling Period</legend>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <label
                                                id="autoscheduler-start-date-label"
                                                htmlFor="autoscheduler-start-date"
                                                className="text-[12px] text-muted-foreground font-medium block"
                                            >
                                                Start Date
                                            </label>
                                            <DatePicker
                                                value={startDate ? parseISO(startDate) : undefined}
                                                onChange={(d) => setStartDate(format(d, 'yyyy-MM-dd'))}
                                                label="Start Date"
                                                displayFormat="dd/MM/yy"
                                            >
                                                <button
                                                    type="button"
                                                    id="autoscheduler-start-date"
                                                    aria-labelledby="autoscheduler-start-date-label"
                                                    aria-invalid={!!validationError}
                                                    aria-errormessage={validationError ? "autoscheduler-date-error" : undefined}
                                                    className="flex items-center justify-between w-full h-12 px-4 rounded-2xl bg-muted/40 hover:bg-muted/70 dark:bg-[#1a2130] dark:hover:bg-[#232c3f] border border-border/80 dark:border-white/10 text-foreground text-[14px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                                                >
                                                    <div className="flex items-center gap-2.5">
                                                        <CalendarIcon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                                                        <span>{startDate ? format(parseISO(startDate), 'dd/MM/yy') : 'Select date'}</span>
                                                    </div>
                                                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                                                </button>
                                            </DatePicker>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label
                                                id="autoscheduler-end-date-label"
                                                htmlFor="autoscheduler-end-date"
                                                className="text-[12px] text-muted-foreground font-medium block"
                                            >
                                                End Date
                                            </label>
                                            <DatePicker
                                                value={endDate ? parseISO(endDate) : undefined}
                                                onChange={(d) => setEndDate(format(d, 'yyyy-MM-dd'))}
                                                label="End Date"
                                                displayFormat="dd/MM/yy"
                                            >
                                                <button
                                                    type="button"
                                                    id="autoscheduler-end-date"
                                                    aria-labelledby="autoscheduler-end-date-label"
                                                    aria-invalid={!!validationError}
                                                    aria-errormessage={validationError ? "autoscheduler-date-error" : undefined}
                                                    className="flex items-center justify-between w-full h-12 px-4 rounded-2xl bg-muted/40 hover:bg-muted/70 dark:bg-[#1a2130] dark:hover:bg-[#232c3f] border border-border/80 dark:border-white/10 text-foreground text-[14px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                                                >
                                                    <div className="flex items-center gap-2.5">
                                                        <CalendarIcon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                                                        <span>{endDate ? format(parseISO(endDate), 'dd/MM/yy') : 'Select date'}</span>
                                                    </div>
                                                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                                                </button>
                                            </DatePicker>
                                        </div>
                                    </div>
                                    {validationError && (
                                        <p id="autoscheduler-date-error" role="alert" className="text-[12px] text-destructive font-medium px-1 mt-1">
                                            {validationError}
                                        </p>
                                    )}
                                </fieldset>

                                {/* Dynamic Supply Indicator (Single Line, Icon + One Phrase Only, No AI slop) */}
                                {filteredShifts.length === 0 ? (
                                    <div
                                        role="status"
                                        aria-live="polite"
                                        className="flex items-center h-11 px-4 rounded-xl border border-border/70 bg-muted/30 text-muted-foreground"
                                    >
                                        <span className="text-[13px] font-medium">
                                            No shifts in scope for this mode in this range.
                                        </span>
                                    </div>
                                ) : preRunCapacity && preRunCapacity.deficitDays.length > 0 ? (
                                    <div
                                        role="alert"
                                        aria-live="polite"
                                        className="flex items-center gap-2.5 h-11 px-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                    >
                                        <AlertTriangle className="w-4 h-4 shrink-0 stroke-[2.5]" aria-hidden="true" />
                                        <span className="text-[13px] font-semibold truncate">
                                            Demand Warning: Deficit detected on {preRunCapacity.deficitDays.length} day{preRunCapacity.deficitDays.length === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                ) : (
                                    <div
                                        role="status"
                                        aria-live="polite"
                                        className="flex items-center gap-2.5 h-11 px-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                    >
                                        <Check className="w-4 h-4 shrink-0 stroke-[2.5]" aria-hidden="true" />
                                        <span className="text-[13px] font-semibold truncate">
                                            Optimal Supply Found
                                        </span>
                                    </div>
                                )}

                                {/* Action Button */}
                                <Button
                                    type="button"
                                    onClick={handleRun}
                                    disabled={!canRun}
                                    aria-disabled={!canRun}
                                    aria-label="Compute Solution"
                                    title={runBlockedReason ?? undefined}
                                    className={cn(
                                        "w-full h-12 rounded-2xl font-bold text-[14px] tracking-wide transition-all active:scale-[0.99] gap-2.5",
                                        "bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                    )}
                                >
                                    <Cpu className="w-4 h-4" aria-hidden="true" />
                                    Compute Solution
                                </Button>
                            </motion.div>
                        )}

                        {/* ─────────────────────────────────────────────────────────────
                            SCREEN 2: LOADING & OPTIMIZATION IN FLIGHT
                           ───────────────────────────────────────────────────────────── */}
                        {isRunning && (
                            <motion.div
                                key="screen-loading"
                                custom={1}
                                variants={slideVariants}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                role="status"
                                aria-live="polite"
                                className="p-7 space-y-6 flex flex-col items-center text-center"
                            >
                                <div className="space-y-1 w-full text-left">
                                    <DialogTitle className="text-[20px] font-bold tracking-tight text-foreground">
                                        Computing Schedule
                                    </DialogTitle>
                                    <DialogDescription className="text-[14px] text-muted-foreground">
                                        Solving optimal {activeModeOption.label} roster
                                    </DialogDescription>
                                </div>

                                <div className="h-px bg-border/60 w-full" aria-hidden="true" />

                                {/* Centered Clean CPU Indicator */}
                                <div className="py-4 flex flex-col items-center gap-4">
                                    <div className="h-20 w-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary" aria-hidden="true">
                                        <Cpu className="h-9 w-9 animate-pulse" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[16px] font-bold text-foreground">
                                            {phase === 'validating' ? 'Auditing Legal Compliance...' : 'Evaluating CP-SAT Combinations...'}
                                        </p>
                                        <p className="text-[12px] text-muted-foreground">
                                            {filteredShifts.length} Shifts · {scopedEmployees.length} Eligible Staff
                                        </p>
                                    </div>
                                </div>

                                {/* Progress Bar & Elapsed / Estimated */}
                                <div className="space-y-3 w-full">
                                    <div
                                        className="h-2 w-full bg-muted/60 dark:bg-muted/40 rounded-full overflow-hidden border border-border/40"
                                        role="progressbar"
                                        aria-valuenow={Math.min(100, Math.round((elapsedTime / ESTIMATED_TOTAL_SECONDS) * 100))}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-label="Optimization progress"
                                    >
                                        <motion.div
                                            className="h-full bg-primary rounded-full"
                                            initial={{ width: '5%' }}
                                            animate={{
                                                width: elapsedTime < ESTIMATED_TOTAL_SECONDS
                                                    ? `${Math.max(5, (elapsedTime / ESTIMATED_TOTAL_SECONDS) * 100)}%`
                                                    : "98%"
                                            }}
                                            transition={{ duration: 0.5, ease: "linear" }}
                                        />
                                    </div>
                                    <div className="flex justify-between items-center px-1 text-[12px]">
                                        <span className="text-muted-foreground font-medium">
                                            Elapsed: <span className="font-mono font-bold text-foreground">{elapsedTime}s</span>
                                        </span>
                                        <span className="text-muted-foreground font-medium">
                                            Estimated: <span className="font-mono font-bold text-foreground">~{ESTIMATED_TOTAL_SECONDS}s</span>
                                        </span>
                                    </div>
                                </div>

                                {/* Cancel Button */}
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleCancel}
                                    aria-label="Cancel optimization"
                                    className="w-full h-12 rounded-2xl font-semibold text-[14px] border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    Cancel Optimization
                                </Button>
                            </motion.div>
                        )}

                        {/* ─────────────────────────────────────────────────────────────
                            SCREEN 3: PROPOSALS REVIEW & COMMIT (After Solve)
                           ───────────────────────────────────────────────────────────── */}
                        {isReviewMode && result && (
                            <motion.div
                                key="screen-review"
                                custom={1}
                                variants={slideVariants}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                className="flex-1 flex flex-col h-full overflow-hidden"
                            >
                                {/* Accessible Header Bar */}
                                <header className="h-16 px-6 md:px-8 flex items-center justify-between border-b border-border/60 bg-card shrink-0 select-none">
                                    <div className="flex items-center gap-3">
                                        <DialogTitle id="autoscheduler-modal-title" className="text-[18px] font-bold text-foreground tracking-tight">
                                            Schedule Review
                                        </DialogTitle>
                                        <DialogDescription id="autoscheduler-modal-description" className="sr-only">
                                            Review the generated roster and compliance audit under ICC Sydney EBA before publishing assignments.
                                        </DialogDescription>
                                        <Badge variant="outline" className="border-border/70 bg-muted/30 text-foreground text-[12px] font-medium">
                                            {activeModeOption.label}
                                        </Badge>
                                        <span className="text-[12px] text-muted-foreground font-medium hidden sm:inline">
                                            {result.passing === 1 ? '1 shift ready' : `${result.passing} shifts ready`}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2.5">
                                        <Button
                                            type="button"
                                            onClick={handleDownloadAudit}
                                            disabled={isDownloading}
                                            variant="outline"
                                            size="sm"
                                            className="h-9 gap-1.5 rounded-xl text-[12px] font-medium cursor-pointer border-border/80 hover:bg-muted"
                                        >
                                            {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                                            Export CSV
                                        </Button>
                                        <div className="w-px h-5 bg-border/60 mx-1 hidden sm:block" aria-hidden="true" />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleClose}
                                            aria-label="Close review dialog"
                                            className="h-9 w-9 p-0 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                                        >
                                            <X className="w-4 h-4" aria-hidden="true" />
                                            <span className="sr-only">Close review dialog</span>
                                        </Button>
                                    </div>
                                </header>

                                {/* Main Workspace Container */}
                                <main
                                    tabIndex={0}
                                    aria-label="Roster review content"
                                    className="flex-1 overflow-y-auto overscroll-contain px-6 md:px-10 py-6 space-y-6 focus-visible:outline-none"
                                >
                                    <div className="space-y-6 w-full max-w-none">
                                        <AutoSchedulerInsights result={result} />

                                        {/* ─────────────────────────────────────────────────────────────
                                            SECTION 3: STRUCTURED STAFF ASSIGNMENTS DATA GRID
                                           ───────────────────────────────────────────────────────────── */}
                                        <div className="rounded-2xl border border-border/70 bg-card overflow-hidden shadow-sm">
                                            {/* Grid Toolbar */}
                                            <div className="p-4 md:px-6 border-b border-border/60 bg-muted/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                <div className="flex items-center gap-2.5">
                                                    <h3 className="text-[15px] font-bold text-foreground">
                                                        Staff Assignments
                                                    </h3>
                                                    <Badge variant="outline" className="border-border/70 bg-muted/40 text-[11px] font-medium text-muted-foreground">
                                                        {searchQuery.trim() ? `${filteredAndSortedStaff.length} of ${employeeGroups.length}` : employeeGroups.length} {employeeGroups.length === 1 ? 'staff member' : 'staff members'}
                                                    </Badge>
                                                </div>

                                                <div className="flex flex-wrap items-center gap-2.5">
                                                    {/* Search Input */}
                                                    <div className="relative w-56 sm:w-64">
                                                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                                        <input
                                                            type="text"
                                                            value={searchQuery}
                                                            onChange={(e) => setSearchQuery(e.target.value)}
                                                            placeholder="Search staff or role..."
                                                            className="w-full h-8 pl-8 pr-7 text-[12px] bg-background border border-border/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 text-foreground placeholder:text-muted-foreground"
                                                        />
                                                        {searchQuery && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setSearchQuery('')}
                                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-[11px] font-bold cursor-pointer"
                                                                aria-label="Clear search"
                                                            >
                                                                ✕
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Filter Pills — only shown if there is an actual distinction (warnings exist) */}
                                                    {warningCount > 0 && (
                                                        <div className="flex items-center bg-muted/60 p-0.5 rounded-xl border border-border/60">
                                                            <button
                                                                type="button"
                                                                onClick={() => setFilterCompliance('all')}
                                                                className={cn(
                                                                    "px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer",
                                                                    filterCompliance === 'all'
                                                                        ? "bg-card text-foreground shadow-2xs font-bold"
                                                                        : "text-muted-foreground hover:text-foreground"
                                                                )}
                                                            >
                                                                All ({employeeGroups.length})
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setFilterCompliance('compliant')}
                                                                className={cn(
                                                                    "px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer",
                                                                    filterCompliance === 'compliant'
                                                                        ? "bg-card text-emerald-600 dark:text-emerald-400 shadow-2xs font-bold"
                                                                        : "text-muted-foreground hover:text-foreground"
                                                                )}
                                                            >
                                                                Compliant ({compliantCount})
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setFilterCompliance('warning')}
                                                                className={cn(
                                                                    "px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer",
                                                                    filterCompliance === 'warning'
                                                                        ? "bg-card text-amber-600 dark:text-amber-400 shadow-2xs font-bold"
                                                                        : "text-muted-foreground hover:text-foreground"
                                                                )}
                                                            >
                                                                Warnings ({warningCount})
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Table Container */}
                                            <div className={tableTokens.scroll}>
                                                <table className={cn(tableTokens.table, "min-w-[700px]")} aria-label="Staff roster assignment details">
                                                    <thead className={tableTokens.header}>
                                                        <tr className="border-b border-border/60 bg-muted/20 text-[11px] font-bold uppercase tracking-wider text-muted-foreground select-none">
                                                            <th scope="col" className={tableTokens.head}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleTableSort('name')}
                                                                    aria-label="Sort by staff member"
                                                                    className="flex items-center gap-1.5 hover:text-foreground cursor-pointer font-bold"
                                                                >
                                                                    <span>Staff Member</span>
                                                                    <ArrowUpDown className="w-3 h-3 opacity-60" aria-hidden="true" />
                                                                </button>
                                                            </th>
                                                            <th scope="col" className={tableTokens.head}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleTableSort('shifts')}
                                                                    aria-label="Sort by number of assignments"
                                                                    className="flex items-center gap-1.5 hover:text-foreground cursor-pointer font-bold"
                                                                >
                                                                    <span>Shifts</span>
                                                                    <ArrowUpDown className="w-3 h-3 opacity-60" aria-hidden="true" />
                                                                </button>
                                                            </th>
                                                            <th scope="col" className={tableTokens.head}>
                                                                <span>Total Hours</span>
                                                            </th>
                                                            <th scope="col" className={tableTokens.head}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleTableSort('compliance')}
                                                                    aria-label="Sort by compliance rate"
                                                                    className="flex items-center gap-1.5 hover:text-foreground cursor-pointer font-bold"
                                                                >
                                                                    <span>Compliance</span>
                                                                    <ArrowUpDown className="w-3 h-3 opacity-60" aria-hidden="true" />
                                                                </button>
                                                            </th>
                                                            <th scope="col" className={cn(tableTokens.head, "text-right")}>Schedule</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className={tableTokens.body}>
                                                        {filteredAndSortedStaff.length === 0 ? (
                                                            <tr>
                                                                <td colSpan={5} className={cn(tableTokens.cell, "py-8 text-center text-muted-foreground text-[13px]")}>
                                                                    No staff members match the selected filter criteria.
                                                                </td>
                                                            </tr>
                                                        ) : (
                                                            filteredAndSortedStaff.map(group => {
                                                                const isExpanded = expandedStaffIds.has(group.id);
                                                                return (
                                                                    <Fragment key={group.id}>
                                                                        <tr className={cn(tableTokens.row, "hover:bg-muted/20 transition-colors group")}>
                                                                            {/* 1. Staff Member (Name, Type, and Roles Grouped) */}
                                                                            <th scope="row" className={cn(tableTokens.cell, "text-left font-normal py-3")}>
                                                                                <div className="flex items-center gap-2.5">
                                                                                    <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary font-bold text-[11px] flex items-center justify-center shrink-0">
                                                                                        {group.name.slice(0, 2).toUpperCase()}
                                                                                    </div>
                                                                                    <div>
                                                                                        <div className="font-semibold text-foreground text-[13px]">
                                                                                            {group.name}
                                                                                        </div>
                                                                                        <div className="text-[11px] text-muted-foreground truncate max-w-[260px]">
                                                                                            {group.employmentType || 'Casual'} · {group.assignedRoles.join(', ') || 'Staff'}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </th>

                                                                            {/* 2. Shifts Count */}
                                                                            <td className={tableTokens.cell}>
                                                                                <span className="font-medium text-foreground text-[13px]">
                                                                                    {group.proposals.length === 1 ? '1 shift' : `${group.proposals.length} shifts`}
                                                                                </span>
                                                                            </td>

                                                                            {/* 3. Total Scheduled Hours */}
                                                                            <td className={tableTokens.cell}>
                                                                                <span className="font-mono text-muted-foreground text-[12px]">
                                                                                    {group.totalHours.toFixed(1)} hrs
                                                                                </span>
                                                                            </td>

                                                                            {/* 4. Compliance Status (Quiet by default, alerts on exceptions) */}
                                                                            <td className={tableTokens.cell}>
                                                                                {group.compliancePct === 100 ? (
                                                                                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                                                                                        <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />
                                                                                        Compliant
                                                                                    </span>
                                                                                ) : (
                                                                                    <Badge
                                                                                        variant="outline"
                                                                                        className="text-[11px] font-bold gap-1 py-0.5 px-2 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                                                                    >
                                                                                        <AlertTriangle className="w-3 h-3 stroke-[2.5]" aria-hidden="true" />
                                                                                        {group.compliancePct}% Compliant
                                                                                    </Badge>
                                                                                )}
                                                                            </td>

                                                                            {/* 5. Schedule Details Action */}
                                                                            <td className={cn(tableTokens.cell, "text-right")}>
                                                                                <Button
                                                                                    type="button"
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    onClick={() => toggleExpandStaff(group.id)}
                                                                                    aria-expanded={isExpanded}
                                                                                    aria-controls={`staff-details-${group.id}`}
                                                                                    aria-label={`${isExpanded ? 'Hide' : 'View'} shifts for ${group.name}`}
                                                                                    className="h-7 px-2.5 rounded-lg text-[11px] font-medium gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                                                                                >
                                                                                    <span>{isExpanded ? 'Hide' : `View ${group.proposals.length} ${group.proposals.length === 1 ? 'shift' : 'shifts'}`}</span>
                                                                                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isExpanded && "rotate-180")} aria-hidden="true" />
                                                                                </Button>
                                                                            </td>
                                                                        </tr>

                                                                        {/* Expandable Shift Schedule Sub-Table (Compact & Scannable) */}
                                                                        {isExpanded && (
                                                                            <tr id={`staff-details-${group.id}`} className={cn(tableTokens.row, "bg-muted/10 border-b border-border/50")}>
                                                                                <td colSpan={5} className={cn(tableTokens.cell, "p-3 px-4 md:px-8")}>
                                                                                    <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-2xs">
                                                                                        <table className="w-full text-left" aria-label={`Assigned shifts for ${group.name}`}>
                                                                                            <thead>
                                                                                                <tr className="border-b border-border/40 text-[11px] font-semibold text-muted-foreground bg-muted/30">
                                                                                                    <th scope="col" className="py-2 px-3.5">Date</th>
                                                                                                    <th scope="col" className="py-2 px-3.5">Shift Window</th>
                                                                                                    <th scope="col" className="py-2 px-3.5">Duration</th>
                                                                                                    <th scope="col" className="py-2 px-3.5">Assigned Role</th>
                                                                                                    <th scope="col" className="py-2 px-3.5 text-right">EBA Status</th>
                                                                                                </tr>
                                                                                            </thead>
                                                                                            <tbody className="divide-y divide-border/30 text-[12px]">
                                                                                                {group.proposals.map((prop, propIdx) => {
                                                                                                    const shiftHours = calculateShiftHours(prop.startTime, prop.endTime);
                                                                                                    const roleColor = getRoleColor(prop.roleName ?? 'Shift');
                                                                                                    return (
                                                                                                        <tr key={`${prop.shiftId}-${propIdx}`} className="hover:bg-muted/20 transition-colors">
                                                                                                            <td className="py-2 px-3.5 font-medium text-foreground">
                                                                                                                {format(parseISO(prop.shiftDate), 'EEE, dd MMM yyyy')}
                                                                                                            </td>
                                                                                                            <td className="py-2 px-3.5 font-mono text-muted-foreground">
                                                                                                                {prop.startTime.slice(0, 5)} – {prop.endTime.slice(0, 5)}
                                                                                                            </td>
                                                                                                            <td className="py-2 px-3.5 font-mono text-muted-foreground">
                                                                                                                {shiftHours} hrs
                                                                                                            </td>
                                                                                                            <td className="py-2 px-3.5">
                                                                                                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                                                                                                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: roleColor }} />
                                                                                                                    <span className="truncate max-w-[160px]">{prop.roleName ?? 'Shift'}</span>
                                                                                                                </div>
                                                                                                            </td>
                                                                                                            <td className="py-2 px-3.5 text-right">
                                                                                                                {prop.passing ? (
                                                                                                                    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                                                                                                        ✓ Compliant
                                                                                                                    </span>
                                                                                                                ) : (
                                                                                                                    <span className="text-[11px] font-semibold text-rose-500">
                                                                                                                        {prop.violations?.[0]?.ruleName || 'Breach'}
                                                                                                                    </span>
                                                                                                                )}
                                                                                                            </td>
                                                                                                        </tr>
                                                                                                    );
                                                                                                })}
                                                                                            </tbody>
                                                                                        </table>
                                                                                    </div>
                                                                                </td>
                                                                            </tr>
                                                                        )}
                                                                    </Fragment>
                                                                );
                                                            })
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                </main>

                                {/* Review Actions Footer */}
                                <footer className="h-16 px-6 md:px-8 border-t border-border/60 bg-muted/20 flex items-center justify-between shrink-0 select-none">
                                    <p className="text-[12px] text-muted-foreground">
                                        All assignments validated under ICC Sydney EBA. Nothing is saved until applied.
                                    </p>
                                    <div className="flex items-center gap-2.5">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={handleRun}
                                            className="h-9 px-3 rounded-xl font-medium text-[12px] text-muted-foreground hover:text-foreground cursor-pointer"
                                        >
                                            Re-optimise
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleClose}
                                            className="h-9 px-3 rounded-xl font-medium text-[12px] border-border hover:bg-muted cursor-pointer"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            type="button"
                                            onClick={handleCommit}
                                            disabled={isCommitting || result.passing === 0}
                                            className="h-9 rounded-xl font-bold text-[12px] bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 px-5 shadow-2xs cursor-pointer"
                                        >
                                            {isCommitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                            Apply {result.passing} {result.passing === 1 ? 'Assignment' : 'Assignments'}
                                        </Button>
                                    </div>
                                </footer>
                            </motion.div>
                        )}
                    </AnimatePresence>
            </DialogContent>
        </Dialog>
    );
}
