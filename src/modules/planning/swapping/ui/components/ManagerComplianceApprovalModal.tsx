/**
 * ManagerComplianceApprovalModal
 *
 * Opens when a manager clicks "Approve" on a single MANAGER_PENDING swap.
 * Re-runs the constraint solver (all 8 constraints simultaneously) against
 * both parties' CURRENT rosters — catching any schedule drift since the
 * original offer was accepted.
 *
 * Flow:
 *   1. Fetch both shifts from DB
 *   2. Fetch both rosters (±30 days)
 *   3. Run swapEvaluator.evaluate() → SolverResult
 *   4. Display per-constraint results for BOTH parties
 *   5. Block approval if any blocking violation exists
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import {
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Circle,
    Shield,
    ArrowLeftRight,
    Loader2,
    RefreshCw,
    Gavel,
    X,
    Check,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { supabase } from '@/platform/realtime/client';
import {
    swapEvaluator,
    SolverResult,
    ConstraintViolation,
    getScenarioWindow,
} from '@/modules/compliance';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';
import { motion, AnimatePresence } from 'framer-motion';

function calcNetMinutes(s: { start_time: string; end_time: string; unpaid_break_minutes?: number }): number {
    const parse = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = parse(s.end_time) - parse(s.start_time);
    if (gross < 0) gross += 24 * 60;
    return Math.max(0, gross - (s.unpaid_break_minutes ?? 0));
}

// =============================================================================
// TYPES
// =============================================================================

interface ShiftRow {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes?: number;
}

interface RosterShiftInput {
    id?: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes?: number;
}

export interface ManagerComplianceApprovalModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Called when manager confirms approval (after compliance passes) */
    onApprove: () => Promise<void>;
    /** Called when manager clicks Reject Instead */
    onReject: () => void;

    swapId: string;
    requesterEmployeeId: string;
    requesterName: string;
    requesterShiftId: string;
    offererEmployeeId: string | null;
    offererName: string;
    offererShiftId: string | null;
}

// =============================================================================
// HELPERS
// =============================================================================

const getInitials = (name: string) => {
    const p = name.trim().split(' ');
    if (p.length >= 2) return `${p[0][0]}${p[p.length - 1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
};

const formatTime = (t: string) => {
    const [h, m] = (t || '00:00').split(':').map(Number);
    const p = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${p}`;
};

function StatusIcon({ status }: { status: 'pass' | 'fail' | 'warning' | 'pending' }) {
    if (status === 'pass')    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (status === 'fail')    return <XCircle      className="h-4 w-4 text-rose-500" />;
    if (status === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    return <Circle className="h-4 w-4 text-muted-foreground/30" />;
}

function StatusBadge({ status, label }: { status: 'pass' | 'fail' | 'warning' | 'pending'; label: string }) {
    const cls =
        status === 'pass'    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' :
        status === 'fail'    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' :
        status === 'warning' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' :
                               'bg-muted/50 text-muted-foreground/40 border-border';
    return (
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-wider', cls)}>
            <StatusIcon status={status} />
            {label}
        </span>
    );
}

// =============================================================================
// CONSTRAINT RESULT ROW
// =============================================================================

interface ConstraintRowProps {
    constraintId: string;
    constraintName: string;
    requesterResult: ConstraintViolation | undefined;
    offererResult: ConstraintViolation | undefined;
    requesterName: string;
    offererName: string;
}

function ConstraintRow({ constraintName, requesterResult, offererResult, requesterName, offererName }: ConstraintRowProps) {
    const [expanded, setExpanded] = useState(false);

    const reqStatus  = (requesterResult?.status ?? 'pending') as 'pass' | 'fail' | 'warning' | 'pending';
    const offStatus  = (offererResult?.status  ?? 'pending') as 'pass' | 'fail' | 'warning' | 'pending';
    const rowStatus  = reqStatus === 'fail' || offStatus === 'fail'    ? 'fail' :
                       reqStatus === 'warning' || offStatus === 'warning' ? 'warning' : 'pass';
    const hasDetails = requesterResult?.details || offererResult?.details;

    return (
        <div className={cn(
            'rounded-xl border transition-all duration-200',
            rowStatus === 'fail'    ? 'border-rose-500/20 bg-rose-500/5' :
            rowStatus === 'warning' ? 'border-amber-500/20 bg-amber-500/5' :
                                     'border-border bg-card/30',
        )}>
            <button
                onClick={() => hasDetails && setExpanded(e => !e)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
                disabled={!hasDetails}
            >
                <StatusIcon status={rowStatus} />
                <span className="flex-1 text-[12px] font-bold text-foreground">{constraintName}</span>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase">{requesterName.split(' ')[0]}</span>
                        <StatusBadge status={reqStatus} label={reqStatus === 'pending' ? '—' : reqStatus} />
                    </div>
                    <span className="text-muted-foreground/30 text-[10px]">·</span>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase">{offererName.split(' ')[0]}</span>
                        <StatusBadge status={offStatus} label={offStatus === 'pending' ? '—' : offStatus} />
                    </div>
                </div>
            </button>

            <AnimatePresence>
                {expanded && hasDetails && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-3 space-y-2 border-t border-border/30 pt-3">
                            {requesterResult && requesterResult.status !== 'pass' && (
                                <div className="text-[11px] text-foreground/70 leading-relaxed">
                                    <span className="font-black text-foreground/50 uppercase tracking-wider text-[9px]">[{requesterName}]</span>{' '}
                                    {requesterResult.details}
                                </div>
                            )}
                            {offererResult && offererResult.status !== 'pass' && (
                                <div className="text-[11px] text-foreground/70 leading-relaxed">
                                    <span className="font-black text-foreground/50 uppercase tracking-wider text-[9px]">[{offererName}]</span>{' '}
                                    {offererResult.details}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ManagerComplianceApprovalModal({
    isOpen,
    onClose,
    onApprove,
    onReject,
    requesterEmployeeId,
    requesterName,
    requesterShiftId,
    offererEmployeeId,
    offererName,
    offererShiftId,
}: ManagerComplianceApprovalModalProps) {
    const [phase, setPhase] = useState<'loading' | 'results' | 'error'>('loading');
    const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isApproving, setIsApproving] = useState(false);

    // -------------------------------------------------------------------------
    // Run compliance check
    // -------------------------------------------------------------------------
    const runChecks = useCallback(async () => {
        if (!requesterEmployeeId || !requesterShiftId) return;

        setPhase('loading');
        setErrorMsg(null);
        setSolverResult(null);

        try {
            // 1. Fetch both shifts
            const shiftIds = [requesterShiftId, offererShiftId].filter(Boolean) as string[];
            const { data: shiftRows, error: shiftErr } = await supabase
                .from('shifts')
                .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
                .in('id', shiftIds);

            if (shiftErr) throw shiftErr;

            const requesterShift = (shiftRows || []).find((s: ShiftRow) => s.id === requesterShiftId);
            const offererShift   = offererShiftId ? (shiftRows || []).find((s: ShiftRow) => s.id === offererShiftId) : null;

            if (!requesterShift) throw new Error('Requester shift not found.');

            // 2. Fetch rosters ±28 days around the requester's shift date
            const { start: startDate, end: endDate } = getScenarioWindow(requesterShift.shift_date);

            const fetchRoster = async (employeeId: string): Promise<RosterShiftInput[]> => {
                const { data, error } = await supabase
                    .from('shifts')
                    .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
                    .eq('assigned_employee_id', employeeId)
                    .gte('shift_date', startDate)
                    .lte('shift_date', endDate)
                    .is('deleted_at', null)
                    .is('is_cancelled', false);
                if (error) return [];
                return data || [];
            };

            const [requesterRoster, offererRoster] = await Promise.all([
                fetchRoster(requesterEmployeeId),
                offererEmployeeId ? fetchRoster(offererEmployeeId) : Promise.resolve([] as RosterShiftInput[]),
            ]);

            // 3. Run constraint solver (all 8 scheduling constraints simultaneously)
            const result = swapEvaluator.evaluate({
                partyA: {
                    employee_id: requesterEmployeeId,
                    name: requesterName,
                    current_shifts: requesterRoster,
                    shift_to_give: requesterShift,
                },
                partyB: {
                    employee_id: offererEmployeeId || 'unknown',
                    name: offererName,
                    current_shifts: offererRoster,
                    shift_to_give: offererShift ?? {
                        shift_date: requesterShift.shift_date,
                        start_time: '00:00',
                        end_time: '00:00',
                    },
                },
            });

            // 4. Server-side qualification checks (role/license/skill) — run for both
            //    parties when both shifts are known. These cannot be evaluated client-side.
            let finalResult: SolverResult = result;

            if (offererShift && offererEmployeeId) {
                try {
                    const [reqQual, offQual] = await Promise.all([
                        // Requester is RECEIVING the offerer's shift
                        validateCompliance({
                            employeeId: requesterEmployeeId,
                            shiftDate:  offererShift.shift_date,
                            startTime:  offererShift.start_time,
                            endTime:    offererShift.end_time,
                            netLengthMinutes: calcNetMinutes(offererShift),
                            shiftId:        offererShiftId!,
                            excludeShiftId: requesterShiftId,
                        }),
                        // Offerer is RECEIVING the requester's shift
                        validateCompliance({
                            employeeId: offererEmployeeId,
                            shiftDate:  requesterShift.shift_date,
                            startTime:  requesterShift.start_time,
                            endTime:    requesterShift.end_time,
                            netLengthMinutes: calcNetMinutes(requesterShift),
                            shiftId:        requesterShiftId,
                            excludeShiftId: offererShiftId!,
                        }),
                    ]);

                    if (
                        reqQual.checksPerformed.includes('qualification') ||
                        offQual.checksPerformed.includes('qualification')
                    ) {
                        // Map qualification violation types to constraint IDs
                        const QUAL_FILTERS: Record<string, (v: any) => boolean> = {
                            ROLE_CONTRACT_MATCH: v => v.type === 'ROLE_MISMATCH',
                            QUALIFICATION_MATCH: v => v.type === 'SKILL_MISSING' || v.type === 'LICENSE_MISSING',
                            QUALIFICATION_EXPIRY: v => v.type === 'SKILL_EXPIRED'  || v.type === 'LICENSE_EXPIRED',
                        };
                        const QUAL_NAMES: Record<string, string> = {
                            ROLE_CONTRACT_MATCH: 'Role Contract Match',
                            QUALIFICATION_MATCH: 'Qualification & Certification',
                            QUALIFICATION_EXPIRY: 'Qualification Expiry',
                        };

                        const extraResults: ConstraintViolation[] = [];

                        for (const [cid, filter] of Object.entries(QUAL_FILTERS)) {
                            const reqV = reqQual.qualificationViolations.filter(filter);
                            const offV = offQual.qualificationViolations.filter(filter);

                            extraResults.push({
                                constraint_id:   cid,
                                constraint_name: QUAL_NAMES[cid],
                                employee_id:     requesterEmployeeId,
                                employee_name:   requesterName,
                                status:          reqV.length > 0 ? 'fail' : 'pass',
                                summary:         reqV.length > 0 ? `${reqV.length} issue(s) found` : 'All qualifications met',
                                details:         reqV.length > 0 ? reqV.map((v: any) => v.message).join('\n') : 'Employee meets all role and qualification requirements.',
                                calculation:     {},
                                blocking:        true,
                            });
                            extraResults.push({
                                constraint_id:   cid,
                                constraint_name: QUAL_NAMES[cid],
                                employee_id:     offererEmployeeId,
                                employee_name:   offererName,
                                status:          offV.length > 0 ? 'fail' : 'pass',
                                summary:         offV.length > 0 ? `${offV.length} issue(s) found` : 'All qualifications met',
                                details:         offV.length > 0 ? offV.map((v: any) => v.message).join('\n') : 'Employee meets all role and qualification requirements.',
                                calculation:     {},
                                blocking:        true,
                            });
                        }

                        const newAllResults  = [...result.all_results, ...extraResults];
                        const newViolations  = [...result.violations,  ...extraResults.filter(r => r.status === 'fail')];
                        const newFeasible    = newViolations.filter(v => v.blocking).length === 0;

                        finalResult = {
                            ...result,
                            feasible:    newFeasible,
                            violations:  newViolations,
                            all_results: newAllResults,
                        };
                    }
                } catch {
                    // Server unavailable — keep constraint-solver result as best-effort
                }
            }

            setSolverResult(finalResult);
            setPhase('results');
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to run compliance checks.');
            setPhase('error');
        }
    }, [requesterEmployeeId, requesterShiftId, offererEmployeeId, offererShiftId, requesterName, offererName]);

    // Auto-run when modal opens
    useEffect(() => {
        if (isOpen) {
            runChecks();
        }
    }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reset when closed
    useEffect(() => {
        if (!isOpen) {
            setPhase('loading');
            setSolverResult(null);
            setErrorMsg(null);
            setIsApproving(false);
        }
    }, [isOpen]);

    // -------------------------------------------------------------------------
    // Per-constraint breakdown
    // -------------------------------------------------------------------------
    const constraintRows = (() => {
        if (!solverResult) return [];

        // Group all_results by constraint_id
        const map = new Map<string, { name: string; req?: ConstraintViolation; off?: ConstraintViolation }>();
        for (const r of solverResult.all_results) {
            if (!map.has(r.constraint_id)) {
                map.set(r.constraint_id, { name: r.constraint_name });
            }
            const entry = map.get(r.constraint_id)!;
            if (r.employee_id === requesterEmployeeId) entry.req = r;
            else entry.off = r;
        }
        return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
    })();

    const blockingViolations = solverResult?.violations.filter(v => v.blocking) ?? [];
    const canApprove = phase === 'results' && solverResult?.feasible === true;

    // -------------------------------------------------------------------------
    // Handlers
    // -------------------------------------------------------------------------
    const handleApprove = async () => {
        setIsApproving(true);
        try {
            await onApprove();
        } finally {
            setIsApproving(false);
        }
    };

    if (!isOpen) return null;

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <motion.div
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.92, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-[2.5rem] border border-border shadow-2xl overflow-hidden bg-card"
            >
                {/* Top accent stripe */}
                <div className={cn(
                    'h-1.5 flex-shrink-0',
                    phase === 'loading' ? 'bg-primary/30' :
                    phase === 'error'   ? 'bg-rose-500' :
                    canApprove ? 'bg-emerald-500' : 'bg-rose-500'
                )} />

                {/* ── HEADER ── */}
                <div className="flex items-center justify-between px-8 pt-6 pb-4 flex-shrink-0 border-b border-border/50">
                    <div className="flex items-center gap-3">
                        <div className="h-11 w-11 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                            <Shield className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-foreground tracking-tight">Compliance Review</h2>
                            <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-[0.2em] font-black">Manager Approval Gate</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-all"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* ── PARTIES SUMMARY ── */}
                <div className="flex items-center gap-4 px-8 py-4 flex-shrink-0 border-b border-border/30 bg-muted/20">
                    <div className="flex items-center gap-2.5">
                        <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-indigo-600 text-white text-[10px] font-black">
                                {getInitials(requesterName)}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <div className="text-[11px] font-black text-foreground">{requesterName}</div>
                            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider font-black">Requester</div>
                        </div>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                        <ArrowLeftRight className="h-4 w-4 text-primary/40" />
                    </div>
                    <div className="flex items-center gap-2.5">
                        <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-emerald-600 text-white text-[10px] font-black">
                                {getInitials(offererName)}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <div className="text-[11px] font-black text-foreground">{offererName}</div>
                            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider font-black">Offerer</div>
                        </div>
                    </div>
                </div>

                {/* ── BODY ── */}
                <div className="flex-1 overflow-y-auto px-8 py-5 space-y-3">

                    {/* LOADING */}
                    {phase === 'loading' && (
                        <div className="flex flex-col items-center justify-center py-16 gap-4">
                            <div className="relative">
                                <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                                    <Loader2 className="h-7 w-7 text-primary animate-spin" />
                                </div>
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-black text-foreground/70">Re-validating compliance...</p>
                                <p className="text-[11px] text-muted-foreground/50 font-mono mt-1">
                                    Fetching current rosters &amp; running all 8 constraints
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ERROR */}
                    {phase === 'error' && (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <div className="h-14 w-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                                <XCircle className="h-7 w-7 text-rose-500" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-black text-rose-400">Compliance Check Failed</p>
                                <p className="text-[11px] text-muted-foreground/60 font-mono mt-1 max-w-sm">{errorMsg}</p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={runChecks}
                                className="gap-2 text-[10px] font-black uppercase tracking-wider"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                Retry
                            </Button>
                        </div>
                    )}

                    {/* RESULTS */}
                    {phase === 'results' && solverResult && (
                        <>
                            {/* Overall verdict banner */}
                            <div className={cn(
                                'flex items-center gap-3 p-4 rounded-2xl border',
                                canApprove
                                    ? 'bg-emerald-500/10 border-emerald-500/20'
                                    : 'bg-rose-500/10 border-rose-500/20',
                            )}>
                                {canApprove
                                    ? <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                                    : <XCircle      className="h-5 w-5 text-rose-500 flex-shrink-0" />
                                }
                                <div className="flex-1 min-w-0">
                                    <p className={cn(
                                        'text-[13px] font-black',
                                        canApprove ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                    )}>
                                        {canApprove ? 'All constraints passed — safe to approve' : 'Compliance violations detected'}
                                    </p>
                                    {!canApprove && blockingViolations.length > 0 && (
                                        <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">
                                            {blockingViolations.length} blocking violation{blockingViolations.length > 1 ? 's' : ''} must be resolved before approval
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <Badge variant="outline" className="text-[9px] font-mono font-black">
                                        {solverResult.all_results.filter(r => r.status === 'pass').length}/{constraintRows.length * 2} checks passed
                                    </Badge>
                                </div>
                            </div>

                            {/* Per-constraint results */}
                            <div className="space-y-1.5">
                                <p className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-[0.2em] px-1 pb-1 font-black">
                                    Constraint Evaluation (tap to expand details)
                                </p>
                                {constraintRows.map(row => (
                                    <ConstraintRow
                                        key={row.id}
                                        constraintId={row.id}
                                        constraintName={row.name}
                                        requesterResult={row.req}
                                        offererResult={row.off}
                                        requesterName={requesterName}
                                        offererName={offererName}
                                    />
                                ))}
                            </div>

                            {/* Blocking violations summary */}
                            {blockingViolations.length > 0 && (
                                <div className="mt-2 p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 space-y-2">
                                    <p className="text-[10px] font-black text-rose-500 uppercase tracking-wider">
                                        Blocking Violations
                                    </p>
                                    {blockingViolations.map((v, i) => (
                                        <div key={i} className="flex items-start gap-2">
                                            <XCircle className="h-3.5 w-3.5 text-rose-500 flex-shrink-0 mt-0.5" />
                                            <p className="text-[11px] text-rose-400 leading-relaxed font-medium">
                                                <span className="font-black">[{v.employee_name}]</span> {v.summary}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* ── FOOTER ── */}
                <div className="flex items-center justify-between gap-3 px-8 py-5 flex-shrink-0 border-t border-border/50 bg-card/80">
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            onClick={onClose}
                            className="rounded-xl text-muted-foreground hover:bg-muted font-black uppercase tracking-widest text-[10px] h-9 px-4"
                        >
                            Cancel
                        </Button>
                        {phase === 'results' && (
                            <Button
                                variant="ghost"
                                onClick={runChecks}
                                className="rounded-xl text-muted-foreground/60 hover:bg-muted font-black uppercase tracking-widest text-[10px] h-9 px-4 gap-1.5"
                            >
                                <RefreshCw className="h-3 w-3" />
                                Re-run
                            </Button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            onClick={onReject}
                            disabled={isApproving}
                            className="rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-black uppercase tracking-wider h-9 px-4 gap-1.5"
                        >
                            <X className="h-3.5 w-3.5" />
                            Reject Instead
                        </Button>
                        <Button
                            onClick={handleApprove}
                            disabled={!canApprove || isApproving}
                            className={cn(
                                'rounded-xl text-[10px] font-black uppercase tracking-wider h-9 px-5 gap-1.5 border-none',
                                canApprove
                                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20'
                                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                            )}
                        >
                            {isApproving ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Approving...</>
                            ) : (
                                <><Check className="h-3.5 w-3.5" /><Gavel className="h-3.5 w-3.5" />Confirm Approval</>
                            )}
                        </Button>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}

export default ManagerComplianceApprovalModal;
