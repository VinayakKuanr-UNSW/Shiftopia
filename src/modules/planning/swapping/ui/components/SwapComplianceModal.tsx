/**
 * SwapComplianceModal
 * 
 * Modal dialog that runs compliance checks before allowing an employee to offer a swap.
 * Checks if the REQUESTER (the person who posted the swap) can legally take the OFFERED shift.
 * Reuses the visual ComplianceTabContent for consistent UI/UX.
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
    HardValidationError,
    ShiftTimeRange,
} from '@/modules/compliance';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { format, parseISO, addDays, subDays } from 'date-fns';
import { Loader2, Shield, ArrowRightLeft, Play, Send } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

// =============================================================================
// TYPES
// =============================================================================

interface ShiftData {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes?: number;
    role_name?: string;
    department_name?: string;
}

interface SwapComplianceModalProps {
    isOpen: boolean;
    onClose: () => void;
    // The shift we are OFFERING (our shift)
    offeredShift: ShiftData | null;
    // The requester's original shift (the one they are swapping OUT)
    requesterShift: ShiftData | null;
    // The requester's profile ID (who we are checking compliance for)
    requesterId: string | null;
    requesterName: string;
    // The offerer's profile ID (YOU)
    offererId: string | null;
    offererName: string;
    // Callback when user confirms the offer
    onConfirmOffer: () => void;
    isSubmitting?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function SwapComplianceModal({
    isOpen,
    onClose,
    offeredShift,
    requesterShift,
    requesterId,
    requesterName,
    offererId,
    offererName,
    onConfirmOffer,
    isSubmitting = false,
}: SwapComplianceModalProps) {
    const [ruleResults, setRuleResults] = useState<Record<string, ComplianceResult | null>>({});
    const [isRunningChecks, setIsRunningChecks] = useState(false);
    const [checksComplete, setChecksComplete] = useState(false);

    // Fetch existing shifts for the REQUESTER (they take YOUR shift)
    const { data: requesterRoster = [], isLoading: isLoadingRequester } = useQuery({
        queryKey: ['requesterRosterForSwapCompliance', requesterId, offeredShift?.shift_date],
        queryFn: async () => {
            if (!requesterId || !offeredShift?.shift_date) return [];

            const startDate = format(subDays(parseISO(offeredShift.shift_date), 30), 'yyyy-MM-dd');
            const endDate = format(addDays(parseISO(offeredShift.shift_date), 30), 'yyyy-MM-dd');

            console.log('[SwapComplianceModal] Fetching roster for requester:', requesterId);

            const { data, error } = await supabase
                .from('shifts')
                .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
                .eq('assigned_employee_id', requesterId)
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null)
                .is('is_cancelled', false);

            if (error) {
                console.error('[SwapComplianceModal] Error fetching requester roster:', error);
                return [];
            }
            return data || [];
        },
        enabled: isOpen && !!requesterId && !!offeredShift?.shift_date,
    });

    // Fetch existing shifts for the OFFERER (YOU take THEIR shift)
    const { data: offererRoster = [], isLoading: isLoadingOfferer } = useQuery({
        queryKey: ['offererRosterForSwapCompliance', offererId, requesterShift?.shift_date],
        queryFn: async () => {
            if (!offererId || !requesterShift?.shift_date) return [];

            const startDate = format(subDays(parseISO(requesterShift.shift_date), 30), 'yyyy-MM-dd');
            const endDate = format(addDays(parseISO(requesterShift.shift_date), 30), 'yyyy-MM-dd');

            console.log('[SwapComplianceModal] Fetching roster for offerer:', offererId);

            const { data, error } = await supabase
                .from('shifts')
                .select('id, shift_date, start_time, end_time, unpaid_break_minutes')
                .eq('assigned_employee_id', offererId)
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null)
                .is('is_cancelled', false);

            if (error) {
                console.error('[SwapComplianceModal] Error fetching offerer roster:', error);
                return [];
            }
            return data || [];
        },
        enabled: isOpen && !!offererId && !!requesterShift?.shift_date,
    });

    const isLoading = isLoadingRequester || isLoadingOfferer;

    // Filter out the shift REQUESTER is swapping away (requesterShift) if it exists in their roster
    const filteredRequesterRoster = useMemo(() => {
        if (!requesterShift?.id) return requesterRoster;
        return requesterRoster.filter(s => s.id !== requesterShift.id);
    }, [requesterRoster, requesterShift?.id]);

    // Filter out the shift OFFERER is swapping away (offeredShift) if it exists in their roster
    const filteredOffererRoster = useMemo(() => {
        if (!offeredShift?.id) return offererRoster;
        return offererRoster.filter(s => s.id !== offeredShift.id);
    }, [offererRoster, offeredShift?.id]);

    // Build hard validation result (overlap check) - TWO WAY CHECK
    const hardValidation: HardValidationResult = useMemo(() => {
        const errors: HardValidationError[] = [];

        // CHECK 1: REQUESTER takes OFFERED shift
        if (offeredShift) {
            const sameDayShifts = filteredRequesterRoster.filter(s => s.shift_date === offeredShift.shift_date);
            const candidateStart = offeredShift.start_time.slice(0, 5);
            const candidateEnd = offeredShift.end_time.slice(0, 5);

            for (const existing of sameDayShifts) {
                const existingStart = existing.start_time.slice(0, 5);
                const existingEnd = existing.end_time.slice(0, 5);

                if (candidateStart < existingEnd && candidateEnd > existingStart) {
                    errors.push({
                        field: 'time',
                        rule: 'OVERLAP',
                        message: `[${requesterName}] Overlap with existing shift (${existingStart} - ${existingEnd})`
                    });
                }
            }
        }

        // CHECK 2: OFFERER takes REQUESTER shift
        if (requesterShift) {
            const sameDayShifts = filteredOffererRoster.filter(s => s.shift_date === requesterShift.shift_date);
            const candidateStart = requesterShift.start_time.slice(0, 5);
            const candidateEnd = requesterShift.end_time.slice(0, 5);

            for (const existing of sameDayShifts) {
                const existingStart = existing.start_time.slice(0, 5);
                const existingEnd = existing.end_time.slice(0, 5);

                if (candidateStart < existingEnd && candidateEnd > existingStart) {
                    errors.push({
                        field: 'time',
                        rule: 'OVERLAP',
                        message: `[${offererName}] Overlap with existing shift (${existingStart} - ${existingEnd})`
                    });
                }
            }
        }

        return {
            passed: errors.length === 0,
            errors,
        };
    }, [offeredShift, requesterShift, filteredRequesterRoster, filteredOffererRoster, requesterName, offererName]);

    // Build compliance input for the rule engine - HELPER
    // We need to support building input for BOTH parties
    const buildComplianceInput = useCallback((
        targetEmployeeId: string,
        candidateShift: ShiftData,
        roster: any[]
    ): ComplianceCheckInput => {
        return {
            employee_id: targetEmployeeId,
            action_type: 'swap',
            candidate_shift: {
                shift_date: candidateShift.shift_date,
                start_time: candidateShift.start_time,
                end_time: candidateShift.end_time,
                unpaid_break_minutes: candidateShift.unpaid_break_minutes || 0,
            },
            existing_shifts: roster.map(s => ({
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time: s.end_time,
                unpaid_break_minutes: s.unpaid_break_minutes || 0,
            })),
        };
    }, []);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setRuleResults({});
            setChecksComplete(false);
        }
    }, [isOpen]);

    const handleRunAllChecks = useCallback(() => {
        if (!offeredShift || !requesterShift || !requesterId || !offererId) return;

        setIsRunningChecks(true);
        setTimeout(() => {
            const rules = getRegisteredRules();
            const newResults: Record<string, ComplianceResult | null> = {};

            // 1. Check REQUESTER taking OFFERED SHIFT
            const inputRequester = buildComplianceInput(requesterId, offeredShift, filteredRequesterRoster);
            rules.forEach(rule => {
                const result = runRule(rule.id, inputRequester);
                // Prefix ID to separate them but keep standard format for display
                // Actually, ComplianceTabContent expects rule IDs.
                // We need to merge results. If EITHER fails, the rule fails.
                // We will append messages with names.
                newResults[rule.id] = result;
            });

            // 2. Check OFFERER taking REQUESTER SHIFT
            const inputOfferer = buildComplianceInput(offererId, requesterShift, filteredOffererRoster);
            rules.forEach(rule => {
                const result = runRule(rule.id, inputOfferer);
                const existingResult = newResults[rule.id];

                if (!existingResult) {
                    newResults[rule.id] = result;
                    return;
                }

                // If Offerer fails, we need to show failure
                if (result.status === 'fail' || result.status === 'warning') {
                    // Update the existing result to include this failure
                    if (existingResult.status === 'pass') {
                        // Inherit failure
                        newResults[rule.id] = {
                            ...result,
                            details: `[${offererName} (You)] ${result.details}`,
                            summary: `[${offererName} (You)] ${result.summary}`
                        };
                    } else {
                        // Both failed? Combine messages
                        newResults[rule.id] = {
                            ...existingResult,
                            status: 'fail', // Worst case
                            details: `[${requesterName}] ${existingResult.details} | [${offererName} (You)] ${result.details}`,
                            summary: `[${requesterName}] ${existingResult.summary} | [${offererName} (You)] ${result.summary}`
                        };
                    }
                } else {
                    // Offerer passed. If Requester failed, keep Requester failure.
                    // If Requester passed, rename message to show both checks passed?
                    // Optional: just keep Requester's "Passed" message or generic "All checks passed"
                    if (existingResult.status === 'pass') {
                        // Both passed
                        newResults[rule.id] = {
                            ...existingResult,
                            details: "Checks passed for both employees",
                            summary: "Checks passed for both employees"
                        };
                    } else {
                        // Requester failed, Offerer passed. Keep Requester msg but tag it
                        newResults[rule.id] = {
                            ...existingResult,
                            details: `[${requesterName}] ${existingResult.details}`,
                            summary: `[${requesterName}] ${existingResult.summary}`
                        };
                    }
                }
            });

            console.log('[SwapComplianceModal] Combined results:', newResults);
            setRuleResults(newResults);
            setIsRunningChecks(false);
            setChecksComplete(true);
        }, 100);
    }, [buildComplianceInput, offeredShift, requesterShift, requesterId, offererId, filteredRequesterRoster, filteredOffererRoster, requesterName, offererName]);

    // Analyze failures for better UI feedback
    const failureAnalysis = useMemo(() => {
        if (!checksComplete) return null;

        const failures = Object.values(ruleResults || {}).filter(r => r?.status === 'fail');
        if (failures.length === 0) return null;

        const myFailures = failures.filter(f => f?.summary.includes(`[${offererName}`));
        const theirFailures = failures.filter(f => f?.summary.includes(`[${requesterName}]`));

        if (myFailures.length > 0 && theirFailures.length > 0) return 'BOTH_FAILED';
        if (myFailures.length > 0) return 'YOU_FAILED';
        if (theirFailures.length > 0) return 'THEY_FAILED';

        return 'UNKNOWN_FAILURE';
    }, [ruleResults, checksComplete, offererName, requesterName]);

    // Determine if user can proceed
    const canProceed = useMemo(() => {
        if (!checksComplete) return false;
        if (!hardValidation.passed) return false;

        const hasBlockingFailure = Object.values(ruleResults).some(
            r => r?.status === 'fail' && r?.blocking
        );

        return !hasBlockingFailure;
    }, [checksComplete, hardValidation, ruleResults]);

    const hasWarnings = useMemo(() => {
        return Object.values(ruleResults).some(r => r?.status === 'warning');
    }, [ruleResults]);

    if (!offeredShift) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-slate-900 border-white/10">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-white">
                        <Shield className="h-5 w-5 text-purple-400" />
                        Swap Compliance Check (2-Way)
                    </DialogTitle>
                    <DialogDescription className="text-white/50">
                        Verifying compliance for both {requesterName} and {offererName}.
                    </DialogDescription>
                </DialogHeader>

                {/* Swap Summary */}
                <div className="bg-white/5 rounded-lg p-4 border border-white/10 mb-4">
                    <div className="grid grid-cols-2 gap-4">
                        {/* Their Shift (what they're giving up) */}
                        <div>
                            <div className="text-xs text-white/50 mb-1">They're swapping out:</div>
                            <div className="text-sm font-medium text-white/70">
                                {requesterShift?.shift_date}
                            </div>
                            <div className="text-sm text-white/50">
                                {requesterShift?.start_time?.slice(0, 5)} - {requesterShift?.end_time?.slice(0, 5)}
                            </div>
                        </div>

                        {/* Arrow */}
                        <div className="flex items-center justify-center">
                            <ArrowRightLeft className="h-5 w-5 text-purple-400" />
                        </div>
                    </div>

                    <div className="border-t border-white/10 my-3" />

                    {/* Your Shift (what you're offering) */}
                    <div>
                        <div className="text-xs text-white/50 mb-1">You're offering:</div>
                        <div className="font-semibold text-white">
                            {offeredShift.role_name || 'Shift'}
                        </div>
                        <div className="text-sm text-white/70">
                            {offeredShift.shift_date} • {offeredShift.start_time?.slice(0, 5)} - {offeredShift.end_time?.slice(0, 5)}
                        </div>
                        {offeredShift.department_name && (
                            <div className="text-xs text-white/50 mt-1">
                                {offeredShift.department_name}
                            </div>
                        )}
                    </div>
                </div>

                {/* Run Check Button - Before checks are run */}
                {!checksComplete && !isRunningChecks && (
                    <div className="flex flex-col items-center py-8">
                        <p className="text-white/60 text-sm mb-4">
                            Click below to run compliance checks for both parties.
                        </p>
                        <Button
                            onClick={handleRunAllChecks}
                            disabled={isLoading}
                            className="gap-2 bg-purple-600 hover:bg-purple-700"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading roster...
                                </>
                            ) : (
                                <>
                                    <Play className="h-4 w-4" />
                                    Run Compliance Check
                                </>
                            )}
                        </Button>
                    </div>
                )}

                {/* Loading State */}
                {isRunningChecks && (
                    <div className="flex items-center justify-center py-12">
                        <div className="text-center">
                            <Loader2 className="h-8 w-8 animate-spin text-purple-400 mx-auto mb-3" />
                            <p className="text-white/70">Running compliance checks...</p>
                        </div>
                    </div>
                )}

                {/* Compliance Content - Only show after checks complete */}
                {checksComplete && !isRunningChecks && (
                    <ComplianceTabContent
                        hardValidation={hardValidation}
                        ruleResults={ruleResults}
                        setRuleResults={setRuleResults}
                        buildComplianceInput={() => buildComplianceInput(requesterId!, offeredShift!, filteredRequesterRoster)} // Default view, not fully used by read-only tab
                        needsRerun={false}
                        onChecksComplete={() => setChecksComplete(true)}
                        shiftId={offeredShift?.id}
                    />
                )}

                {/* Failure Analysis Alert */}
                {failureAnalysis && (
                    <div className={cn(
                        "mx-4 mt-4 p-3 rounded-lg border text-sm flex items-start gap-3",
                        failureAnalysis === 'BOTH_FAILED' ? "bg-red-950/30 border-red-800 text-red-200" :
                            failureAnalysis === 'YOU_FAILED' ? "bg-amber-950/30 border-amber-800 text-amber-200" :
                                "bg-orange-950/30 border-orange-800 text-orange-200"
                    )}>
                        <Shield className="h-5 w-5 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold mb-1">
                                {failureAnalysis === 'BOTH_FAILED' ? "Compliance Failed for Both Parties" :
                                    failureAnalysis === 'YOU_FAILED' ? "You cannot take this shift" :
                                        `Request cannot be fulfilled`}
                            </p>
                            <p className="opacity-90">
                                {failureAnalysis === 'BOTH_FAILED' && "Neither you nor the requester can legally work these shifts."}
                                {failureAnalysis === 'YOU_FAILED' && "Taking this shift would put YOU in violation of compliance rules."}
                                {failureAnalysis === 'THEY_FAILED' && `Taking your shift would put ${requesterName} in violation of compliance rules.`}
                                {failureAnalysis === 'UNKNOWN_FAILURE' && "Compliance checks failed."}
                            </p>
                        </div>
                    </div>
                )}


                <DialogFooter className="mt-6 gap-2">
                    <Button variant="outline" onClick={onClose} className="border-white/10">
                        Cancel
                    </Button>

                    {checksComplete && (
                        <Button
                            onClick={onConfirmOffer}
                            disabled={!canProceed || isSubmitting}
                            className={cn(
                                "gap-2",
                                canProceed
                                    ? "bg-green-600 hover:bg-green-700 text-white"
                                    : "bg-white/10 text-white/50 cursor-not-allowed"
                            )}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Sending...
                                </>
                            ) : canProceed ? (
                                <>
                                    <Send className="h-4 w-4" />
                                    {hasWarnings ? 'Send Offer Anyway' : 'Send Offer'}
                                </>
                            ) : (
                                'Cannot Proceed'
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default SwapComplianceModal;
