/**
 * ManagerComplianceApprovalModal
 *
 * Opens when a manager clicks "Approve" on a single MANAGER_PENDING swap.
 * Runs the v2 compliance engine (evaluateCompliance) against both parties'
 * CURRENT rosters — catching any schedule drift since the original offer
 * was accepted.
 *
 * Flow:
 *   1. Manager clicks "Run Compliance" (no auto-run on open)
 *   2. Fetch both shifts from DB
 *   3. Fetch both rosters (±28 days)
 *   4. Build v2 ComplianceInputV2 for each party
 *   5. useCompliancePanel evaluates both and classifies hits into A/B/C/D buckets
 *   6. CompliancePanel renders results — deterministic and explainable
 *   7. Block approval if panel.canProceed is false
 */

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
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { supabase } from '@/platform/realtime/client';
import { getScenarioWindow } from '@/modules/compliance';
import { fetchEmployeeContextV2 } from '@/modules/compliance/employee-context';
import type { ComplianceInputV2, ShiftV2 } from '@/modules/compliance/v2/types';
import { motion } from 'framer-motion';
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
        if (!isOpen) panel.reset();
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
                    panel.status === 'idle'    ? 'bg-primary/20' :
                    panel.status === 'running' ? 'bg-primary/30' :
                    panel.status === 'error'   ? 'bg-rose-500' :
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
                <div className="flex-1 overflow-y-auto p-6">
                    <CompliancePanel 
                        hook={panel} 
                        partyAName={requesterName}
                        partyBName={offererName}
                    />
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
                        {panel.status !== 'idle' && panel.status !== 'running' && (
                            <Button
                                variant="ghost"
                                onClick={() => panel.run()}
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
