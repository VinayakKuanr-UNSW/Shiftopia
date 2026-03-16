/**
 * AutoSchedulerPanel — Two-layer schedule optimization UI
 *
 * Flow:
 *   1. Manager opens panel → service health check runs automatically
 *   2. "Optimise" → Layer 1 (OR-Tools) + Layer 2 (compliance) run
 *   3. Results shown: per-employee groups with per-shift PASS/WARN/FAIL
 *   4. "Apply X Assignments" → atomic commit via sm_bulk_assign per employee
 *
 * Architecture:
 *   Optimizer proposes → Compliance validates → Manager confirms → DB commit
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/modules/core/ui/primitives/sheet';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
    Loader2,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Cpu,
    ShieldCheck,
    Zap,
    ChevronDown,
    ChevronRight,
    Users,
    AlertCircle,
    WifiOff,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { autoSchedulerController } from '@/modules/scheduling';
import { OptimizerError } from '@/modules/scheduling';
import type {
    AutoSchedulerResult,
    ValidatedProposal,
    OptimizerHealth,
} from '@/modules/scheduling';
import type { ShiftMeta, EmployeeMeta } from '@/modules/scheduling';

// =============================================================================
// PROPS
// =============================================================================

interface AutoSchedulerPanelProps {
    open: boolean;
    onClose: () => void;
    /** Draft unassigned shifts in the current planner view. */
    shifts: ShiftMeta[];
    /** Available employees in scope. */
    employees: EmployeeMeta[];
    onComplete: () => void;
}

// =============================================================================
// HEALTH INDICATOR
// =============================================================================

function HealthBadge({ health }: { health: OptimizerHealth | null }) {
    if (!health) {
        return (
            <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking…
            </Badge>
        );
    }
    if (health.available) {
        return (
            <Badge variant="outline" className="gap-1 text-xs text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                <CheckCircle2 className="h-3 w-3" />
                OR-Tools ready {health.latencyMs != null ? `(${health.latencyMs}ms)` : ''}
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="gap-1 text-xs text-red-500 border-red-500/30">
            <WifiOff className="h-3 w-3" />
            Optimizer offline
        </Badge>
    );
}

// =============================================================================
// PROPOSAL ROW
// =============================================================================

function ProposalRow({ p }: { p: ValidatedProposal }) {
    const [expanded, setExpanded] = useState(false);

    const statusIcon = {
        PASS: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />,
        WARN: <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />,
        FAIL: <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />,
    }[p.complianceStatus];

    const rowBg = {
        PASS: 'bg-emerald-500/5 border-emerald-500/15',
        WARN: 'bg-amber-500/5 border-amber-500/15',
        FAIL: 'bg-red-500/5 border-red-500/15',
    }[p.complianceStatus];

    return (
        <div className={cn('rounded border px-3 py-2', rowBg)}>
            <button
                className="w-full flex items-center gap-2 text-left"
                onClick={() => p.violations.length > 0 && setExpanded(!expanded)}
            >
                {statusIcon}
                <span className="text-xs font-medium text-foreground">{p.shiftDate}</span>
                <span className="text-xs text-muted-foreground">{p.startTime}–{p.endTime}</span>
                {p.violations.length > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">
                        {p.violations.length} issue{p.violations.length !== 1 ? 's' : ''}
                    </span>
                )}
                {p.violations.length > 0 && (
                    expanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
            </button>
            {expanded && p.violations.length > 0 && (
                <div className="mt-1.5 pl-5 space-y-1">
                    {p.violations.map((v, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">
                            <span className={cn('font-medium', v.blocking ? 'text-red-500' : 'text-amber-500')}>
                                {v.type}:{' '}
                            </span>
                            {v.description}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

// =============================================================================
// EMPLOYEE GROUP
// =============================================================================

function EmployeeGroup({ employeeId, employeeName, proposals }: {
    employeeId: string;
    employeeName: string;
    proposals: ValidatedProposal[];
}) {
    const [expanded, setExpanded] = useState(true);
    const passing = proposals.filter(p => p.passing).length;
    const failing = proposals.length - passing;

    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <button
                className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                onClick={() => setExpanded(!expanded)}
            >
                <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium text-foreground flex-1">{employeeName}</span>
                <div className="flex items-center gap-2">
                    {passing > 0 && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            {passing} ✓
                        </span>
                    )}
                    {failing > 0 && (
                        <span className="text-xs text-red-500 font-medium">
                            {failing} ✗
                        </span>
                    )}
                </div>
                {expanded
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                }
            </button>
            {expanded && (
                <div className="px-4 py-3 space-y-2">
                    {proposals.map(p => (
                        <ProposalRow key={p.shiftId} p={p} />
                    ))}
                </div>
            )}
        </div>
    );
}

// =============================================================================
// STATS BAR
// =============================================================================

function StatsBar({ result }: { result: AutoSchedulerResult }) {
    return (
        <div className="grid grid-cols-3 gap-2">
            <div className="text-center px-3 py-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{result.passing}</div>
                <div className="text-[11px] text-muted-foreground">Passing</div>
            </div>
            <div className="text-center px-3 py-2 bg-red-500/10 rounded-lg border border-red-500/20">
                <div className="text-lg font-bold text-red-500">{result.failing}</div>
                <div className="text-[11px] text-muted-foreground">Failing</div>
            </div>
            <div className="text-center px-3 py-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <div className="text-lg font-bold text-amber-500">{result.uncoveredShiftIds.length}</div>
                <div className="text-[11px] text-muted-foreground">Uncovered</div>
            </div>
        </div>
    );
}

// =============================================================================
// PIPELINE INDICATOR
// =============================================================================

type PipelinePhase = 'idle' | 'optimizing' | 'validating' | 'reviewing' | 'done';

function PipelineBar({ phase }: { phase: PipelinePhase }) {
    if (phase === 'idle') return null;

    const steps: { id: PipelinePhase; label: string; icon: React.ElementType }[] = [
        { id: 'optimizing', label: 'OR-Tools',        icon: Cpu },
        { id: 'validating', label: 'Compliance',      icon: ShieldCheck },
        { id: 'reviewing',  label: 'Manager Review',  icon: Users },
        { id: 'done',       label: 'Committed',       icon: CheckCircle2 },
    ];

    const activeIndex = steps.findIndex(s => s.id === phase);

    return (
        <div className="flex items-center gap-1 py-2">
            {steps.map((step, i) => {
                const Icon = step.icon;
                const isActive = phase === step.id;
                const isDone = i < activeIndex || phase === 'done';
                return (
                    <React.Fragment key={step.id}>
                        <div className={cn(
                            'flex items-center gap-1 text-[11px]',
                            isDone ? 'text-emerald-500' : isActive ? 'text-primary' : 'text-muted-foreground/40',
                        )}>
                            {isActive && phase !== 'done'
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Icon className="h-3 w-3" />
                            }
                            <span className="hidden sm:inline">{step.label}</span>
                        </div>
                        {i < steps.length - 1 && (
                            <div className={cn(
                                'flex-1 h-px min-w-[8px]',
                                isDone ? 'bg-emerald-500/40' : 'bg-border',
                            )} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

// =============================================================================
// MAIN PANEL
// =============================================================================

export function AutoSchedulerPanel({
    open,
    onClose,
    shifts,
    employees,
    onComplete,
}: AutoSchedulerPanelProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [health, setHealth] = useState<OptimizerHealth | null>(null);
    const [phase, setPhase] = useState<PipelinePhase>('idle');
    const [result, setResult] = useState<AutoSchedulerResult | null>(null);
    const [isCommitting, setIsCommitting] = useState(false);

    // Health check on open
    useEffect(() => {
        if (!open) return;
        setHealth(null);
        autoSchedulerController.checkHealth().then(setHealth);
    }, [open]);

    // Group proposals by employee for display
    const employeeGroups = React.useMemo(() => {
        if (!result) return [];
        const map = new Map<string, { name: string; proposals: ValidatedProposal[] }>();
        for (const p of result.proposals) {
            if (!map.has(p.employeeId)) {
                map.set(p.employeeId, { name: p.employeeName, proposals: [] });
            }
            map.get(p.employeeId)!.proposals.push(p);
        }
        return Array.from(map.entries()).map(([id, { name, proposals }]) => ({
            employeeId: id,
            employeeName: name,
            proposals,
        }));
    }, [result]);

    // ── Run optimizer ─────────────────────────────────────────────────────────
    const handleRun = useCallback(async () => {
        setResult(null);
        setPhase('optimizing');

        try {
            const schedResult = await autoSchedulerController.run({ shifts, employees });
            // After optimizer + compliance, advance to Manager Review
            setPhase('reviewing');
            setResult(schedResult);
        } catch (err: any) {
            setPhase('idle');
            if (err instanceof OptimizerError && err.code === 'CONNECTION_REFUSED') {
                toast({
                    title: 'Optimizer Offline',
                    description: 'Start the Python service: docker compose up optimizer  (or: cd optimizer-service && python ortools_runner.py)',
                    variant: 'destructive',
                });
            } else {
                toast({
                    title: 'Optimization Failed',
                    description: err?.message ?? 'Unexpected error',
                    variant: 'destructive',
                });
            }
        }
    }, [shifts, employees, toast]);

    // ── Commit ────────────────────────────────────────────────────────────────
    const handleCommit = useCallback(async () => {
        if (!result) return;
        setIsCommitting(true);

        try {
            const commitResult = await autoSchedulerController.commit(result);
            if (commitResult.success || commitResult.totalCommitted > 0) {
                setPhase('done');
                toast({
                    title: 'Shifts Assigned',
                    description: `Successfully assigned ${commitResult.totalCommitted} shift(s).`,
                });
                queryClient.invalidateQueries({ queryKey: [shiftKeys.all[0]] });
                onComplete();
                handleClose();
            } else {
                toast({
                    title: 'Commit Failed',
                    description: 'No shifts were committed. Check compliance results.',
                    variant: 'destructive',
                });
            }
        } catch (err: any) {
            toast({
                title: 'Error',
                description: err?.message ?? 'Failed to commit assignments',
                variant: 'destructive',
            });
        } finally {
            setIsCommitting(false);
        }
    }, [result, queryClient, toast, onComplete]);

    const handleClose = () => {
        setResult(null);
        setPhase('idle');
        onClose();
    };

    const unfilledCount = shifts.length;
    // Can always run (greedy fallback fires when optimizer is offline)
    const canRun = unfilledCount > 0 && employees.length > 0;

    return (
        <Sheet open={open} onOpenChange={o => !o && handleClose()}>
            <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
                {/* Header */}
                <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Cpu className="h-5 w-5 text-primary" />
                            <SheetTitle>Auto-Schedule</SheetTitle>
                        </div>
                        <HealthBadge health={health} />
                    </div>
                    <SheetDescription>
                        OR-Tools CP-SAT finds the optimal assignment for {unfilledCount} unfilled shift{unfilledCount !== 1 ? 's' : ''} across {employees.length} employee{employees.length !== 1 ? 's' : ''}.
                    </SheetDescription>

                    {/* Pipeline indicator */}
                    <PipelineBar phase={phase} />
                </SheetHeader>

                {/* Body */}
                <ScrollArea className="flex-1 min-h-0">
                    <div className="px-6 py-4 space-y-4">

                        {/* Offline warning */}
                        {health && !health.available && (
                            <div className="flex items-start gap-3 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                                <div className="text-sm">
                                    <p className="font-medium text-red-600 dark:text-red-400">Optimizer service is offline</p>
                                    <p className="text-muted-foreground text-xs mt-0.5">
                                        Start it with:
                                    </p>
                                    <code className="block mt-1 text-xs bg-background/80 rounded px-2 py-1 font-mono">
                                        docker compose up optimizer<br />
                                        <span className="text-muted-foreground"># or manually:</span><br />
                                        cd optimizer-service &amp;&amp; python ortools_runner.py
                                    </code>
                                </div>
                            </div>
                        )}

                        {/* Result stats */}
                        {result && (
                            <>
                                {result.usedFallback && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 rounded-lg border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
                                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                                        Greedy fallback used — optimizer was unavailable or returned no solution.
                                    </div>
                                )}

                                <StatsBar result={result} />

                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Cpu className="h-3 w-3" />
                                        Solve: {result.solveTimeMs}ms
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <ShieldCheck className="h-3 w-3" />
                                        Validate: {result.validationTimeMs}ms
                                    </span>
                                    <span className="ml-auto font-medium capitalize text-foreground">
                                        {result.optimizerStatus}
                                    </span>
                                </div>
                            </>
                        )}

                        {/* Employee groups */}
                        {employeeGroups.length > 0 && (
                            <div className="space-y-3">
                                <h3 className="text-sm font-medium text-foreground">
                                    Proposed Assignments ({result?.totalProposals})
                                </h3>
                                {employeeGroups.map(g => (
                                    <EmployeeGroup
                                        key={g.employeeId}
                                        employeeId={g.employeeId}
                                        employeeName={g.employeeName}
                                        proposals={g.proposals}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Uncovered shifts */}
                        {result && result.uncoveredShiftIds.length > 0 && (
                            <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                                <p className="text-sm font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                    <AlertTriangle className="h-4 w-4" />
                                    {result.uncoveredShiftIds.length} shift{result.uncoveredShiftIds.length !== 1 ? 's' : ''} could not be filled
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    No eligible employee was available for these shifts. Consider adjusting staffing or constraints.
                                </p>
                            </div>
                        )}

                        {/* Empty state */}
                        {phase === 'idle' && !result && (
                            <div className="py-10 text-center text-muted-foreground">
                                <Cpu className="h-12 w-12 mx-auto mb-3 opacity-20" />
                                <p className="text-sm">
                                    {unfilledCount === 0
                                        ? 'No unfilled shifts in current view'
                                        : employees.length === 0
                                            ? 'No employees available in scope'
                                            : health && !health.available
                                                ? 'Optimizer offline — greedy fallback will run'
                                                : 'Click "Optimise" to find the best schedule'}
                                </p>
                            </div>
                        )}
                    </div>
                </ScrollArea>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-border space-y-2">
                    {result && result.passing > 0 && !isCommitting && (
                        <p className="text-xs text-center text-muted-foreground">
                            {result.failing > 0
                                ? `${result.failing} shift(s) with blocking violations will be skipped`
                                : 'All proposals passed compliance — ready to apply'}
                        </p>
                    )}

                    {!result ? (
                        <Button
                            className="w-full gap-2"
                            onClick={handleRun}
                            disabled={!canRun || phase !== 'idle'}
                        >
                            {phase !== 'idle' ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {phase === 'optimizing' ? 'Running OR-Tools…' : 'Validating compliance…'}
                                </>
                            ) : (
                                <>
                                    <Zap className="h-4 w-4" />
                                    Optimise {unfilledCount} Shift{unfilledCount !== 1 ? 's' : ''}
                                </>
                            )}
                        </Button>
                    ) : (
                        <>
                            <Button
                                className={cn(
                                    'w-full gap-2',
                                    result.canCommit
                                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                        : 'opacity-50',
                                )}
                                onClick={handleCommit}
                                disabled={!result.canCommit || isCommitting}
                            >
                                {isCommitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Applying…
                                    </>
                                ) : (
                                    <>
                                        <Zap className="h-4 w-4" />
                                        Apply {result.passing} Assignment{result.passing !== 1 ? 's' : ''}
                                    </>
                                )}
                            </Button>
                            <Button
                                variant="outline"
                                className="w-full gap-2"
                                onClick={handleRun}
                                disabled={phase !== 'idle' && phase !== 'done'}
                            >
                                <Cpu className="h-4 w-4" />
                                Re-optimise
                            </Button>
                        </>
                    )}
                    <Button variant="ghost" className="w-full" onClick={handleClose}>
                        Cancel
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
