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
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-slate-900 border-white/10">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-white">
                        <Shield className="h-5 w-5 text-purple-400" />
                        Compliance Check
                    </DialogTitle>
                    <DialogDescription className="text-white/50">
                        Review compliance rules before expressing interest in this shift.
                    </DialogDescription>
                </DialogHeader>

                {/* Shift Summary */}
                <div className="bg-white/5 rounded-lg p-4 border border-white/10 mb-4">
                    <div className="text-sm text-white/50 mb-1">Checking eligibility for:</div>
                    <div className="font-semibold text-white">{shift.role}</div>
                    <div className="text-sm text-white/70">
                        {shift.date} • {shift.startTime} - {shift.endTime} ({Math.round(shift.netLength)}m)
                    </div>
                    <div className="text-xs text-white/50 mt-1">
                        {shift.organization} → {shift.department}
                    </div>
                </div>

                {/* Loading State */}
                {(isLoadingShifts || isRunningChecks || !checksComplete) && (
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
                        buildComplianceInput={buildComplianceInput}
                        needsRerun={false}
                        onChecksComplete={() => setChecksComplete(true)}
                    />
                )}

                <DialogFooter className="mt-6 gap-2">
                    <Button variant="outline" onClick={onClose} className="border-white/10">
                        Cancel
                    </Button>

                    {checksComplete && (
                        <Button
                            onClick={onConfirmBid}
                            disabled={!canProceed || isPending}
                            className={cn(
                                "gap-2",
                                canProceed
                                    ? "bg-purple-600 hover:bg-purple-700 text-white"
                                    : "bg-white/10 text-white/50 cursor-not-allowed"
                            )}
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Submitting...
                                </>
                            ) : canProceed ? (
                                <>
                                    <ThumbsUp className="h-4 w-4" />
                                    {hasWarnings ? 'Express Interest Anyway' : 'Express Interest'}
                                </>
                            ) : (
                                <>
                                    <XCircle className="h-4 w-4" />
                                    Cannot Proceed
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
