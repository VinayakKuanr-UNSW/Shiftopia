import React, { useState, useCallback, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { ComplianceTabContent } from '@/modules/rosters/ui/components/ComplianceTabContent';
import { ComplianceResult, ComplianceCheckInput } from '@/modules/compliance';
import { DTShift } from '../modes/DayTimelineView';
import { format } from 'date-fns';
import { AlertCircle, Clock, Calendar, User, Loader2 } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { supabase } from '@/platform/realtime/client';
import { ShiftTimeRange as ComplianceShiftTimeRange } from '@/modules/compliance';
import { useEffect } from 'react';

interface S2ComplianceRerunModalProps {
    isOpen: boolean;
    onClose: () => void;
    shift: DTShift;
    newTimes: { start: string; end: string };
    onConfirm: () => void;
}

export const S2ComplianceRerunModal: React.FC<S2ComplianceRerunModalProps> = ({
    isOpen,
    onClose,
    shift,
    newTimes,
    onConfirm,
}) => {
    const [ruleResults, setRuleResults] = useState<Record<string, ComplianceResult | null>>({});
    const handleRuleResult = (ruleId: string, result: ComplianceResult | null) =>
        setRuleResults(prev => ({ ...prev, [ruleId]: result }));
    const [existingShifts, setExistingShifts] = useState<ComplianceShiftTimeRange[]>([]);
    const [isLoadingShifts, setIsLoadingShifts] = useState(false);

    const employeeId = shift.rawShift.employee_id || shift.rawShift.assigned_employee_id;
    const shiftDate = shift.rawShift.shift_date;

    useEffect(() => {
        const fetchExisting = async () => {
            if (!employeeId || !shiftDate || !isOpen) return;
            setIsLoadingShifts(true);
            try {
                const { data, error } = await supabase
                    .from('shifts')
                    .select('id, start_time, end_time, shift_date')
                    .eq('employee_id', employeeId)
                    .eq('shift_date', shiftDate)
                    .neq('id', shift.id);

                if (!error && data) {
                    setExistingShifts(data.map(s => ({
                        start_time: s.start_time,
                        end_time: s.end_time,
                        shift_date: s.shift_date
                    })));
                }
            } catch (err) {
                console.error('[S2Modal] Error fetching shifts', err);
            } finally {
                setIsLoadingShifts(false);
            }
        };
        fetchExisting();
    }, [employeeId, shiftDate, shift.id, isOpen]);

    const buildComplianceInput = useCallback((): ComplianceCheckInput => {
        const raw = shift.rawShift;
        return {
            employee_id: employeeId,
            action_type: 'assign',
            candidate_shift: {
                shift_date: raw.shift_date,
                start_time: newTimes.start,
                end_time: newTimes.end,
                unpaid_break_minutes: raw.unpaid_break_minutes ?? 0,
            },
            existing_shifts: existingShifts,
            exclude_shift_id: shift.id,
        };
    }, [shift, newTimes, employeeId, existingShifts]);

    const hardValidation = useMemo(() => ({
        passed: true,
        errors: []
    }), []);

    const canProceed = useMemo(() => {
        const results = Object.values(ruleResults).filter(Boolean) as ComplianceResult[];
        return !results.some(r => r.status === 'fail' && r.blocking);
    }, [ruleResults]);

    const formatTime = (time: string) => {
        const [h, m] = time.split(':');
        const hh = parseInt(h);
        const ampm = hh >= 12 ? 'PM' : 'AM';
        const displayH = hh % 12 || 12;
        return `${displayH}:${m} ${ampm}`;
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                        Compliance Rerun Required
                    </DialogTitle>
                    <div className="text-sm text-muted-foreground mt-1">
                        You are resizing an assigned shift. We need to verify if the new timing complies with the employee's schedule and rules.
                    </div>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
                    <div className="md:col-span-1 space-y-4">
                        <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-4">
                            <h4 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Shift Details</h4>
                            
                            <div className="flex items-start gap-3">
                                <User className="h-4 w-4 text-primary mt-0.5" />
                                <div>
                                    <div className="text-sm font-bold">{shift.employeeName}</div>
                                    <div className="text-[10px] text-muted-foreground uppercase">{shift.role}</div>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <Calendar className="h-4 w-4 text-primary mt-0.5" />
                                <div className="text-sm font-medium">
                                    {format(new Date(shift.rawShift.shift_date), 'EEE, MMM d, yyyy')}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase">Proposed Change</div>
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs line-through opacity-50">
                                        {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                                    </Badge>
                                    <span className="text-muted-foreground">→</span>
                                    <Badge className="bg-indigo-500 hover:bg-indigo-600 text-xs">
                                        {formatTime(newTimes.start)} – {formatTime(newTimes.end)}
                                    </Badge>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="md:col-span-2">
                        {isLoadingShifts ? (
                            <div className="flex flex-col items-center justify-center h-64 gap-4 bg-muted/20 rounded-2xl border border-dashed">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <div className="text-sm font-medium text-muted-foreground">Fetching employee schedule...</div>
                            </div>
                        ) : (
                            <ComplianceTabContent
                                hardValidation={hardValidation}
                                buildComplianceInput={buildComplianceInput}
                                ruleResults={ruleResults}
                                onRuleResult={handleRuleResult}
                                shiftId={shift.id}
                                needsRerun={true}
                            />
                        )}
                    </div>
                </div>

                <DialogFooter className="border-t pt-4">
                    <Button variant="ghost" onClick={onClose} className="font-bold uppercase tracking-widest text-xs">
                        Cancel
                    </Button>
                    <Button 
                        onClick={onConfirm} 
                        disabled={Object.keys(ruleResults).length === 0 || !canProceed}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-widest text-xs px-8 shadow-lg shadow-indigo-900/20"
                    >
                        Confirm Timing Change
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
