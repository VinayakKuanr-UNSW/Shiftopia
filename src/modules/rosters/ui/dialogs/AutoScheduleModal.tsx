import React, { useState, useEffect, useCallback } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import {
    Check,
    Settings2,
    Play,
    AlertCircle,
    RefreshCcw,
    Loader2,
    Info,
    AlertTriangle,
    DollarSign,
    Users,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import {
    AutoScheduleState,
    AutoScheduleContext,
    BaselineScan,
    SimulationResult,
    SimulationScope,
    SimulationStrategy,
    SoftConstraints,
    SnapshotConflictError,
    fetchBaseline,
    runSimulation,
    saveAsDraft,
    commitAssignments,
} from '@/modules/rosters/api/autoschedule.api';
import { useToast } from '@/modules/core/hooks/use-toast';

export interface AutoScheduleModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    context: AutoScheduleContext;
    onAssignmentsApplied?: () => void;
}

const DEFAULT_SOFT_CONSTRAINTS: SoftConstraints = {
    minimize_overtime: true,
    fairness: true,
    prioritize_senior: false,
    minimize_travel: false,
};

export const AutoScheduleModal: React.FC<AutoScheduleModalProps> = ({
    isOpen,
    onOpenChange,
    context,
    onAssignmentsApplied,
}) => {
    const { toast } = useToast();

    // ── State Machine ──────────────────────────────────────────────────────
    const [modalState, setModalState] = useState<AutoScheduleState>('BASELINE_LOADING');

    // ── Data ───────────────────────────────────────────────────────────────
    const [baselineData, setBaselineData] = useState<BaselineScan | null>(null);
    const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    // ── Session tracking ───────────────────────────────────────────────────
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [snapshotVersion, setSnapshotVersion] = useState<string | null>(null);

    // ── Configuration ──────────────────────────────────────────────────────
    const [scope, setScope] = useState<SimulationScope>('ALL_ELIGIBLE');
    const [strategy, setStrategy] = useState<SimulationStrategy>('BALANCED');
    const [softConstraints, setSoftConstraints] = useState<SoftConstraints>(DEFAULT_SOFT_CONSTRAINTS);

    // ── UI state ───────────────────────────────────────────────────────────
    const [showConflictDrawer, setShowConflictDrawer] = useState(false);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [showAllAssignments, setShowAllAssignments] = useState(false);

    // ── Reset + fetch on open ──────────────────────────────────────────────
    useEffect(() => {
        if (isOpen) {
            setModalState('BASELINE_LOADING');
            setSimulationResult(null);
            setSessionId(null);
            setSnapshotVersion(null);
            setErrorMessage('');
            setShowConflictDrawer(false);
            setShowExitConfirm(false);
            setShowAllAssignments(false);
            doFetchBaseline();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const doFetchBaseline = useCallback(async () => {
        setModalState('BASELINE_LOADING');
        setErrorMessage('');
        // Reset simulation state so footer buttons correctly require a new run
        setSimulationResult(null);
        setSessionId(null);
        try {
            const data = await fetchBaseline(context);
            setBaselineData(data);
            setSnapshotVersion(data.snapshot_version);
            setModalState('BASELINE_READY');
        } catch {
            setModalState('SIMULATION_ERROR');
            setErrorMessage('Failed to fetch roster baseline. Please try again.');
        }
    }, [context]);

    // ── Close guard ────────────────────────────────────────────────────────
    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open && modalState === 'SIMULATING') {
                setShowExitConfirm(true);
                return;
            }
            onOpenChange(open);
        },
        [modalState, onOpenChange]
    );

    const handleForceClose = () => {
        setShowExitConfirm(false);
        onOpenChange(false);
    };

    // ── Scope toggle — re-fetches baseline so counts update ────────────────
    const handleScopeChange = (newScope: SimulationScope) => {
        setScope(newScope);
        setModalState('BASELINE_LOADING');
        setSimulationResult(null);
        setSessionId(null);
        fetchBaseline(context)
            .then((data) => {
                setBaselineData(data);
                setSnapshotVersion(data.snapshot_version);
                setModalState('BASELINE_READY');
            })
            .catch(() => {
                setModalState('SIMULATION_ERROR');
                setErrorMessage('Failed to refresh baseline after scope change.');
            });
    };

    // ── Run simulation ─────────────────────────────────────────────────────
    const handleRunSimulation = async () => {
        if (!baselineData || !snapshotVersion || modalState !== 'BASELINE_READY') return;

        setModalState('SIMULATING');
        setErrorMessage('');

        try {
            const result = await runSimulation(context, {
                scope,
                selectedV8ShiftIds: scope === 'SELECTED' ? baselineData.eligible_shifts : [],
                strategy,
                softConstraints,
                snapshotVersion,
            });
            setSimulationResult(result);
            setSessionId(result.sessionId);
            setSnapshotVersion(result.snapshotVersion);
            setModalState('SIMULATION_READY');
        } catch (err) {
            if (err instanceof SnapshotConflictError) {
                setModalState('SNAPSHOT_INVALID');
            } else {
                setModalState('SIMULATION_ERROR');
                setErrorMessage(
                    err instanceof Error ? err.message : 'Simulation failed due to an unexpected error.'
                );
            }
        }
    };

    // ── Save as draft ──────────────────────────────────────────────────────
    const handleSaveAsDraft = async () => {
        if (!sessionId || !snapshotVersion) return;
        try {
            await saveAsDraft(sessionId, snapshotVersion);
            toast({ title: 'Saved as Draft', description: 'Assignments saved. Not yet applied to roster.' });
            onAssignmentsApplied?.();
            onOpenChange(false);
        } catch (err) {
            if (err instanceof SnapshotConflictError) {
                setModalState('SNAPSHOT_INVALID');
            } else {
                toast({
                    title: 'Save failed',
                    description: err instanceof Error ? err.message : 'Could not save draft.',
                    variant: 'destructive',
                });
            }
        }
    };

    // ── Confirm & assign ───────────────────────────────────────────────────
    const handleConfirmAndAssign = async () => {
        if (!sessionId || !snapshotVersion) return;
        try {
            const result = await commitAssignments(sessionId, snapshotVersion);
            toast({
                title: 'Assignments Confirmed',
                description: `${result.updatedCount} shift${result.updatedCount !== 1 ? 's' : ''} assigned successfully.`,
            });
            onAssignmentsApplied?.();
            onOpenChange(false);
        } catch (err) {
            if (err instanceof SnapshotConflictError) {
                setModalState('SNAPSHOT_INVALID');
            } else {
                toast({
                    title: 'Commit failed',
                    description: err instanceof Error ? err.message : 'Could not apply assignments.',
                    variant: 'destructive',
                });
            }
        }
    };

    const toggleSoftConstraint = (key: keyof SoftConstraints) => {
        setSoftConstraints((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    // ──────────────────────────────────────────────────────────────────────
    // Render helpers
    // ──────────────────────────────────────────────────────────────────────

    const renderBaselineLoading = () => (
        <div className="flex items-center justify-center min-h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        </div>
    );

    const renderSimulating = () => (
        <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
            <div className="relative mb-6 w-16 h-16">
                <div className="absolute inset-0 border-4 border-slate-200 dark:border-slate-800 rounded-full" />
                <div className="absolute inset-0 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                <div className="w-full h-full rounded-full flex items-center justify-center bg-emerald-50 dark:bg-emerald-900/20">
                    <Settings2 className="w-6 h-6 text-emerald-500 animate-pulse" />
                </div>
            </div>
            <h3 className="text-lg font-semibold mb-2">Running Scheduling Engine…</h3>
            <p className="text-sm text-slate-500 max-w-sm text-center">
                Analysing {baselineData?.available_staff_count ?? 0} staff against{' '}
                {baselineData?.unassigned_count ?? 0} open shifts and resolving constraints.
            </p>
        </div>
    );

    const renderError = () => (
        <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-red-100 text-red-600 mb-6">
                <AlertCircle className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold mb-2">Operation Failed</h3>
            <p className="text-slate-500 mb-6 max-w-md text-center">{errorMessage}</p>
            <div className="flex gap-3">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={doFetchBaseline}>
                    <RefreshCcw className="w-4 h-4 mr-2" />
                    Reconfigure & Retry
                </Button>
            </div>
        </div>
    );

    const renderSnapshotInvalid = () => (
        <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-amber-100 text-amber-600 mb-6">
                <AlertTriangle className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold mb-2">Roster Changed</h3>
            <p className="text-slate-500 mb-6 max-w-md text-center">
                The roster was modified while the simulation was running. The result is stale and cannot
                be committed. Please re-fetch the baseline and run again.
            </p>
            <div className="flex gap-3">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={doFetchBaseline}>
                    <RefreshCcw className="w-4 h-4 mr-2" />
                    Re-fetch Baseline
                </Button>
            </div>
        </div>
    );

    const renderSimulationResult = () => {
        if (!simulationResult) return null;
        const { summary, assignments, conflicts } = simulationResult;
        const coveragePct =
            summary.total_shifts > 0
                ? Math.round((summary.assigned_shifts / summary.total_shifts) * 100)
                : 0;
        const visibleAssignments = showAllAssignments ? assignments : assignments.slice(0, 8);

        return (
            <div className="space-y-5 text-sm animate-in fade-in duration-200">
                {/* Success banner with coverage bar */}
                <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/50 rounded-xl p-5">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-9 h-9 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center flex-shrink-0">
                            <Check className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-emerald-900 dark:text-emerald-400">
                                Simulation Complete — {coveragePct}% coverage
                            </h3>
                            <p className="text-xs text-emerald-600/70 dark:text-emerald-500/70">
                                {summary.assigned_shifts} of {summary.total_shifts} shifts assigned
                                {summary.unassigned_shifts > 0 && ` · ${summary.unassigned_shifts} unresolvable`}
                            </p>
                        </div>
                    </div>
                    <div className="w-full h-2 bg-emerald-200/50 dark:bg-emerald-900/30 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                            style={{ width: `${coveragePct}%` }}
                        />
                    </div>
                </div>

                {/* Metric cards */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white dark:bg-[#0a0f1e] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex items-start gap-3">
                        <Users className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div>
                            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Assigned</div>
                            <div className="text-2xl font-semibold text-slate-900 dark:text-white">{summary.assigned_shifts}</div>
                            <div className="text-xs text-slate-400">shifts</div>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-[#0a0f1e] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex items-start gap-3">
                        <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        <div>
                            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Unresolved</div>
                            <div className="text-2xl font-semibold text-slate-900 dark:text-white">{summary.unassigned_shifts}</div>
                            <div className="text-xs text-slate-400">shifts</div>
                        </div>
                    </div>
                    <div className="bg-white dark:bg-[#0a0f1e] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex items-start gap-3">
                        <DollarSign className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <div>
                            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Est. Cost</div>
                            <div className="text-2xl font-semibold text-slate-900 dark:text-white">
                                ${summary.cost_estimate.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                            </div>
                            <div className="text-xs text-slate-400">AUD</div>
                        </div>
                    </div>
                </div>

                {/* Assignments list */}
                {assignments.length > 0 && (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Proposed Assignments</span>
                            <span className="text-xs text-slate-400">{assignments.length} total</span>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-white/5 max-h-48 overflow-y-auto">
                            {visibleAssignments.map((a, i) => (
                                <div key={a.shiftId} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50/50 dark:hover:bg-white/[0.01]">
                                    <div className="flex items-center gap-2">
                                        <div className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                                            {i + 1}
                                        </div>
                                        <span className="font-medium text-slate-800 dark:text-slate-200">
                                            {a.employeeName || 'Unknown'}
                                        </span>
                                    </div>
                                    <span className="text-xs font-mono text-slate-400">{a.shiftId.slice(0, 8)}…</span>
                                </div>
                            ))}
                        </div>
                        {assignments.length > 8 && (
                            <button
                                onClick={() => setShowAllAssignments((v) => !v)}
                                className="w-full px-4 py-2.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center justify-center gap-1 bg-slate-50/50 dark:bg-white/[0.01] border-t border-slate-100 dark:border-white/5"
                            >
                                {showAllAssignments
                                    ? <><ChevronUp className="w-3 h-3" /> Show less</>
                                    : <><ChevronDown className="w-3 h-3" /> Show {assignments.length - 8} more</>
                                }
                            </button>
                        )}
                    </div>
                )}

                {/* Conflicts list */}
                {conflicts.length > 0 && (
                    <div className="border border-amber-200 dark:border-amber-800/40 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-100 dark:border-amber-900/20 flex items-center gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                                {conflicts.length} Unresolvable Shift{conflicts.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="divide-y divide-amber-100 dark:divide-amber-900/20 max-h-32 overflow-y-auto">
                            {conflicts.map((c) => (
                                <div key={c.shiftId} className="px-4 py-2.5">
                                    <p className="text-xs text-slate-600 dark:text-slate-400">{c.description}</p>
                                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">{c.shiftId.slice(0, 8)}…</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex justify-between items-center pt-4 border-t border-slate-200 dark:border-slate-800">
                    <Button variant="ghost" onClick={doFetchBaseline}>← Reconfigure</Button>
                    <div className="flex gap-3">
                        <Button variant="outline" onClick={handleSaveAsDraft}>Save as Draft</Button>
                        <Button onClick={handleConfirmAndAssign} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                            <Check className="w-4 h-4 mr-2" />
                            Confirm & Assign
                        </Button>
                    </div>
                </div>
            </div>
        );
    };

    const renderBaseline = () => (
        <div className="space-y-8 animate-in fade-in zoom-in-95 duration-200">

            {/* Assignment Scope */}
            <div className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-500 tracking-wider uppercase">Assignment Scope</h4>
                <div className="grid grid-cols-2 gap-4">
                    <button
                        onClick={() => handleScopeChange('ALL_ELIGIBLE')}
                        className={cn(
                            'flex items-start gap-4 p-4 rounded-xl text-left transition-all border-2',
                            scope === 'ALL_ELIGIBLE'
                                ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-500/5'
                                : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 bg-white dark:bg-[#0a0f1e]'
                        )}
                    >
                        <RadioDot active={scope === 'ALL_ELIGIBLE'} />
                        <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">All Unassigned + Draft Shifts</div>
                            <div className="text-sm text-slate-500 mt-0.5">
                                Includes {baselineData?.unassigned_count ?? 0} pending shifts
                            </div>
                        </div>
                    </button>
                    <button
                        disabled
                        className="flex items-start gap-4 p-4 rounded-xl text-left border-2 border-slate-100 dark:border-slate-800 bg-white dark:bg-[#0a0f1e] opacity-50 cursor-not-allowed"
                    >
                        <RadioDot active={false} />
                        <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">Only Selected Shifts</div>
                            <div className="text-sm text-slate-500 mt-0.5">Requires shift selection in Group Mode</div>
                        </div>
                    </button>
                </div>
            </div>

            {/* Constraints grid */}
            <div className="grid grid-cols-2 gap-8">
                {/* Hard constraints */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-semibold text-slate-500 tracking-wider uppercase">Hard Constraints (Enforced)</h4>
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                            <LockIcon className="w-3 h-3" /> Admin Locked
                        </span>
                    </div>
                    <div className="bg-slate-50/50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 rounded-xl p-4 grid grid-cols-2 gap-y-3 gap-x-2">
                        {[
                            'Max shift length: 12h',
                            'Min rest period: 10h',
                            'Visa compliance',
                            'Union rules (L1)',
                            'Weekly hour caps',
                            'Certifications matched',
                            'No double booking',
                            'Location proximity',
                        ].map((label) => (
                            <div key={label} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                <div className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center flex-shrink-0">
                                    <Check className="w-3 h-3" />
                                </div>
                                {label}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Soft constraints */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-semibold text-slate-500 tracking-wider uppercase">Soft Constraints</h4>
                        <div className="flex items-center gap-2 text-xs">
                            <span className="text-slate-500">Strategy:</span>
                            <select
                                className="bg-white dark:bg-[#0a0f1e] text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
                                value={strategy}
                                onChange={(e) => setStrategy(e.target.value as SimulationStrategy)}
                            >
                                <option value="BALANCED">Balanced</option>
                                <option value="COST_OPTIMIZED">Cost Optimized</option>
                                <option value="COVERAGE_MAXIMIZED">Max Coverage</option>
                            </select>
                        </div>
                    </div>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
                        {(
                            [
                                { key: 'minimize_overtime', label: 'Minimize Overtime Costs' },
                                { key: 'fairness', label: 'Balance Shift Distribution Fairly' },
                                { key: 'prioritize_senior', label: 'Prioritize Senior Staff' },
                                { key: 'minimize_travel', label: 'Minimize Travel Time' },
                            ] as { key: keyof SoftConstraints; label: string }[]
                        ).map(({ key, label }) => (
                            <label
                                key={key}
                                className="flex items-center gap-3 cursor-pointer group"
                                onClick={() => toggleSoftConstraint(key)}
                            >
                                <div className={cn(
                                    'w-4 h-4 rounded-sm border flex items-center justify-center transition-colors',
                                    softConstraints[key]
                                        ? 'bg-blue-500 border-blue-500 text-white'
                                        : 'border-slate-300 dark:border-slate-600 group-hover:border-blue-400'
                                )}>
                                    {softConstraints[key] && <Check className="w-3 h-3" />}
                                </div>
                                <span className="text-sm text-slate-700 dark:text-slate-300 select-none">{label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>

            {/* Baseline scan metrics */}
            <div className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-500 tracking-wider uppercase">Baseline Scan</h4>
                <div className="grid grid-cols-4 gap-4">
                    <MetricCard label="Unassigned Shifts" value={baselineData?.unassigned_count} />
                    <MetricCard label="Already Assigned" value={baselineData?.assigned_count} />
                    <MetricCard label="Available Staff Pool" value={baselineData?.available_staff_count} />
                    <ConflictCard
                        count={baselineData?.potential_conflicts ?? 0}
                        onReview={() => setShowConflictDrawer((v) => !v)}
                        isOpen={showConflictDrawer}
                    />
                </div>

                {/* Conflict detail drawer */}
                {showConflictDrawer && (baselineData?.potential_conflicts ?? 0) > 0 && (
                    <div className="border border-amber-200 dark:border-amber-800/40 rounded-xl overflow-hidden animate-in slide-in-from-top-2 duration-150">
                        <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-100 dark:border-amber-900/20">
                            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                                Conflict Breakdown
                            </span>
                        </div>
                        <div className="px-4 py-3 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                            <p>
                                <span className="font-medium text-amber-700 dark:text-amber-400">
                                    {baselineData?.potential_conflicts}
                                </span>{' '}
                                shift{(baselineData?.potential_conflicts ?? 0) !== 1 ? 's' : ''} require roles
                                with no matching staff currently contracted.
                            </p>
                            <p className="text-xs text-slate-400">
                                These will remain unassigned after simulation. Consider adding staff or relaxing role
                                requirements.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Run button */}
            <div className="flex justify-center pt-2">
                <Button
                    size="lg"
                    onClick={handleRunSimulation}
                    disabled={!baselineData || baselineData.unassigned_count === 0}
                    className="bg-[#0f172a] hover:bg-[#1e293b] text-white dark:bg-white dark:text-[#0f172a] dark:hover:bg-slate-200 rounded-full px-8 shadow-lg shadow-black/10 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Play className="w-4 h-4 mr-2" fill="currentColor" />
                    {(!baselineData || baselineData.unassigned_count === 0) ? 'No Unassigned Shifts' : 'Run Simulation'}
                </Button>
            </div>
        </div>
    );

    // ── Main render ────────────────────────────────────────────────────────
    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden bg-white dark:bg-[#0d1424] border-slate-200 dark:border-slate-800">

                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-black/20">
                    <div>
                        <DialogTitle className="text-xl font-semibold">
                            AutoSchedule — Event Setups
                        </DialogTitle>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Optimise workforce assignments within selected date range
                        </p>
                    </div>
                    {snapshotVersion && modalState !== 'SNAPSHOT_INVALID' && (
                        <Badge
                            variant="outline"
                            className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20 px-2.5 py-1 font-mono text-xs"
                        >
                            <Check className="w-3.5 h-3.5 mr-1" />
                            Snapshot: {snapshotVersion.slice(5, 13)}
                        </Badge>
                    )}
                </div>

                {/* Exit confirmation overlay */}
                {showExitConfirm && (
                    <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                        <div className="bg-white dark:bg-[#0d1424] rounded-2xl p-6 max-w-sm mx-4 shadow-2xl border border-slate-200 dark:border-slate-700">
                            <h3 className="font-semibold text-lg mb-2">Exit while simulating?</h3>
                            <p className="text-sm text-slate-500 mb-5">
                                The simulation is still running. Exiting now will discard the result.
                            </p>
                            <div className="flex justify-end gap-3">
                                <Button variant="outline" onClick={() => setShowExitConfirm(false)}>
                                    Keep waiting
                                </Button>
                                <Button variant="destructive" onClick={handleForceClose}>
                                    Exit anyway
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Content area */}
                <div className="p-6">
                    {modalState === 'BASELINE_LOADING' && renderBaselineLoading()}
                    {modalState === 'BASELINE_READY' && renderBaseline()}
                    {modalState === 'SIMULATING' && renderSimulating()}
                    {modalState === 'SIMULATION_READY' && renderSimulationResult()}
                    {modalState === 'SIMULATION_ERROR' && renderError()}
                    {modalState === 'SNAPSHOT_INVALID' && renderSnapshotInvalid()}
                </div>

                {/* Dynamic warning banner */}
                {modalState === 'BASELINE_READY' && (baselineData?.potential_conflicts ?? 0) > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-900/10 border-y border-amber-100 dark:border-amber-900/30 px-6 py-3 flex items-start gap-3">
                        <div className="p-0.5 bg-amber-500 rounded-full text-white mt-0.5 flex-shrink-0">
                            <Info className="w-3.5 h-3.5" />
                        </div>
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-500">
                            {baselineData?.potential_conflicts} shift
                            {(baselineData?.potential_conflicts ?? 0) !== 1 ? 's' : ''} may remain unassigned —
                            role requirements exceed available staff.
                        </p>
                    </div>
                )}

                {/* Footer — only when on baseline config view */}
                {modalState === 'BASELINE_READY' && (
                    <div className="px-6 py-4 flex items-center justify-between bg-slate-50/50 dark:bg-black/20 border-t border-slate-100 dark:border-white/5">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <div className="flex gap-3">
                            <Button
                                variant="outline"
                                disabled={!sessionId}
                                onClick={handleSaveAsDraft}
                                title={sessionId ? undefined : 'Run simulation first to enable'}
                            >
                                Save as Draft
                            </Button>
                            <Button
                                disabled={!sessionId}
                                onClick={handleConfirmAndAssign}
                                className="bg-[#06b6d4] hover:bg-[#0891b2] text-white disabled:opacity-50"
                                title={sessionId ? undefined : 'Run simulation first to enable'}
                            >
                                <Check className="w-4 h-4 mr-2" />
                                Confirm & Assign
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function RadioDot({ active }: { active: boolean }) {
    return (
        <div className={cn(
            'mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
            active ? 'border-blue-500' : 'border-slate-300 dark:border-slate-600'
        )}>
            {active && <div className="w-2.5 h-2.5 bg-blue-500 rounded-full" />}
        </div>
    );
}

function MetricCard({ label, value }: { label: string; value: number | undefined }) {
    return (
        <div className="bg-white dark:bg-[#0a0f1e] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">{label}</div>
            <div className="text-2xl font-semibold text-slate-900 dark:text-white">
                {value !== undefined
                    ? value
                    : <Loader2 className="w-5 h-5 animate-spin text-slate-300 inline" />
                }
            </div>
        </div>
    );
}

function ConflictCard({
    count,
    onReview,
    isOpen,
}: {
    count: number;
    onReview: () => void;
    isOpen: boolean;
}) {
    return (
        <button
            onClick={onReview}
            className={cn(
                'rounded-lg p-4 text-left w-full transition-all',
                count > 0
                    ? 'bg-amber-50/50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 hover:bg-amber-100/50'
                    : 'bg-white dark:bg-[#0a0f1e] border border-slate-200 dark:border-slate-800'
            )}
        >
            <div className="text-[10px] uppercase font-bold tracking-wider mb-1 flex items-center justify-between w-full">
                <span className={count > 0 ? 'text-amber-700 dark:text-amber-500' : 'text-slate-500'}>
                    Potential Conflicts
                </span>
                {count > 0 && (
                    <span className="text-amber-500">{isOpen ? '↑' : '›'}</span>
                )}
            </div>
            <div className={cn(
                'text-2xl font-semibold flex items-center gap-2',
                count > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-900 dark:text-white'
            )}>
                {count}
                {count > 0 && (
                    <span className="text-[10px] bg-amber-200 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium">
                        Review
                    </span>
                )}
            </div>
        </button>
    );
}

function LockIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
    );
}
