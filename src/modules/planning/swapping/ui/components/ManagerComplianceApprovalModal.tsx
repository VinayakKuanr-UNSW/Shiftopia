import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import {
    Shield,
    ArrowLeftRight,
    Loader2,
    RefreshCw,
    Gavel,
    X,
    Check,
    Play,
    MessageSquareX
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { supabase } from '@/platform/realtime/client';
import { getScenarioWindow } from '@/modules/compliance';
import { fetchEmployeeContextV2 } from '@/modules/compliance/employee-context';
import type { ComplianceInputV2, ShiftV2 } from '@/modules/compliance/v2/types';
import { motion, AnimatePresence } from 'framer-motion';
import { Drawer, DrawerContent } from '@/modules/core/ui/primitives/drawer';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { useCompliancePanel } from '@/modules/compliance/ui/useCompliancePanel';
import { CompliancePanel } from '@/modules/compliance/ui/CompliancePanel';

// =============================================================================
// TYPES
// =============================================================================

interface ShiftRow {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes?: number;
    role_id?: string | null;
    organization_id?: string | null;
    department_id?: string | null;
    sub_department_id?: string | null;
}

interface RosterShiftInput {
    id?: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes?: number;
    role_id?: string | null;
    organization_id?: string | null;
    department_id?: string | null;
    sub_department_id?: string | null;
}

export interface ManagerComplianceApprovalModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Called when manager confirms approval (after compliance passes) */
    onApprove: () => Promise<void>;
    /** Called when manager confirms rejection (with optional reason) */
    onReject: (reason?: string) => void;

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

/** Normalize HH:mm:ss → HH:mm for v2 engine */
function normalizeTime(t: string): string {
    return (t || '00:00').replace(/:\d{2}$/, '');
}

/** Map a RosterShiftInput to the ShiftV2 structure the v2 engine expects */
function buildShiftV2(s: RosterShiftInput, fallbackId?: string): ShiftV2 {
    return {
        shift_id:             (s as any).id || fallbackId || String(Math.random()),
        shift_date:           s.shift_date,
        start_time:           normalizeTime(s.start_time),
        end_time:             normalizeTime(s.end_time),
        role_id:              s.role_id || '',
        organization_id:      s.organization_id ?? undefined,
        department_id:        s.department_id ?? undefined,
        sub_department_id:    s.sub_department_id ?? undefined,
        required_qualifications: [],
        is_ordinary_hours:    true,
        break_minutes:        s.unpaid_break_minutes || 0,
        unpaid_break_minutes: s.unpaid_break_minutes || 0,
    };
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
    const [isApproving, setIsApproving] = useState(false);
    const [isRejectingState, setIsRejectingState] = useState(false);
    const [rejectReason, setRejectReason] = useState('');

    // -------------------------------------------------------------------------
    // Build inputs for useCompliancePanel
    // -------------------------------------------------------------------------
    const buildInputs = useCallback(async (): Promise<[ComplianceInputV2, ComplianceInputV2]> => {
        if (!requesterEmployeeId || !requesterShiftId) {
            throw new Error('Missing requester employee or shift ID.');
        }

        // 1. Fetch both shifts
        const shiftIds = [requesterShiftId, offererShiftId].filter(Boolean) as string[];
        const { data: shiftRows, error: shiftErr } = await supabase
            .from('shifts')
            .select('id, shift_date, start_time, end_time, unpaid_break_minutes, role_id, organization_id, department_id, sub_department_id')
            .in('id', shiftIds);

        if (shiftErr) throw shiftErr;

        const requesterShiftData = (shiftRows || []).find((s: ShiftRow) => s.id === requesterShiftId);
        const offererShiftData   = offererShiftId
            ? (shiftRows || []).find((s: ShiftRow) => s.id === offererShiftId)
            : null;

        if (!requesterShiftData) throw new Error('Requester shift not found.');

        // 2. Fetch rosters ±28 days around the requester's shift date
        const { start: startDate, end: endDate } = getScenarioWindow(requesterShiftData.shift_date);

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

        // 3. Fetch real employee contexts (contracts, qualifications, visa status)
        const [requesterCtx, offererCtx] = await Promise.all([
            fetchEmployeeContextV2(requesterEmployeeId),
            offererEmployeeId
                ? fetchEmployeeContextV2(offererEmployeeId)
                : Promise.resolve(null),
        ]);

        // 4. Build v2 inputs for each party
        //    Requester: remove their shift, add the offerer's shift (they receive it)
        const inputA: ComplianceInputV2 = {
            employee_id:      requesterEmployeeId,
            employee_context: requesterCtx,
            existing_shifts:  requesterRoster.map(s => buildShiftV2(s)),
            candidate_changes: {
                add_shifts:    offererShiftData ? [buildShiftV2(offererShiftData)] : [],
                remove_shifts: [requesterShiftId],
            },
            mode:           'SIMULATED',
            operation_type: 'SWAP',
            stage:          'PUBLISH',
        };

        //    Offerer: remove their shift, add the requester's shift (they receive it)
        const inputB: ComplianceInputV2 = {
            employee_id:      offererEmployeeId || '',
            employee_context: offererCtx ?? {
                employee_id:             '',
                contract_type:           'CASUAL',
                contracted_weekly_hours: 0,
                assigned_role_ids:       [],
                contracts:               [],
                qualifications:          [],
            },
            existing_shifts:  offererRoster.map(s => buildShiftV2(s)),
            candidate_changes: {
                add_shifts:    requesterShiftData ? [buildShiftV2(requesterShiftData)] : [],
                remove_shifts: offererShiftId ? [offererShiftId] : [],
            },
            mode:           'SIMULATED',
            operation_type: 'SWAP',
            stage:          'PUBLISH',
        };

        return [inputA, inputB];
    }, [
        requesterEmployeeId,
        requesterShiftId,
        offererEmployeeId,
        offererShiftId,
    ]);

    // -------------------------------------------------------------------------
    // Shared compliance panel — single engine, no duplicate rule logic
    // -------------------------------------------------------------------------
    const panel = useCompliancePanel({ buildInputs });

    const canApprove = panel.canProceed;

    // -------------------------------------------------------------------------
    // Reset panel when modal closes
    // -------------------------------------------------------------------------
    useEffect(() => {
        if (!isOpen) {
            panel.reset();
            setIsRejectingState(false);
            setRejectReason('');
        }
    }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const handleConfirmReject = () => {
        onReject(rejectReason || 'Manager Rejected');
    };

    const isMobile = useIsMobile();

    if (!isOpen) return null;

    // -------------------------------------------------------------------------
    // Inner content shared between mobile Drawer and desktop overlay
    // -------------------------------------------------------------------------
    const innerContent = (
        <div className="flex flex-col h-full bg-background relative overflow-hidden">
            {/* Ambient Base Glow */}
            <div className="absolute top-0 right-1/4 w-64 h-64 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

            {/* ── HEADER ── */}
            <div className="flex flex-col px-6 pt-6 pb-4 flex-shrink-0 z-10">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1.5">
                            <Shield className="h-4 w-4 text-primary" />
                            <h2 className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-[0.3em] font-black">
                                Compliance Gate
                            </h2>
                        </div>
                        <h1 className="text-2xl font-black text-foreground tracking-tighter">
                            Swap Approval Review
                        </h1>
                    </div>
                    <button
                        onClick={onClose}
                        className="h-10 w-10 shrink-0 rounded-2xl flex items-center justify-center bg-muted/30 text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 transition-colors border border-border/50"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* ── PARTIES SUMMARY (HIGH FIDELITY) ── */}
            <div className="px-6 pb-5 flex-shrink-0 z-10">
                <div className="relative flex items-center p-4 rounded-[1.5rem] bg-gradient-to-b from-muted/30 to-muted/10 border border-border/50 shadow-sm overflow-hidden">
                    {/* Background decoration */}
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.02]" />
                    <div className="flex-1 flex justify-center flex-col items-center gap-2">
                        <Avatar className="h-12 w-12 border-2 border-indigo-500/20 shadow-xl shadow-indigo-500/10">
                            <AvatarFallback className="bg-indigo-600 text-white text-[12px] font-black">
                                {getInitials(requesterName)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="text-center">
                            <div className="text-[11px] font-black text-foreground tracking-tight">{requesterName}</div>
                            <div className="text-[9px] text-muted-foreground/60 uppercase tracking-[0.2em] font-black mt-0.5">Requester</div>
                        </div>
                    </div>

                    <div className="h-8 w-px bg-border/50 mx-2" />
                    <div className="h-8 w-8 shrink-0 rounded-full bg-background border border-border/50 flex items-center justify-center -ml-4 -mr-4 z-10 shadow-sm">
                        <ArrowLeftRight className="h-3 w-3 text-muted-foreground/40" />
                    </div>
                    <div className="h-8 w-px bg-border/50 mx-2" />

                    <div className="flex-1 flex justify-center flex-col items-center gap-2">
                        <Avatar className="h-12 w-12 border-2 border-emerald-500/20 shadow-xl shadow-emerald-500/10">
                            <AvatarFallback className="bg-emerald-600 text-white text-[12px] font-black">
                                {getInitials(offererName)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="text-center">
                            <div className="text-[11px] font-black text-foreground tracking-tight">{offererName}</div>
                            <div className="text-[9px] text-muted-foreground/60 uppercase tracking-[0.2em] font-black mt-0.5">Offerer</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── BODY (Scrollable) ── */}
            <div className="flex-1 overflow-y-auto px-6 pb-32 z-10 scrollbar-none relative">
                <AnimatePresence mode="wait">
                    {isRejectingState ? (
                        <motion.div
                            key="rejecting-view"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-5"
                        >
                            <div className="flex items-center gap-2 mb-4">
                                <MessageSquareX className="h-5 w-5 text-rose-500" />
                                <h3 className="text-[13px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-widest">
                                    Reject Swap
                                </h3>
                            </div>
                            <p className="text-[11px] text-muted-foreground/80 mb-3 font-medium leading-relaxed">
                                Please provide a reason for rejecting this swap. This will be visible to the employees.
                            </p>
                            <textarea
                                className="lovable-input w-full min-h-[120px] text-sm resize-none"
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="E.g. Not enough coverage during this shift..."
                                autoFocus
                            />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="compliance-view"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                        >
                            <CompliancePanel
                                hook={panel}
                                partyAName={requesterName}
                                partyBName={offererName}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── STICKY FOOTER ACTION BAR ── */}
            <div className="absolute bottom-0 left-0 right-0 z-20">
                {/* Gradient fade to show scrollability */}
                <div className="h-12 bg-gradient-to-t from-background to-transparent w-full pointer-events-none" />
                
                <div className="bg-card/90 backdrop-blur-xl border-t border-border p-4 md:p-6 pb-safe">
                    <AnimatePresence mode="wait">
                        {isRejectingState ? (
                            <motion.div
                                key="reject-actions"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 20 }}
                                className="flex flex-col gap-3"
                            >
                                <Button
                                    onClick={handleConfirmReject}
                                    disabled={!rejectReason.trim() || isApproving}
                                    className="w-full min-h-[56px] rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black uppercase tracking-[0.1em] text-xs shadow-xl shadow-rose-500/20 disabled:opacity-50"
                                >
                                    Confirm Rejection
                                </Button>
                                <Button
                                    variant="ghost"
                                    onClick={() => setIsRejectingState(false)}
                                    className="w-full min-h-[48px] rounded-xl text-muted-foreground hover:bg-muted font-bold text-[11px] uppercase tracking-widest"
                                >
                                    Cancel
                                </Button>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="main-actions"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 20 }}
                                className="flex flex-col sm:flex-row items-center justify-between gap-3"
                            >
                                <div className="w-full sm:w-auto">
                                    <Button
                                        onClick={() => setIsRejectingState(true)}
                                        disabled={isApproving}
                                        className="w-full sm:w-auto min-h-[48px] rounded-xl bg-transparent hover:bg-rose-500/10 text-rose-500 border border-border/50 text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                        Reject Instead
                                    </Button>
                                </div>

                                <div className="w-full sm:w-auto flex-1 max-w-[400px]">
                                    {panel.status === 'idle' || panel.status === 'running' || panel.status === 'stale' ? (
                                        <Button
                                            onClick={() => panel.run()}
                                            disabled={panel.status === 'running'}
                                            className="w-full min-h-[56px] rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-[0.1em] text-xs shadow-xl shadow-indigo-500/20 w-full"
                                        >
                                            {panel.status === 'running' ? (
                                                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying Rules...</>
                                            ) : (
                                                <><Play className="h-4 w-4 mr-2 fill-current" /> Initialize Compliance</>
                                            )}
                                        </Button>
                                    ) : (
                                        <Button
                                            onClick={handleApprove}
                                            disabled={!canApprove || isApproving}
                                            className={cn(
                                                "w-full min-h-[56px] rounded-2xl font-black uppercase tracking-[0.1em] text-xs shadow-xl flex items-center justify-center gap-2 transition-all",
                                                canApprove
                                                    ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/20'
                                                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed shadow-none',
                                            )}
                                        >
                                            {isApproving ? (
                                                <><Loader2 className="h-4 w-4 animate-spin" /> Finalizing...</>
                                            ) : canApprove ? (
                                                <><Check className="h-4 w-4" /> <Gavel className="h-5 w-5 ml-1" /> Approve Swap</>
                                            ) : (
                                                <><Shield className="h-4 w-4" /> Compliance Failed</>
                                            )}
                                        </Button>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------
    if (isMobile) {
        return (
            <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <DrawerContent className="h-[92dvh] bg-card border-border p-0 overflow-hidden flex flex-col rounded-t-[2.5rem]">
                    {innerContent}
                </DrawerContent>
            </Drawer>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="relative w-full max-w-2xl h-[85vh] flex flex-col rounded-[2.5rem] border border-border shadow-2xl overflow-hidden bg-background"
            >
                {innerContent}
            </motion.div>
        </motion.div>
    );
}

export default ManagerComplianceApprovalModal;
