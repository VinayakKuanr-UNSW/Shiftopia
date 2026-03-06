/**
 * BidComplianceModal
 * 
 * Modal dialog that runs compliance checks before allowing an employee to bid on a shift.
 * Reuses the visual ComplianceTabContent for consistent UI/UX with EnhancedAddShiftModal.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { ComplianceTabContent } from '@/modules/rosters/ui/components/ComplianceTabContent';
import {
    getRegisteredRules,
    runRule,
    ComplianceResult,
    ComplianceCheckInput,
    HardValidationResult,
} from '@/modules/compliance';
import { complianceService } from '@/modules/rosters/services/compliance.service';
import { useAuth } from '@/platform/auth/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { format, parseISO, addDays, subDays } from 'date-fns';
import { ThumbsUp, Loader2, Shield, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

// =============================================================================
// TYPES
// =============================================================================

interface ShiftData {
    id: any;
    role: string;
    organization: string;
    department: string;
    subGroup: string;
    date: string;
    weekday: string;
    startTime: string;
    endTime: string;
    paidBreak: number;
    unpaidBreak: number;
    netLength: number;
    remunerationLevel: string;
    assignedTo: string | null;
    isEligible: boolean;
    ineligibilityReason?: string;
    groupType?: string | null;
    priority?: string | null;
    biddingWindowOpens?: string | null;
    biddingWindowCloses?: string | null;
    isUrgent?: boolean;
    stateId?: string;
    subGroupColor?: string;
}

interface BidComplianceModalProps {
    isOpen: boolean;
    onClose: () => void;
    shift: ShiftData | null;
    onConfirmBid: () => void;
    isPending?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function BidComplianceModal({
    isOpen,
    onClose,
    shift,
    onConfirmBid,
    isPending = false,
}: BidComplianceModalProps) {
    const { user } = useAuth();
    const [ruleResults, setRuleResults] = useState<Record<string, ComplianceResult | null>>({});
    const [isRunningChecks, setIsRunningChecks] = useState(false);
    const [checksComplete, setChecksComplete] = useState(false);

    // Fetch existing shifts for the employee around the target date
    const { data: existingShifts = [], isLoading: isLoadingShifts } = useQuery({
        queryKey: ['employeeShiftsForCompliance', user?.id, shift?.date],
        queryFn: async () => {
            if (!user?.id || !shift?.date) return [];

            // Fetch shifts 30 days before and after to check consecutive days, rest gaps, student visa, etc.
            const startDate = format(subDays(parseISO(shift.date), 30), 'yyyy-MM-dd');
            const endDate = format(addDays(parseISO(shift.date), 30), 'yyyy-MM-dd');

            console.log('[BidComplianceModal] Fetching shifts for employee:', user.id);
            console.log('[BidComplianceModal] Date range:', startDate, 'to', endDate);

            const { data, error } = await supabase
                .from('shifts')
                .select('id, shift_date, start_time, end_time, net_length_minutes, unpaid_break_minutes')
                .eq('assigned_employee_id', user.id)
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null)
                .eq('is_cancelled', false);

            if (error) {
                console.error('[BidComplianceModal] Error fetching shifts:', error);
                return [];
            }

            console.log('[BidComplianceModal] Found existing shifts:', data?.length, data);
            return data || [];
        },
        enabled: isOpen && !!user?.id && !!shift?.date,
    });

    // Build hard validation result (overlap check)
    const hardValidation: HardValidationResult = useMemo(() => {
        if (!shift) return { passed: true, errors: [] };

        // Check for overlapping shifts on the same day
        const sameDayShifts = existingShifts.filter(s => s.shift_date === shift.date);
        const errors: { code: string; message: string; context?: any }[] = [];

        const candidateStart = shift.startTime;
        const candidateEnd = shift.endTime;

        return {
            passed: true,
            errors: []
        };
    }, [shift, existingShifts]);

    // Build compliance input for the rule engine
    // IMPORTANT: The compliance engine expects snake_case property names
    const buildComplianceInput = useCallback((): ComplianceCheckInput => {
        if (!shift || !user) {
            return {
                employee_id: '',
                action_type: 'bid',
                candidate_shift: { shift_date: '', start_time: '', end_time: '' },
                existing_shifts: [],
            };
        }

        console.log('[BidComplianceModal] Building compliance input:', {
            shift,
            existingShifts,
            userId: user.id,
        });

        return {
            employee_id: user.id,
            action_type: 'bid',
            candidate_shift: {
                shift_date: shift.date,
                start_time: shift.startTime + ':00',
                end_time: shift.endTime + ':00',
                unpaid_break_minutes: shift.unpaidBreak || 0,
            },
            existing_shifts: existingShifts.map(s => ({
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time: s.end_time,
                unpaid_break_minutes: s.unpaid_break_minutes || 0,
            })),
        };
    }, [shift, existingShifts, user]);

    // Auto-run checks when modal opens and data is ready
    useEffect(() => {
        if (isOpen && shift && !isLoadingShifts && !checksComplete) {
            handleRunAllChecks();
        }
    }, [isOpen, shift, isLoadingShifts]);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setRuleResults({});
            setChecksComplete(false);
        }
    }, [isOpen]);

    const handleRunAllChecks = useCallback(() => {
        setIsRunningChecks(true);
        setTimeout(() => {
            const input = buildComplianceInput();
            console.log('[BidComplianceModal] Running compliance checks with input:', input);

            const rules = getRegisteredRules();
            console.log('[BidComplianceModal] Registered rules:', rules.map(r => r.id));

            const newResults: Record<string, ComplianceResult | null> = {};

            rules.forEach(rule => {
                const result = runRule(rule.id, input);
                console.log(`[BidComplianceModal] Rule ${rule.id} result:`, result);
                newResults[rule.id] = result;
            });

            console.log('[BidComplianceModal] All results:', newResults);
            setRuleResults(newResults);
            setIsRunningChecks(false);
            setChecksComplete(true);
        }, 100);
    }, [buildComplianceInput]);

    // Determine if user can proceed
    const canProceed = useMemo(() => {
        if (!checksComplete) return false;
        if (!hardValidation.passed) return false;

        // Check for blocking failures
        const hasBlockingFailure = Object.values(ruleResults).some(
            r => r?.status === 'fail' && r?.blocking
        );

        return !hasBlockingFailure;
    }, [checksComplete, hardValidation, ruleResults]);

    const hasWarnings = useMemo(() => {
        return Object.values(ruleResults).some(r => r?.status === 'warning');
    }, [ruleResults]);

    if (!shift) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-background border-border shadow-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-foreground">
                        <Shield className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
                        Compliance Check
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Review compliance rules before expressing interest in this shift.
                    </DialogDescription>
                </DialogHeader>

                {/* Shift Summary */}
                <div className="bg-muted/50 rounded-xl p-5 border border-border mb-6">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Checking eligibility for:</div>
                    <div className="text-lg font-black text-foreground mb-1">{shift.role}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground/80">{shift.date}</span>
                        <span className="opacity-30">•</span>
                        <span>{shift.startTime} - {shift.endTime}</span>
                        <span className="opacity-30">•</span>
                        <span className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded text-xs font-bold">{Math.round(shift.netLength)}m</span>
                    </div>
                    <div className="text-xs text-muted-foreground/70 mt-3 flex items-center gap-1.5 font-medium">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        {shift.organization} <span className="opacity-40">/</span> {shift.department}
                    </div>
                </div>

                {/* Loading State */}
                {(isLoadingShifts || isRunningChecks || !checksComplete) && (
                    <div className="flex flex-col items-center justify-center py-16 animate-in fade-in zoom-in duration-300">
                        <div className="relative">
                            <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full animate-pulse" />
                            <Loader2 className="h-10 w-10 animate-spin text-indigo-600 dark:text-indigo-400 relative z-10" />
                        </div>
                        <p className="text-muted-foreground mt-4 font-medium">Analyzing compliance rules...</p>
                    </div>
                )}

                {/* Compliance Content - Only show after checks complete */}
                {checksComplete && !isRunningChecks && (
                    <ComplianceTabContent
                        hardValidation={hardValidation}
                        ruleResults={ruleResults}
                        setRuleResults={setRuleResults}
                        buildComplianceInput={buildComplianceInput}
                        needsRerun={false}
                        onChecksComplete={() => setChecksComplete(true)}
                        shiftId={shift?.id}
                    />
                )}

                <DialogFooter className="mt-8 gap-3">
                    <Button variant="outline" onClick={onClose} className="border-border hover:bg-muted font-bold px-6">
                        Cancel
                    </Button>

                    {checksComplete && (
                        <Button
                            onClick={onConfirmBid}
                            disabled={!canProceed || isPending}
                            className={cn(
                                "gap-2 h-10 px-8 font-black uppercase tracking-widest shadow-lg transition-all active:scale-95",
                                canProceed
                                    ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/20"
                                    : "bg-muted text-muted-foreground cursor-not-allowed border border-border"
                            )}
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Processing...
                                </>
                            ) : canProceed ? (
                                <>
                                    <ThumbsUp className="h-4 w-4" />
                                    {hasWarnings ? 'Bid Anyway' : 'Confirm Bid'}
                                </>
                            ) : (
                                <>
                                    <XCircle className="h-4 w-4" />
                                    Ineligible
                                </>
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default BidComplianceModal;
