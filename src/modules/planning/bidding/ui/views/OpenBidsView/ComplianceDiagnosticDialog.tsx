import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format, addDays, subDays } from 'date-fns';
import {
    Loader2,
    ShieldCheck,
    ShieldAlert,
    AlertTriangle,
    X,
    User,
    Calendar,
    Clock
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { supabase } from '@/platform/realtime/client';
import { cn } from '@/modules/core/lib/utils';
import {
    runHardValidation,
    runRule,
    getRegisteredRules,
    ComplianceCheckInput,
    ComplianceResult,
    HardValidationResult,
    ShiftTimeRange
} from '@/modules/compliance';
import { ComplianceTabContent } from '@/modules/rosters/ui/components/ComplianceTabContent';
import { EmployeeBid, ManagerBidShift } from './types';

interface ComplianceDiagnosticDialogProps {
    isOpen: boolean;
    onClose: () => void;
    shift: ManagerBidShift | null;
    bid: EmployeeBid | null;
    onAssign: (bid: EmployeeBid) => Promise<void>;
    isAssigning: boolean;
}

const SYDNEY_TZ = 'Australia/Sydney';

export const ComplianceDiagnosticDialog: React.FC<ComplianceDiagnosticDialogProps> = ({
    isOpen,
    onClose,
    shift,
    bid,
    onAssign,
    isAssigning
}) => {
    const [isLoadingShifts, setIsLoadingShifts] = useState(false);
    const [employeeShifts, setEmployeeShifts] = useState<ShiftTimeRange[]>([]);
    const [ruleResults, setRuleResults] = useState<Record<string, ComplianceResult | null>>({});
    const [hardValidation, setHardValidation] = useState<HardValidationResult>({ passed: true, errors: [] });
    const [hasRun, setHasRun] = useState(false);

    // 1. Fetch Existing Shifts for Context
    useEffect(() => {
        if (!isOpen || !bid || !shift) {
            setHasRun(false);
            setRuleResults({});
            return;
        }

        const fetchShifts = async () => {
            setIsLoadingShifts(true);
            const shiftDate = new Date(shift.date);
            const startDate = format(subDays(shiftDate, 14), 'yyyy-MM-dd');
            const endDate = format(addDays(shiftDate, 14), 'yyyy-MM-dd');

            try {
                const { data, error } = await supabase
                    .from('shifts')
                    .select('id, start_time, end_time, shift_date, unpaid_break_minutes')
                    .eq('assigned_employee_id', bid.employeeId)
                    .gte('shift_date', startDate)
                    .lte('shift_date', endDate)
                    .is('deleted_at', null)
                    .eq('is_cancelled', false);

                if (!error && data) {
                    // Filter out current shift if it's already assigned (though in bidding it shouldn't be)
                    const mapped = data
                        .filter(s => s.id !== shift.id)
                        .map(s => ({
                            start_time: s.start_time,
                            end_time: s.end_time,
                            shift_date: s.shift_date,
                            unpaid_break_minutes: s.unpaid_break_minutes || 0
                        }));
                    setEmployeeShifts(mapped);
                }
            } catch (err) {
                console.error('Error fetching employee shifts:', err);
            } finally {
                setIsLoadingShifts(false);
            }
        };

        fetchShifts();
    }, [isOpen, bid, shift]);

    // 2. Run Engine when data is ready
    const buildComplianceInput = useCallback((): ComplianceCheckInput => {
        if (!shift || !bid) throw new Error('Missing shift or bid context');

        return {
            employee_id: bid.employeeId,
            action_type: 'bid',
            candidate_shift: {
                start_time: shift.startTime,
                end_time: shift.endTime,
                shift_date: shift.date,
                unpaid_break_minutes: shift.unpaidBreak || 0,
            },
            existing_shifts: employeeShifts,
        };
    }, [shift, bid, employeeShifts]);

    const runAllChecks = useCallback(() => {
        if (!shift || !bid) return;

        const input = buildComplianceInput();

        // Hard Validation (Layer 1)
        const hv = runHardValidation({
            shift_date: input.candidate_shift.shift_date,
            start_time: input.candidate_shift.start_time,
            end_time: input.candidate_shift.end_time,
            employee_id: input.employee_id,
            existing_shifts: input.existing_shifts,
            current_time: new Date(), // Use local time for comparison in bidder
            is_template: false
        });
        setHardValidation(hv);

        // Rule Engines (Layer 2)
        const rules = getRegisteredRules();
        const newResults: Record<string, ComplianceResult | null> = {};
        rules.forEach(rule => {
            newResults[rule.id] = runRule(rule.id, input);
        });

        setRuleResults(newResults);
        setHasRun(true);
    }, [shift, bid, employeeShifts, buildComplianceInput]);

    useEffect(() => {
        if (isOpen && !isLoadingShifts && bid && shift && employeeShifts.length >= 0 && !hasRun) {
            runAllChecks();
        }
    }, [isOpen, isLoadingShifts, bid, shift, employeeShifts, hasRun, runAllChecks]);

    // 3. Status Summary
    const stats = useMemo(() => {
        const results = Object.values(ruleResults).filter(Boolean) as ComplianceResult[];
        const blockingFails = results.filter(r => r.status === 'fail' && r.blocking).length + (hardValidation.passed ? 0 : 1);
        const warnings = results.filter(r => r.status === 'warning').length;
        const passed = results.filter(r => r.status === 'pass').length + (hardValidation.passed ? 1 : 0);

        return { blockingFails, warnings, passed };
    }, [ruleResults, hardValidation]);

    if (!shift || !bid) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 bg-[#0f172a] border-white/10 overflow-hidden">
                <DialogHeader className="px-6 py-4 border-b border-white/5 bg-slate-900/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                            <div>
                                <DialogTitle className="text-xl font-bold text-white">Compliance Diagnostic</DialogTitle>
                                <div className="flex items-center gap-2 mt-1">
                                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-1.5 py-0">
                                        Full Engine v2.0
                                    </Badge>
                                    <span className="text-white/40 text-xs italic">Verifying {bid.employeeName}</span>
                                </div>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-white/5">
                            <X className="h-5 w-5" />
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 min-h-0 flex flex-col">
                    {/* Quick Context Bar */}
                    <div className="bg-slate-900/30 px-6 py-3 border-b border-white/5 grid grid-cols-3 gap-4">
                        <div className="flex items-center gap-2 text-sm">
                            <User className="h-4 w-4 text-white/30" />
                            <span className="text-white/50">Employee:</span>
                            <span className="text-white font-medium truncate">{bid.employeeName}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-white/30" />
                            <span className="text-white/50">Date:</span>
                            <span className="text-white font-medium">{format(new Date(shift.date), 'EEE, MMM d')}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-white/30" />
                            <span className="text-white/50">Time:</span>
                            <span className="text-white font-medium">{shift.startTime} - {shift.endTime}</span>
                        </div>
                    </div>

                    <ScrollArea className="flex-1">
                        <div className="p-6">
                            {isLoadingShifts ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                    <p className="text-white/50 animate-pulse">Running diagnostic engine...</p>
                                </div>
                            ) : (
                                <ComplianceTabContent
                                    hardValidation={hardValidation}
                                    buildComplianceInput={buildComplianceInput}
                                    ruleResults={ruleResults}
                                    setRuleResults={setRuleResults}
                                    onChecksComplete={() => { }}
                                />
                            )}
                        </div>
                    </ScrollArea>
                </div>

                <DialogFooter className="px-6 py-4 border-t border-white/5 bg-slate-900/50 flex items-center justify-between sm:justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <div className={cn("h-2 w-2 rounded-full", stats.blockingFails > 0 ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" : "bg-white/20")} />
                            <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Blockers: {stats.blockingFails}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className={cn("h-2 w-2 rounded-full", stats.warnings > 0 ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "bg-white/20")} />
                            <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Warnings: {stats.warnings}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button variant="ghost" onClick={onClose} disabled={isAssigning} className="text-white/60 hover:text-white hover:bg-white/5">
                            Close
                        </Button>
                        <Button
                            className={cn(
                                "min-w-[140px] font-bold",
                                stats.blockingFails > 0
                                    ? "bg-slate-800 text-white/40 cursor-not-allowed border-white/5"
                                    : stats.warnings > 0
                                        ? "bg-amber-500 hover:bg-amber-600 text-black shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                                        : "bg-emerald-500 hover:bg-emerald-600 text-black shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                            )}
                            disabled={isAssigning || stats.blockingFails > 0}
                            onClick={() => onAssign(bid)}
                        >
                            {isAssigning ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Assigning...
                                </>
                            ) : stats.blockingFails > 0 ? (
                                <>
                                    <ShieldAlert className="h-4 w-4 mr-2" />
                                    Blocked
                                </>
                            ) : (
                                <>
                                    <ShieldCheck className="h-4 w-4 mr-2" />
                                    {stats.warnings > 0 ? 'Force Assign' : 'Assign Shift'}
                                </>
                            )}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
