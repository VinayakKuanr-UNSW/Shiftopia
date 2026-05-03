/**
 * BulkAssignmentPanel — Slide-in panel for bulk shift assignment with compliance.
 *
 * Flow:
 *   1. Manager selects employee from the dropdown
 *   2. Clicks "Validate" — engine runs incremental compliance simulation
 *   3. Per-shift results displayed (PASS / WARN / FAIL with violation details)
 *   4. "Assign X Shifts" commits passing shifts via sm_bulk_assign RPC
 *   5. Cache is invalidated → roster refreshes
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/modules/core/ui/primitives/sheet';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import {
    Loader2,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    ChevronDown,
    ChevronRight,
    UserCheck,
    ClipboardList,
    Zap,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { bulkAssignmentController } from '@/modules/rosters/bulk-assignment';
import type { BulkAssignmentResult, ShiftAssignmentResult, ShiftViolation, ShiftAssignmentStatus } from '@/modules/rosters/bulk-assignment';

// =============================================================================
// TYPES
// =============================================================================

export interface BulkAssignmentEmployee {
    id: string;
    name: string;
    avatarUrl?: string;
    role?: string;
}

interface BulkAssignmentPanelProps {
    open: boolean;
    onClose: () => void;
    selectedV8ShiftIds: string[];
    employees: BulkAssignmentEmployee[];
    onAssignComplete: () => void;
}

// =============================================================================
// VIOLATION BADGE
// =============================================================================

const VIOLATION_LABELS: Record<string, string> = {
    DRAFT_STATE:           'Not Draft',
    ALREADY_ASSIGNED:      'Already Assigned',
    OVERLAP:               'Time Overlap',
    ROLE_MISMATCH:         'Role Not Contracted',
    QUALIFICATION_MISSING: 'Missing Qualification',
    QUALIFICATION_EXPIRED: 'Expired Qualification',
    REST_GAP:              'Insufficient Rest',
    WEEKLY_HOURS:          'Avg Hours Limit',
    DAILY_HOURS:           'Daily Hours Exceeded',
    WORKING_DAYS_CAP:      'Working Days Cap (20/28)',
    STUDENT_VISA:          'Student Visa Limit',
};

function ViolationChip({ v }: { v: ShiftViolation }) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
                v.blocking
                    ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30',
            )}
        >
            {v.blocking ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {VIOLATION_LABELS[v.violation_type] ?? v.violation_type}
        </span>
    );
}

// =============================================================================
// SHIFT RESULT ROW
// =============================================================================

function ShiftResultRow({ result }: { result: ShiftAssignmentResult }) {
    const [expanded, setExpanded] = useState(false);

    const statusIcon = {
        PASS: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
        WARN: <AlertTriangle className="h-4 w-4 text-amber-500" />,
        FAIL: <XCircle className="h-4 w-4 text-red-500" />,
    }[result.status];

    const statusColor: Record<ShiftAssignmentStatus, string> = {
        PASS: 'border-emerald-500/20 bg-emerald-500/5',
        WARN: 'border-amber-500/20 bg-amber-500/5',
        FAIL: 'border-red-500/20 bg-red-500/5',
    };

    return (
        <div className={cn('rounded-lg border p-3 transition-colors', statusColor[result.status])}>
            <button
                className="w-full text-left flex items-center gap-3"
                onClick={() => result.violations.length > 0 && setExpanded(!expanded)}
            >
                {statusIcon}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">
                            {result.shiftDate}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {result.startTime} – {result.endTime}
                        </span>
                    </div>
                    {result.violations.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                            {result.violations.slice(0, 3).map((v, i) => (
                                <ViolationChip key={i} v={v} />
                            ))}
                            {result.violations.length > 3 && (
                                <span className="text-[11px] text-muted-foreground self-center">
                                    +{result.violations.length - 3} more
                                </span>
                            )}
                        </div>
                    )}
                </div>
                {result.violations.length > 0 && (
                    expanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
            </button>

            {expanded && result.violations.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5 pl-7">
                    {result.violations.map((v, i) => (
                        <p key={i} className="text-xs text-muted-foreground leading-relaxed">
                            <span className={cn('font-medium', v.blocking ? 'text-red-500' : 'text-amber-500')}>
                                {VIOLATION_LABELS[v.violation_type] ?? v.violation_type}:{' '}
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
// SUMMARY BAR
// =============================================================================

function SummaryBar({ result }: { result: BulkAssignmentResult }) {
    return (
        <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 rounded-lg border border-border">
            <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-sm font-medium text-foreground">{result.passing}</span>
                <span className="text-xs text-muted-foreground">passing</span>
            </div>
            {result.failing > 0 && (
                <>
                    <div className="w-px h-4 bg-border" />
                    <div className="flex items-center gap-1.5">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-sm font-medium text-foreground">{result.failing}</span>
                        <span className="text-xs text-muted-foreground">failing</span>
                    </div>
                </>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
                {result.validationMs}ms
            </div>
        </div>
    );
}

// =============================================================================
// MAIN PANEL
// =============================================================================

export function BulkAssignmentPanel({
    open,
    onClose,
    selectedV8ShiftIds,
    employees,
    onAssignComplete,
}: BulkAssignmentPanelProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
    const [validationResult, setValidationResult] = useState<BulkAssignmentResult | null>(null);
    const [isValidating, setIsValidating] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);

    const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

    // ── Validate ──────────────────────────────────────────────────────────────

    const handleValidate = useCallback(async () => {
        if (!selectedEmployeeId) return;

        setIsValidating(true);
        setValidationResult(null);

        try {
            const result = await bulkAssignmentController.simulate(
                selectedV8ShiftIds,
                selectedEmployeeId,
                { mode: 'PARTIAL_APPLY' },
            );
            setValidationResult(result);
        } catch (err: any) {
            console.error('[BulkAssignmentPanel] Validation error:', err);
            toast({
                title: 'Validation Failed',
                description: err?.message ?? 'An unexpected error occurred.',
                variant: 'destructive',
            });
        } finally {
            setIsValidating(false);
        }
    }, [selectedEmployeeId, selectedV8ShiftIds, toast]);

    // Auto-validate whenever the selected employee changes.
    // The cleanup flag prevents stale results if the employee changes mid-flight.
    useEffect(() => {
        if (!selectedEmployeeId || selectedV8ShiftIds.length === 0) {
            setValidationResult(null);
            return;
        }
        handleValidate();
    // handleValidate is stable when selectedEmployeeId is stable; re-run only on employee change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEmployeeId]);

    // ── Commit ────────────────────────────────────────────────────────────────

    const handleCommit = useCallback(async () => {
        if (!validationResult || !selectedEmployeeId) return;

        setIsCommitting(true);
        try {
            const commitResult = await bulkAssignmentController.commit(
                validationResult,
                selectedEmployeeId,
            );

            if (commitResult.success) {
                toast({
                    title: 'Shifts Assigned',
                    description: `Successfully assigned ${commitResult.committed.length} shift(s) to ${selectedEmployee?.name ?? 'employee'}.`,
                });
                // Invalidate shift list queries → roster refreshes automatically
                queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
                onAssignComplete();
                onClose();
            } else {
                toast({
                    title: 'Assignment Failed',
                    description: commitResult.message ?? 'Failed to commit shifts.',
                    variant: 'destructive',
                });
            }
        } catch (err: any) {
            console.error('[BulkAssignmentPanel] Commit error:', err);
            toast({
                title: 'Error',
                description: err?.message ?? 'Failed to assign shifts.',
                variant: 'destructive',
            });
        } finally {
            setIsCommitting(false);
        }
    }, [validationResult, selectedEmployeeId, selectedEmployee, queryClient, toast, onAssignComplete, onClose]);

    // ── Reset when closed ─────────────────────────────────────────────────────
    const handleClose = () => {
        setValidationResult(null);
        setSelectedEmployeeId('');
        onClose();
    };

    // ── Render ────────────────────────────────────────────────────────────────

    const canCommit = validationResult?.canCommit && validationResult.passing > 0;

    return (
        <Sheet open={open} onOpenChange={open => !open && handleClose()}>
            <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
                {/* Header */}
                <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
                    <div className="flex items-center gap-2">
                        <UserCheck className="h-5 w-5 text-primary" />
                        <SheetTitle>Bulk Assign Shifts</SheetTitle>
                    </div>
                    <SheetDescription>
                        Assign {selectedV8ShiftIds.length} selected shift{selectedV8ShiftIds.length !== 1 ? 's' : ''} to an employee after compliance validation.
                    </SheetDescription>
                </SheetHeader>

                {/* Body */}
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    <div className="px-6 py-4 space-y-4 border-b border-border">
                        {/* Employee picker */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">
                                Select Employee
                            </label>
                            <Select
                                value={selectedEmployeeId}
                                onValueChange={(v) => {
                                    setSelectedEmployeeId(v);
                                    setValidationResult(null); // Reset on change
                                }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Choose an employee..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {employees.map(emp => (
                                        <SelectItem key={emp.id} value={emp.id}>
                                            <div className="flex items-center gap-2">
                                                <span>{emp.name}</span>
                                                {emp.role && (
                                                    <span className="text-xs text-muted-foreground">({emp.role})</span>
                                                )}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Validation status — auto-runs on employee select */}
                        {selectedEmployeeId && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground h-7">
                                {isValidating ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                        <span>Checking {selectedV8ShiftIds.length} shift{selectedV8ShiftIds.length !== 1 ? 's' : ''}…</span>
                                    </>
                                ) : validationResult ? (
                                    <>
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                        <span>
                                            Compliance checked —{' '}
                                            <span className="text-emerald-500 font-medium">{validationResult.passing} passing</span>
                                            {validationResult.failing > 0 && (
                                                <>, <span className="text-red-500 font-medium">{validationResult.failing} failing</span></>
                                            )}
                                        </span>
                                        <button
                                            onClick={handleValidate}
                                            className="ml-auto text-xs text-primary hover:underline"
                                        >
                                            Re-check
                                        </button>
                                    </>
                                ) : null}
                            </div>
                        )}
                    </div>

                    {/* Results */}
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="px-6 py-4 space-y-3">
                            {validationResult && (
                                <>
                                    {/* Summary */}
                                    <SummaryBar result={validationResult} />

                                    {/* Per-shift results */}
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
                                            <ClipboardList className="h-4 w-4 text-muted-foreground" />
                                            Shift Results
                                        </h3>
                                        {validationResult.results.map(result => (
                                            <ShiftResultRow key={result.shiftId} result={result} />
                                        ))}
                                    </div>
                                </>
                            )}

                            {!validationResult && !isValidating && selectedEmployeeId && (
                                <div className="py-8 text-center text-muted-foreground">
                                    <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-30" />
                                    <p className="text-sm">Run validation to see compliance results</p>
                                </div>
                            )}

                            {!validationResult && !isValidating && !selectedEmployeeId && (
                                <div className="py-8 text-center text-muted-foreground">
                                    <UserCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
                                    <p className="text-sm">Select an employee to begin</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-border space-y-2">
                    {validationResult && (
                        <div className="text-xs text-muted-foreground text-center mb-1">
                            {validationResult.failing > 0
                                ? `${validationResult.failing} shift(s) with blocking violations will be skipped`
                                : 'All shifts passed — ready to assign'}
                        </div>
                    )}
                    <Button
                        onClick={handleCommit}
                        disabled={!canCommit || isCommitting}
                        className={cn(
                            'w-full gap-2',
                            canCommit
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'opacity-50',
                        )}
                    >
                        {isCommitting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Assigning...
                            </>
                        ) : (
                            <>
                                <Zap className="h-4 w-4" />
                                {validationResult
                                    ? `Assign ${validationResult.passing} Shift${validationResult.passing !== 1 ? 's' : ''}`
                                    : 'Assign Shifts'}
                            </>
                        )}
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={handleClose}>
                        Cancel
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
