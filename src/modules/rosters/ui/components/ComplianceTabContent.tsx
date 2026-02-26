/**
 * Compliance Tab Content Component - Premium Enhanced Version
 * 
 * Features unique visual cards for each compliance rule type:
 * - Overlapping Shifts: Timeline with conflict zone using refined gradients
 * - Max Net Hours: Sleek stacked bar chart
 * - Student Visa: Modern weekly breakdown
 * - Min Rest Gap: Visual gap visualization
 * - Max Consecutive Days: 20-day grid with streak visualization
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Circle,
    Play,
    ChevronDown,
    ChevronUp,
    Loader2,
    Clock,
    Calendar,
    Moon,
    Coffee,
    Zap,
    AlertOctagon,
    Shield,
    Layers,
    Info
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import {
    getRegisteredRules,
    runRule,
    ComplianceResult,
    ComplianceCheckInput,
    HardValidationResult,
    ComplianceRule
} from '@/modules/compliance';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';
import { format, parseISO } from 'date-fns';

/** Net minutes between two HH:MM times (handles overnight). */
function calcNetMinutes(s: { start_time: string; end_time: string; unpaid_break_minutes?: number }): number {
    const parse = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = parse(s.end_time) - parse(s.start_time);
    if (gross < 0) gross += 24 * 60;
    return Math.max(0, gross - (s.unpaid_break_minutes ?? 0));
}

// =============================================================================
// TYPES
// =============================================================================

interface ComplianceTabContentProps {
    hardValidation: HardValidationResult;
    buildComplianceInput: () => ComplianceCheckInput;
    ruleResults: Record<string, ComplianceResult | null>;
    setRuleResults: React.Dispatch<React.SetStateAction<Record<string, ComplianceResult | null>>>;
    needsRerun?: boolean;
    onChecksComplete?: () => void;
}

type RuleStatus = 'pass' | 'fail' | 'warning' | 'not-run';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ComplianceTabContent({
    hardValidation,
    buildComplianceInput,
    ruleResults,
    setRuleResults,
    needsRerun = false,
    onChecksComplete
}: ComplianceTabContentProps) {
    const [isRunningAll, setIsRunningAll] = useState(false);
    const rules = getRegisteredRules();

    // Compute summary stats
    const summaryStats = useMemo(() => {
        const results = Object.values(ruleResults).filter(Boolean) as ComplianceResult[];
        const hardPassed = hardValidation.passed;
        const blockingFails = results.filter(r => r.status === 'fail' && r.blocking).length + (hardPassed ? 0 : 1);
        const warnings = results.filter(r => r.status === 'warning').length;
        const passed = results.filter(r => r.status === 'pass').length + (hardPassed ? 1 : 0);
        const notRun = rules.length - results.length;

        return { blockingFails, warnings, passed, notRun };
    }, [ruleResults, hardValidation, rules.length]);

    const handleRunRule = useCallback((ruleId: string) => {
        const input = buildComplianceInput();
        const result = runRule(ruleId, input);
        setRuleResults(prev => ({
            ...prev,
            [ruleId]: result
        }));
    }, [buildComplianceInput, setRuleResults]);

    const handleRunAll = useCallback(async () => {
        setIsRunningAll(true);
        // Slight delay for visual feedback
        await new Promise(resolve => setTimeout(resolve, 300));
        try {
            const input = buildComplianceInput();
            const newResults: Record<string, ComplianceResult | null> = {};

            // Client-side rules (fast, local data)
            rules.forEach(rule => {
                newResults[rule.id] = runRule(rule.id, input);
            });

            // Server-side authoritative overlap check (SECURITY DEFINER — sees all
            // shifts regardless of RLS scope, preventing false PASS on overlap).
            if (input.employee_id && input.employee_id !== 'preview') {
                try {
                    const serverResult = await validateCompliance({
                        employeeId: input.employee_id,
                        shiftDate: input.candidate_shift.shift_date,
                        startTime: input.candidate_shift.start_time,
                        endTime: input.candidate_shift.end_time,
                        netLengthMinutes: calcNetMinutes(input.candidate_shift),
                        excludeShiftId: input.exclude_shift_id,
                    });

                    if (serverResult.checksPerformed.includes('overlap')) {
                        const hasOverlap = serverResult.violations.some(v =>
                            v.toLowerCase().includes('overlap')
                        );
                        newResults['NO_OVERLAP'] = {
                            rule_id: 'NO_OVERLAP',
                            rule_name: 'No Overlapping Shifts',
                            status: hasOverlap ? 'fail' : 'pass',
                            summary: hasOverlap
                                ? 'Employee already has a shift at this time'
                                : 'No overlapping shifts found',
                            details: hasOverlap
                                ? (serverResult.violations.find(v => v.toLowerCase().includes('overlap'))
                                    ?? 'Shift overlap detected in database')
                                : 'No overlapping shifts found.',
                            calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0 },
                            blocking: true,
                        };
                    }
                } catch {
                    // Server unavailable — keep client-side result as best-effort
                }
            }

            setRuleResults(newResults);
            onChecksComplete?.();
        } finally {
            setIsRunningAll(false);
        }
    }, [buildComplianceInput, rules, setRuleResults, onChecksComplete]);

    const canProceed = hardValidation.passed &&
        !Object.values(ruleResults).some(r => r?.status === 'fail' && r?.blocking);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {needsRerun && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-4 backdrop-blur-md">
                    <div className="p-2 bg-amber-500/20 rounded-lg">
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-amber-500">Inputs Changed</h4>
                        <p className="text-sm text-white/60 mt-1">
                            Shift details have been modified. Please re-run compliance checks to ensure validity.
                        </p>
                    </div>
                </div>
            )}

            {/* Premium Header Banner */}
            <div className={cn(
                "relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 shadow-xl",
                canProceed
                    ? "bg-gradient-to-br from-emerald-950/80 via-emerald-900/40 to-slate-900/80 border-emerald-500/30 shadow-emerald-900/20"
                    : summaryStats.blockingFails > 0
                        ? "bg-gradient-to-br from-red-950/80 via-red-900/40 to-slate-900/80 border-red-500/30 shadow-red-900/20"
                        : "bg-gradient-to-br from-slate-900/90 via-slate-800/50 to-slate-900/90 border-white/10"
            )}>
                <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-overlay" />

                <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-5">
                        <div className={cn(
                            "h-14 w-14 rounded-2xl flex items-center justify-center shadow-lg border",
                            canProceed
                                ? "bg-emerald-500/20 border-emerald-500/20 text-emerald-400"
                                : summaryStats.blockingFails > 0
                                    ? "bg-red-500/20 border-red-500/20 text-red-400"
                                    : "bg-slate-700/30 border-white/10 text-slate-400"
                        )}>
                            {canProceed ? (
                                <Shield className="h-7 w-7" />
                            ) : summaryStats.blockingFails > 0 ? (
                                <AlertOctagon className="h-7 w-7" />
                            ) : (
                                <Circle className="h-7 w-7" />
                            )}
                        </div>

                        <div>
                            <h3 className={cn(
                                "text-xl font-bold tracking-tight",
                                canProceed ? "text-emerald-400" : summaryStats.blockingFails > 0 ? "text-red-400" : "text-white"
                            )}>
                                {canProceed
                                    ? "Compliance Passed"
                                    : summaryStats.blockingFails > 0
                                        ? "Compliance Failed"
                                        : "Validation Required"}
                            </h3>
                            <p className="text-sm text-white/50 mt-1">
                                {summaryStats.blockingFails > 0
                                    ? `${summaryStats.blockingFails} blocking issue${summaryStats.blockingFails > 1 ? 's' : ''} prevents saving`
                                    : summaryStats.notRun > 0
                                        ? "Run compliance checks to validate this shift"
                                        : "All checks passed successfully"}
                            </p>
                        </div>
                    </div>

                    <Button
                        type="button"
                        size="sm"
                        onClick={handleRunAll}
                        disabled={isRunningAll}
                        className={cn(
                            "h-10 px-6 font-semibold shadow-lg transition-all active:scale-95",
                            canProceed
                                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20"
                                : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/20"
                        )}
                    >
                        {isRunningAll ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Validating...
                            </>
                        ) : (
                            <>
                                <Play className="h-4 w-4 mr-2 fill-current" />
                                Run Checks
                            </>
                        )}
                    </Button>
                </div>

                {/* Glassy Stats Bar */}
                <div className="relative mt-6 flex gap-3">
                    {summaryStats.blockingFails > 0 && (
                        <div className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-xs font-medium text-red-300">
                            <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                            {summaryStats.blockingFails} Blocking
                        </div>
                    )}
                    {summaryStats.warnings > 0 && (
                        <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2 text-xs font-medium text-amber-300">
                            <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            {summaryStats.warnings} Warning{summaryStats.warnings > 1 ? 's' : ''}
                        </div>
                    )}
                    {summaryStats.passed > 0 && (
                        <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 text-xs font-medium text-emerald-300">
                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {summaryStats.passed} Passed
                        </div>
                    )}
                </div>
            </div>

            {/* Rule Cards Grid */}
            <div className="space-y-3">
                {/* Hard Validation Card - Hidden if passed */}
                {!hardValidation.passed && <HardValidationCard result={hardValidation} />}

                {rules.map((rule: ComplianceRule) => (
                    <ComplianceRuleCard
                        key={rule.id}
                        rule={rule}
                        result={ruleResults[rule.id]}
                        onRun={() => handleRunRule(rule.id)}
                    />
                ))}
            </div>
        </div>
    );
}

// =============================================================================
// HARD VALIDATION CARD (PREMIUM)
// =============================================================================

function HardValidationCard({ result }: { result: HardValidationResult }) {
    const [expanded, setExpanded] = useState(!result.passed);
    const hasOverlap = result.errors.some(e =>
        e.message.toLowerCase().includes('overlap') ||
        e.message.toLowerCase().includes('conflict')
    );

    return (
        <div className="rounded-xl overflow-hidden border border-red-500/40 bg-red-950/20 shadow-lg shadow-red-900/10">
            <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-red-500/20 flex items-center justify-center text-red-400 border border-red-500/20">
                        <XCircle className="h-5 w-5" />
                    </div>
                    <div>
                        <div className="font-bold text-white flex items-center gap-2">
                            Scheduling Conflict
                            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider bg-red-500/20 text-red-300 border border-red-500/20">
                                BLOCKING
                            </span>
                        </div>
                        <div className="text-sm text-red-200/60 mt-0.5">
                            Critical scheduling error detected
                        </div>
                    </div>
                </div>
                <ChevronDown className={cn("h-5 w-5 text-white/40 transition-transform", expanded && "rotate-180")} />
            </div>

            {expanded && (
                <div className="border-t border-red-500/20 bg-red-950/30 p-4">
                    <div className="space-y-4">
                        {result.errors.map((err, idx) => (
                            <div key={idx}>
                                {hasOverlap && idx === 0 ? (
                                    <OverlapVisualization error={err} />
                                ) : (
                                    <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/20 text-sm text-red-200">
                                        {err.message}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// =============================================================================
// COMPLIANCE RULE CARD (PREMIUM)
// =============================================================================

function ComplianceRuleCard({
    rule,
    result,
    onRun
}: {
    rule: ComplianceRule;
    result: ComplianceResult | null | undefined;
    onRun: () => void;
}) {
    const status: RuleStatus = result?.status || 'not-run';
    // Auto-expand failures/warnings, collapse passes
    const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);

    // Always expand if failed/warning, otherwise respect manual toggle or default to collapsed
    const isExpanded = manualExpanded !== null
        ? manualExpanded
        : (status === 'fail' || status === 'warning');

    const toggle = () => setManualExpanded(!isExpanded);

    // Get specific styles based on status
    const getStyles = () => {
        switch (status) {
            case 'pass': return {
                card: "border-emerald-500/20 bg-emerald-950/10",
                icon: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                text: "text-emerald-100/60"
            };
            case 'fail': return {
                card: "border-red-500/30 bg-red-950/20 shadow-[0_0_15px_-3px_rgba(239,68,68,0.1)]",
                icon: "bg-red-500/10 text-red-400 border-red-500/20",
                badge: "bg-red-500/10 text-red-400 border-red-500/20",
                text: "text-red-100/60"
            };
            case 'warning': return {
                card: "border-amber-500/30 bg-amber-950/20",
                icon: "bg-amber-500/10 text-amber-400 border-amber-500/20",
                badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
                text: "text-amber-100/60"
            };
            default: return { // not-run
                card: "border-white/5 bg-slate-900/40 hover:border-white/10",
                icon: "bg-white/5 text-slate-400 border-white/5",
                badge: "bg-white/5 text-slate-400 border-white/5",
                text: "text-slate-500"
            };
        }
    };

    const styles = getStyles();

    const getIcon = () => {
        switch (rule.id) {
            case 'MAX_DAILY_HOURS': return <Clock className="h-5 w-5" />;
            case 'MIN_REST_GAP': return <Moon className="h-5 w-5" />;
            case 'STUDENT_VISA_48H': return <Zap className="h-5 w-5" />;
            case 'MAX_CONSECUTIVE_DAYS': return <Calendar className="h-5 w-5" />;
            default: return <Shield className="h-5 w-5" />;
        }
    };

    return (
        <div className={cn("rounded-xl border transition-all duration-200 overflow-hidden backdrop-blur-sm", styles.card)}>
            <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5" onClick={toggle}>
                <div className="flex items-center gap-4">
                    <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center border transition-colors", styles.icon)}>
                        {status === 'pass' ? <CheckCircle2 className="h-5 w-5" /> : getIcon()}
                    </div>
                    <div>
                        <div className="font-semibold text-white flex items-center gap-2">
                            {rule.name}
                            <span className={cn(
                                "text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border",
                                styles.badge
                            )}>
                                {status === 'not-run' ? 'PENDING' : status === 'fail' && !rule.blocking ? 'WARNING' : status.toUpperCase()}
                            </span>
                        </div>
                        <div className={cn("text-xs mt-0.5", styles.text)}>
                            {result?.summary || rule.description}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-white/30 hover:text-white hover:bg-white/10"
                        onClick={(e) => { e.stopPropagation(); onRun(); }}
                    >
                        <Play className="h-3.5 w-3.5 fill-current" />
                    </Button>
                    <ChevronDown className={cn("h-4 w-4 text-white/30 transition-transform duration-200", isExpanded && "rotate-180")} />
                </div>
            </div>

            {isExpanded && result && (
                <div className="border-t border-white/5 bg-black/20 p-5 animate-in slide-in-from-top-2 duration-200">
                    <RuleVisualization rule={rule} result={result} />
                </div>
            )}
        </div>
    );
}

// ... Visualizations using refined components ...

// =============================================================================
// RULE-SPECIFIC VISUALIZATIONS
// =============================================================================

function RuleVisualization({ rule, result }: { rule: ComplianceRule; result: ComplianceResult }) {
    switch (rule.id) {
        case 'NO_OVERLAP':
            return <OverlapViz result={result} />;
        case 'MAX_DAILY_HOURS':
            return <MaxDailyHoursViz result={result} />;
        case 'MIN_REST_GAP':
            return <MinRestGapViz result={result} />;
        case 'STUDENT_VISA_48H':
            return <StudentVisaViz result={result} />;
        case 'MAX_CONSECUTIVE_DAYS':
            return <MaxConsecutiveDaysViz result={result} />;
        case 'MIN_SHIFT_LENGTH':
            return <MinShiftLengthViz result={result} />;
        case 'WORKING_DAYS_CAP':
            return <WorkingDaysCapViz result={result} />;
        case 'AVG_FOUR_WEEK_CYCLE':
            return <AvgFourWeekCycleViz result={result} />;
        default:
            return <DefaultViz result={result} />;
    }
}

// -----------------------------------------------------------------------------
// OVERLAP VISUALIZATION
// -----------------------------------------------------------------------------

function OverlapViz({ result }: { result: ComplianceResult }) {
    if (result.status === 'pass') {
        return (
            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <div className="text-sm text-emerald-200">
                    No overlapping shifts found. The candidate is available during this time.
                </div>
            </div>
        );
    }

    const calc = result.calculation;

    // Adapt to HardValidationError format expected by OverlapVisualization
    const error = {
        message: result.details,
        context: {
            existing_start: calc.existing_start_time,
            existing_end: calc.existing_end_time,
            new_start: calc.candidate_start_time,
            new_end: calc.candidate_end_time,
            overlap_minutes: (calc.total_hours || 0) * 60
        }
    };

    return <OverlapVisualization error={error} />;
}

function OverlapVisualization({ error }: { error: { code?: string; message: string; context?: { existing_start?: string; existing_end?: string; new_start?: string; new_end?: string; overlap_minutes?: number } } }) {
    // Helper to normalize time format (remove seconds if present)
    const normalizeTime = (time: string): string => {
        if (!time) return '00:00';
        const parts = time.split(':');
        if (parts.length >= 2) {
            return `${parts[0].padStart(2, '0')}:${parts[1]}`;
        }
        return time;
    };

    // Try to parse times from error message as fallback
    const parseTimesFromMessage = (msg: string): { existingStart: string; existingEnd: string; newStart?: string; newEnd?: string } | null => {
        const existingMatch = msg.match(/\((\d{1, 2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1, 2}:\d{2}(?::\d{2})?)\)/);
        if (!existingMatch) return null;

        const result: { existingStart: string; existingEnd: string; newStart?: string; newEnd?: string } = {
            existingStart: normalizeTime(existingMatch[1]),
            existingEnd: normalizeTime(existingMatch[2])
        };

        const newMatch = msg.match(/New shift:\s*(\d{1, 2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1, 2}:\d{2}(?::\d{2})?)/i);
        if (newMatch) {
            result.newStart = normalizeTime(newMatch[1]);
            result.newEnd = normalizeTime(newMatch[2]);
        }

        return result;
    };

    const parsedFromMsg = parseTimesFromMessage(error.message);
    const existingStart = normalizeTime(error.context?.existing_start || parsedFromMsg?.existingStart || '');
    const existingEnd = normalizeTime(error.context?.existing_end || parsedFromMsg?.existingEnd || '');
    const newStart = normalizeTime(error.context?.new_start || parsedFromMsg?.newStart || '');
    const newEnd = normalizeTime(error.context?.new_end || parsedFromMsg?.newEnd || '');

    // If we have no valid time data, show a text-only fallback
    if (!existingStart || !existingEnd || !newStart || !newEnd) {
        return (
            <div className="space-y-3">
                <div className="text-sm font-medium text-red-300 flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    {error.message || 'The new shift overlaps with an existing shift.'}
                </div>
            </div>
        );
    }

    // Calculate positions (24hr scale)
    const timeToPercent = (time: string) => {
        const [h, m] = time.split(':').map(Number);
        return ((h * 60 + m) / (24 * 60)) * 100;
    };

    const existingStartPct = timeToPercent(existingStart);
    const existingWidthPct = timeToPercent(existingEnd) - existingStartPct;
    const newStartPct = timeToPercent(newStart);
    const newWidthPct = timeToPercent(newEnd) - newStartPct;

    const overlapStart = Math.max(existingStartPct, newStartPct);
    const overlapEnd = Math.min(existingStartPct + existingWidthPct, newStartPct + newWidthPct);
    const hasOverlap = overlapEnd > overlapStart;

    return (
        <div className="space-y-4">
            <div className="text-sm font-medium text-red-300 flex items-center gap-2">
                <Layers className="h-4 w-4" />
                The new shift overlaps with an existing shift.
            </div>

            {/* Timeline */}
            <div className="relative h-24 bg-slate-900/50 rounded-lg border border-white/10 overflow-hidden">
                {/* Time grid */}
                <div className="absolute inset-0 flex">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="flex-1 border-r border-white/5 last:border-r-0" />
                    ))}
                </div>

                {/* Conflict zone highlight */}
                {hasOverlap && (
                    <div
                        className="absolute top-0 bottom-0 bg-red-500/10 border-x-2 border-red-500/30"
                        style={{
                            left: `${overlapStart}%`,
                            width: `${overlapEnd - overlapStart}%`
                        }}
                    >
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                            <AlertTriangle className="h-5 w-5 text-red-400 animate-pulse" />
                        </div>
                    </div>
                )}

                {/* Existing shift */}
                <div className="absolute top-4 h-6 flex items-center" style={{ left: '2%' }}>
                    <span className="text-[10px] text-white/40 mr-2">Existing</span>
                </div>
                <div
                    className="absolute top-3 h-8 rounded-md bg-slate-600 border border-slate-500 flex items-center px-2"
                    style={{
                        left: `${existingStartPct}%`,
                        width: `${existingWidthPct}%`,
                        minWidth: '80px'
                    }}
                >
                    <span className="text-xs text-white font-mono truncate">
                        {existingStart} - {existingEnd}
                    </span>
                </div>

                {/* New shift */}
                <div className="absolute top-14 h-6 flex items-center" style={{ left: '2%' }}>
                    <span className="text-[10px] text-cyan-400 mr-2">New</span>
                </div>
                <div
                    className="absolute top-14 h-8 rounded-md border-2 flex items-center px-2"
                    style={{
                        left: `${newStartPct}%`,
                        width: `${newWidthPct}%`,
                        minWidth: '80px',
                        background: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(6, 182, 212, 0.1) 3px, rgba(6, 182, 212, 0.1) 6px)',
                        borderColor: 'rgb(6, 182, 212)'
                    }}
                >
                    <span className="text-xs text-cyan-300 font-mono truncate">
                        {newStart} - {newEnd}
                    </span>
                </div>
            </div>

            {/* Overlap info */}
            {hasOverlap && (() => {
                const overlapStartTime = Math.max(
                    parseInt(existingStart.split(':')[0]) * 60 + parseInt(existingStart.split(':')[1]),
                    parseInt(newStart.split(':')[0]) * 60 + parseInt(newStart.split(':')[1])
                );
                const overlapEndTime = Math.min(
                    parseInt(existingEnd.split(':')[0]) * 60 + parseInt(existingEnd.split(':')[1]),
                    parseInt(newEnd.split(':')[0]) * 60 + parseInt(newEnd.split(':')[1])
                );
                const overlapMinutes = overlapEndTime - overlapStartTime;
                const overlapHours = Math.floor(overlapMinutes / 60);
                const overlapMins = overlapMinutes % 60;

                return (
                    <div className="flex items-center justify-center gap-2 text-sm text-red-300 bg-red-500/10 rounded-lg py-2 border border-red-500/20">
                        <AlertTriangle className="h-4 w-4" />
                        <span>Overlap duration: {overlapHours > 0 ? `${overlapHours}h ${overlapMins}m` : `${overlapMins}m`}</span>
                    </div>
                );
            })()}
        </div>
    );
}

// -----------------------------------------------------------------------------
// MAX DAILY HOURS VISUALIZATION
// -----------------------------------------------------------------------------

function MaxDailyHoursViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const existingHours = calc.existing_hours || 0;
    const candidateHours = calc.candidate_hours || 0;
    const totalHours = calc.total_hours || 0;
    const limit = calc.limit || 12;

    const existingPct = (existingHours / limit) * 100;
    const candidatePct = (candidateHours / limit) * 100;
    const totalPct = (totalHours / limit) * 100;
    const overflowPct = Math.max(0, totalPct - 100);

    return (
        <div className="space-y-4">
            <div className="text-xs text-white/50">
                {result.status === 'fail'
                    ? `Total working hours for the day exceed the ${limit}-hour limit.`
                    : `Total working hours are within the ${limit}-hour limit.`}
            </div>

            {/* Bar Chart */}
            <div className="relative pt-6">
                <div className="absolute right-0 top-0 flex items-center gap-1 text-[10px] text-white/40">
                    <span>Limit {limit}h</span>
                </div>

                <div className="h-14 bg-slate-900/50 rounded-lg border border-white/10 overflow-visible relative">
                    {/* Existing hours */}
                    <div
                        className="absolute top-0 bottom-0 bg-slate-600 rounded-l-lg flex items-center justify-center transition-all"
                        style={{ width: `${Math.min(existingPct, 100)}%` }}
                    >
                        {existingPct > 20 && (
                            <div className="text-center">
                                <span className="text-sm text-white font-bold">{existingHours}h</span>
                                <div className="text-[10px] text-white/60">Existing</div>
                            </div>
                        )}
                    </div>

                    {/* Candidate hours (new shift) */}
                    <div
                        className={cn(
                            "absolute top-0 bottom-0 flex items-center justify-center transition-all",
                            result.status === 'fail' ? "bg-red-500" : "bg-cyan-500",
                            totalPct > 100 ? "rounded-r-none" : "rounded-r-lg"
                        )}
                        style={{
                            left: `${Math.min(existingPct, 100)}%`,
                            width: `${Math.min(candidatePct, 100 - Math.min(existingPct, 100))}%`
                        }}
                    >
                        {candidatePct > 15 && (
                            <div className="text-center">
                                <span className="text-sm text-white font-bold">+ {candidateHours}h</span>
                                <div className="text-[10px] text-white/80">New Shift</div>
                            </div>
                        )}
                    </div>

                    {/* Overflow indicator */}
                    {overflowPct > 0 && (
                        <div
                            className="absolute top-0 bottom-0 right-0 bg-red-600/80 rounded-r-lg flex items-center justify-center border-l-2 border-white/30"
                            style={{ width: `${Math.min(overflowPct, 25)}%`, transform: 'translateX(100%)' }}
                        >
                            <AlertTriangle className="h-5 w-5 text-white" />
                        </div>
                    )}

                    {/* Limit line */}
                    <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-white/60" />
                </div>
            </div>

            <div className={cn(
                "flex items-center justify-end gap-2 text-right",
                result.status === 'fail' ? "text-red-400" : "text-emerald-400"
            )}>
                <span className="text-white/50 text-sm">Total:</span>
                <span className="text-2xl font-bold">{totalHours}h</span>
            </div>
        </div>
    );
}

// -----------------------------------------------------------------------------
// MIN SHIFT LENGTH VISUALIZATION
// -----------------------------------------------------------------------------

function MinShiftLengthViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const duration = calc.duration_hours || 0;
    const limit = calc.limit || 3;
    const isFail = result.status === 'fail';

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <div className={cn(
                        "text-3xl font-bold",
                        isFail ? "text-red-400" : "text-emerald-400"
                    )}>
                        {duration.toFixed(1)}h
                    </div>
                    <div className="text-xs text-white/40">Shift Duration</div>
                </div>
                <div className="text-right">
                    <div className="text-3xl font-bold text-white/30">{limit}h</div>
                    <div className="text-xs text-white/40">Minimum Required</div>
                </div>
            </div>

            {/* Visual Bar */}
            <div className="h-4 bg-slate-900/50 rounded-full border border-white/10 overflow-hidden relative">
                {/* Min Marker Line */}
                <div className="absolute top-0 bottom-0 w-0.5 bg-white/40" style={{ left: '30%' }} />

                <div
                    className={cn(
                        "h-full rounded-full transition-all",
                        isFail ? "bg-red-500" : "bg-emerald-500"
                    )}
                    style={{ width: `${Math.min((duration / 10) * 100, 100)}%` }}
                />
            </div>

            <div className="text-xs text-white/50 flex justify-between">
                <span>0h</span>
                <span>10h+</span>
            </div>
        </div>
    );
}

// -----------------------------------------------------------------------------
// WORKING DAYS CAP VISUALIZATION
// -----------------------------------------------------------------------------

function WorkingDaysCapViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const count = calc.days_worked || 0;
    const limit = calc.limit || 20;
    const period = calc.period_days || 28;
    const isFail = result.status === 'fail';
    const pct = Math.min((count / period) * 100, 100);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <div className={cn(
                        "text-3xl font-bold",
                        isFail ? "text-red-400" : "text-white"
                    )}>
                        {count} <span className="text-sm font-normal text-white/50">days</span>
                    </div>
                    <div className="text-xs text-white/40">Worked in last {period} days</div>
                </div>
                <div className="text-right">
                    <div className="text-3xl font-bold text-white/30">{limit}</div>
                    <div className="text-xs text-white/40">Max Allowed</div>
                </div>
            </div>

            <div className="h-4 bg-slate-900/50 rounded-full border border-white/10 overflow-hidden">
                <div
                    className={cn(
                        "h-full rounded-full transition-all relative",
                        isFail ? "bg-red-500" : "bg-emerald-500"
                    )}
                    style={{ width: `${Math.min((count / limit) * 100, 100)}%` }}
                >
                    {isFail && <div className="absolute inset-0 bg-white/20 animate-pulse" />}
                </div>
            </div>
        </div>
    );
}

// -----------------------------------------------------------------------------
// AVG FOUR WEEK CYCLE VISUALIZATION
// -----------------------------------------------------------------------------

function AvgFourWeekCycleViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const avgHours = calc.average_weekly_hours || 0;
    const totalHours = calc.total_hours || 0;
    const limit = 38; // 38h/week average
    const cycleLimit = 152; // 152h/4weeks

    const isFail = result.status === 'fail';

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-800/50 rounded-xl border border-white/10">
                    <div className="text-xs text-white/40 mb-1 uppercase tracking-wider">4-Week Total</div>
                    <div className={cn(
                        "text-2xl font-bold",
                        totalHours > cycleLimit ? "text-red-400" : "text-white"
                    )}>
                        {totalHours.toFixed(1)}h
                        <span className="text-xs font-normal text-white/30 ml-2">/ {cycleLimit}h</span>
                    </div>
                </div>
                <div className="p-4 bg-slate-800/50 rounded-xl border border-white/10">
                    <div className="text-xs text-white/40 mb-1 uppercase tracking-wider">Weekly Avg</div>
                    <div className={cn(
                        "text-2xl font-bold",
                        avgHours > limit ? "text-amber-400" : "text-emerald-400"
                    )}>
                        {avgHours.toFixed(1)}h
                        <span className="text-xs font-normal text-white/30 ml-2">/ {limit}h</span>
                    </div>
                </div>
            </div>

            <div className="text-xs text-white/40 text-center">
                Calculated over the current 4-week roster cycle
            </div>
        </div>
    );
}

// -----------------------------------------------------------------------------
// MIN REST GAP VISUALIZATION
// -----------------------------------------------------------------------------

function MinRestGapViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const prevGap = calc.prev_day_gap_hours;
    const nextGap = calc.next_day_gap_hours;
    const limit = calc.limit || 8;

    const GapCard = ({ label, value, isViolation }: { label: string; value: number | null | undefined; isViolation: boolean }) => (
        <div className={cn(
            "p-4 rounded-xl border-2",
            isViolation
                ? "bg-red-500/10 border-red-500/40"
                : value != null
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : "bg-slate-800/50 border-white/10"
        )}>
            <div className="text-xs text-white/40 mb-2 uppercase tracking-wider">{label}</div>
            {value != null ? (
                <>
                    <div className={cn(
                        "text-3xl font-bold",
                        isViolation ? "text-red-400" : "text-emerald-400"
                    )}>
                        {value.toFixed(1)}h
                    </div>
                    <div className="mt-3 h-2 bg-slate-900 rounded-full overflow-hidden">
                        <div
                            className={cn(
                                "h-full rounded-full transition-all",
                                isViolation ? "bg-red-500" : "bg-emerald-500"
                            )}
                            style={{ width: `${Math.min((value / (limit * 1.5)) * 100, 100)}%` }}
                        />
                    </div>
                    <div className="text-[10px] text-white/30 mt-1">
                        {isViolation ? `Below ${limit}h minimum` : `Above ${limit}h minimum`}
                    </div>
                </>
            ) : (
                <div className="text-white/30 text-lg">No shift</div>
            )}
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="text-xs text-white/50">
                Short rest gap detected. Employees need at least {limit} hours rest between shifts on consecutive days.
            </div>

            <div className="grid grid-cols-2 gap-4">
                <GapCard
                    label="Gap from Previous Day"
                    value={prevGap}
                    isViolation={prevGap !== null && prevGap < limit}
                />
                <GapCard
                    label="Gap to Next Day"
                    value={nextGap}
                    isViolation={nextGap !== null && nextGap < limit}
                />
            </div>
        </div>
    );
}

// -----------------------------------------------------------------------------
// STUDENT VISA VISUALIZATION
// -----------------------------------------------------------------------------

function StudentVisaViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const limit = calc.limit || 48;
    const isWarning = result.status === 'warning';
    const isFail = result.status === 'fail';

    // Check if we have new format (weeks object) or old format (prev/curr/next)
    const hasNewFormat = calc.weeks && typeof calc.weeks === 'object' && !Array.isArray(calc.weeks);

    if (hasNewFormat) {
        // NEW FORMAT: calc.weeks is {"2026-W42": {hours: 28, dates: "14 Oct - 20 Oct" }, ... }
        const weeksData = calc.weeks as Record<string, { hours: number; dates: string }>;
        const weekKeys = Object.keys(weeksData).sort();
        const windowsEvaluated = (calc.windows_evaluated || []) as Array<{ weeks: string[]; hours: number; status: string }>;
        const violations = (calc.violations || []) as Array<{ weeks: string[]; hours: number }>;

        // Find violating weeks
        const violatingWeeks = new Set<string>();
        violations.forEach(v => v.weeks.forEach(w => violatingWeeks.add(w)));

        // Find worst window
        const worstWindow = windowsEvaluated.length > 0
            ? windowsEvaluated.reduce((w, curr) => curr.hours > w.hours ? curr : w, windowsEvaluated[0])
            : null;

        const maxHours = Math.max(...Object.values(weeksData).map(w => w.hours), 30);

        return (
            <div className="space-y-5">
                <div className="text-xs text-white/50">
                    Employee cannot work more than {limit} hours in any rolling fortnight.
                    {isFail && (
                        <span className="text-red-400 font-medium"> The combined hours exceed this limit.</span>
                    )}
                </div>

                {/* Weekly breakdown */}
                <div className="space-y-3 max-h-48 overflow-y-auto pr-2">
                    {weekKeys.map((weekKey, idx) => {
                        const weekData = weeksData[weekKey];
                        const barWidth = (weekData.hours / maxHours) * 100;
                        const isViolating = violatingWeeks.has(weekKey);

                        // Extract week number from key (e.g., "2026-W42" -> "W42")
                        const weekLabel = weekKey.split('-')[1] || weekKey;

                        return (
                            <div key={`${weekKey}-${idx}`} className="flex items-center gap-4">
                                <div className="w-24 flex-shrink-0">
                                    <div className={cn(
                                        "text-sm font-medium",
                                        isViolating ? "text-red-400" : "text-white/70"
                                    )}>
                                        {weekLabel}
                                    </div>
                                    <div className="text-[10px] text-white/30">{weekData.dates}</div>
                                </div>

                                <div className="flex-1 h-3 bg-slate-800/50 rounded-full overflow-hidden">
                                    <div
                                        className={cn(
                                            "h-full transition-all rounded-full relative",
                                            isViolating
                                                ? "bg-gradient-to-r from-red-600 to-red-500"
                                                : "bg-slate-600"
                                        )}
                                        style={{ width: `${barWidth}%` }}
                                    >
                                        {isViolating && (
                                            <div className="absolute inset-0 bg-red-400/30 blur-sm" />
                                        )}
                                    </div>
                                </div>

                                <div className={cn(
                                    "w-12 text-right text-sm font-bold",
                                    isViolating ? "text-red-400" : "text-white/70"
                                )}>
                                    {weekData.hours}h
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Calculation footer */}
                <div className={cn(
                    "p-4 rounded-xl border flex items-center justify-between backdrop-blur-sm",
                    isFail
                        ? "bg-red-950/20 border-red-500/30"
                        : "bg-slate-800/30 border-white/5"
                )}>
                    <div className="flex items-center gap-2 text-xs text-white/50">
                        <div className={cn("h-2 w-2 rounded-full", isFail ? "bg-red-500 animate-pulse" : "bg-white/20")} />
                        {worstWindow ? (
                            <span>Peak: {worstWindow.weeks[0]} + {worstWindow.weeks[1]}</span>
                        ) : (
                            <span>No windows evaluated</span>
                        )}
                    </div>
                    <div className="flex items-baseline gap-3">
                        <span className="text-xs text-white/40 uppercase tracking-wider">Total Window</span>
                        <span className={cn(
                            "text-3xl font-bold tracking-tight",
                            isFail ? "text-red-400" : "text-white"
                        )}>
                            {worstWindow?.hours || 0}h
                        </span>
                        <span className="text-sm text-white/30">/ {limit}h</span>
                    </div>
                </div>
            </div>
        );
    }

    // Fallback for old data format
    return <DefaultViz result={result} />;
}

// -----------------------------------------------------------------------------
// MAX CONSECUTIVE DAYS VISUALIZATION
// -----------------------------------------------------------------------------

function MaxConsecutiveDaysViz({ result }: { result: ComplianceResult }) {
    const calc = result.calculation;
    const streakDays = calc.streak_days || 0;
    const limit = calc.limit || 20;
    const streakStart = calc.streak_start;
    const streakEnd = calc.streak_end;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <div className={cn("text-4xl font-bold tracking-tighter", result.status === 'fail' ? "text-red-400" : "text-white")}>
                        {streakDays}<span className="text-lg text-white/30 font-normal ml-1">days</span>
                    </div>
                    <div className="text-xs text-white/40 font-medium uppercase tracking-wider mt-1">Current Streak</div>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-bold text-white/10">{limit}</div>
                    <div className="text-[10px] text-white/20 uppercase">Max Allowed</div>
                </div>
            </div>

            {/* 20-Day Grid Visualization */}
            <div className="grid grid-cols-10 gap-1.5">
                {Array.from({ length: 20 }).map((_, i) => {
                    const dayNum = i + 1;
                    const isActive = dayNum <= streakDays;
                    const isOverLimit = dayNum > limit;

                    return (
                        <div
                            key={i}
                            className={cn(
                                "aspect-square rounded-md flex items-center justify-center text-xs font-bold transition-all",
                                isActive
                                    ? isOverLimit ? "bg-red-500 text-white" : "bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/20"
                                    : "bg-white/5 text-white/10 border border-white/5"
                            )}
                        >
                            {dayNum}
                        </div>
                    );
                })}
            </div>

            {streakStart && streakEnd && (
                <div className="flex items-center gap-3 text-sm p-3 bg-white/5 rounded-lg border border-white/5 text-white/60">
                    <Calendar className="h-4 w-4 text-emerald-400" />
                    <span>{format(parseISO(streakStart), 'MMMM d')}</span>
                    <span className="text-white/20">→</span>
                    <span>{format(parseISO(streakEnd), 'MMMM d')}</span>
                </div>
            )}
        </div>
    );
}



// -----------------------------------------------------------------------------
// DEFAULT VISUALIZATION
// -----------------------------------------------------------------------------

function DefaultViz({ result }: { result: ComplianceResult }) {
    return (
        <div className="space-y-3">
            <div className="text-sm text-white/70">{result.details}</div>
            {result.calculation && Object.keys(result.calculation).length > 0 && (
                <div className="p-3 bg-slate-900/50 rounded-lg border border-white/10">
                    <pre className="text-xs text-white/50 overflow-x-auto">
                        {JSON.stringify(result.calculation, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
}

export default ComplianceTabContent;