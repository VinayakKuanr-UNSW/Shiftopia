/**
 * Enhanced Compliance Modal Component
 * 
 * Features:
 * - Shows all registered rules with status (Pass | Fail | Not Run)
 * - Run button per rule for manual execution
 * - Calculation breakdown per rule
 * - Clear explanation of each rule
 */

import React, { useState, useCallback } from 'react';
import { X, CheckCircle, XCircle, AlertTriangle, Info, Play, Circle, Loader2 } from 'lucide-react';
import {
    ComplianceCheckResult,
    ComplianceResult,
    ComplianceCheckInput
} from '../types';
import { getRegisteredRules, runRule } from '../engine';
import { cn } from '@/modules/core/lib/utils';

// =============================================================================
// TYPES
// =============================================================================

type RuleStatus = 'pass' | 'fail' | 'warning' | 'not-run';

interface RuleDisplayState {
    ruleId: string;
    ruleName: string;
    description: string;
    blocking: boolean;
    status: RuleStatus;
    result: ComplianceResult | null;
    isRunning: boolean;
}

// =============================================================================
// PROPS
// =============================================================================

interface ComplianceModalProps {
    isOpen: boolean;
    onClose: () => void;
    result?: ComplianceCheckResult | null;
    input?: ComplianceCheckInput | null;  // For manual rule execution
    title?: string;
}

// =============================================================================
// RULE CARD COMPONENT
// =============================================================================

function RuleCard({
    ruleState,
    onRun
}: {
    ruleState: RuleDisplayState;
    onRun: (ruleId: string) => void;
}) {
    const { status, result, isRunning, ruleName, description, blocking } = ruleState;

    const statusConfig = {
        'pass': {
            icon: CheckCircle,
            colors: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
            label: 'Passed'
        },
        'fail': {
            icon: XCircle,
            colors: 'text-red-400 bg-red-500/10 border-red-500/20',
            label: 'Failed'
        },
        'warning': {
            icon: AlertTriangle,
            colors: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
            label: 'Warning'
        },
        'not-run': {
            icon: Circle,
            colors: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
            label: 'Not Run'
        }
    };

    const config = statusConfig[status];
    const StatusIcon = config.icon;

    return (
        <div className={cn(
            'rounded-lg border p-4 transition-all',
            config.colors
        )}>
            {/* Header with Rule Name and Run Button */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                    <StatusIcon className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-medium text-white">{ruleName}</h4>
                            <span className={cn(
                                'text-xs px-2 py-0.5 rounded',
                                status === 'not-run' ? 'bg-gray-500/20 text-gray-400' :
                                    status === 'pass' ? 'bg-emerald-500/20 text-emerald-300' :
                                        status === 'fail' ? 'bg-red-500/20 text-red-300' :
                                            'bg-amber-500/20 text-amber-300'
                            )}>
                                {config.label}
                            </span>
                            {blocking && (
                                <span className="text-xs px-2 py-0.5 rounded bg-slate-500/20 text-slate-400 border border-slate-500/30">
                                    Blocking
                                </span>
                            )}
                        </div>
                        <p className="text-sm mt-1 text-gray-400">{description}</p>
                    </div>
                </div>

                {/* Run Button */}
                <button
                    onClick={() => onRun(ruleState.ruleId)}
                    disabled={isRunning}
                    className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                        'bg-blue-500/20 text-blue-300 border border-blue-500/30',
                        'hover:bg-blue-500/30 hover:text-blue-200',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                >
                    {isRunning ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                        <Play className="w-3.5 h-3.5" />
                    )}
                    Run
                </button>
            </div>

            {/* Result Details */}
            {result && status !== 'not-run' && (
                <>
                    {/* Summary */}
                    <div className="mt-3 p-2 rounded bg-black/20">
                        <p className="text-sm">{result.summary}</p>
                        {result.details && (
                            <p className="text-xs text-gray-400 mt-1">{result.details}</p>
                        )}
                    </div>

                    {/* Calculation breakdown */}
                    {result.calculation && (
                        <div className="mt-3 pt-3 border-t border-gray-700/50">
                            <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
                                <Info className="w-3.5 h-3.5" />
                                <span className="font-medium">Calculation</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                {/* Day Count (Specific to Working Days Cap) */}
                                {result.calculation.day_count !== undefined && (
                                    <div className="flex justify-between bg-slate-800/50 rounded px-2 py-1 col-span-2">
                                        <span className="text-gray-400">Working Days (28d period):</span>
                                        <span className={cn(
                                            'font-mono font-bold',
                                            result.calculation.day_count > (result.calculation.limit || 20)
                                                ? 'text-red-400'
                                                : 'text-emerald-400'
                                        )}>
                                            {result.calculation.day_count} days
                                        </span>
                                    </div>
                                )}

                                {/* Hourly calculations (Hide if all zero/irrelevant, e.g. for Day Cap) */}
                                {(result.calculation.total_hours !== undefined && result.calculation.total_hours > 0 || result.calculation.candidate_hours > 0) && (
                                    <>
                                        {result.calculation.existing_hours !== undefined && result.calculation.existing_hours > 0 && (
                                            <div className="flex justify-between bg-slate-800/50 rounded px-2 py-1">
                                                <span className="text-gray-400">Existing:</span>
                                                <span className="text-white font-mono">{result.calculation.existing_hours.toFixed(1)}h</span>
                                            </div>
                                        )}
                                        {result.calculation.candidate_hours !== undefined && result.calculation.candidate_hours > 0 && (
                                            <div className="flex justify-between bg-slate-800/50 rounded px-2 py-1">
                                                <span className="text-gray-400">This shift:</span>
                                                <span className="text-white font-mono">{result.calculation.candidate_hours.toFixed(1)}h</span>
                                            </div>
                                        )}
                                        {result.calculation.total_hours !== undefined && (
                                            <div className="flex justify-between bg-slate-800/50 rounded px-2 py-1">
                                                <span className="text-gray-400">Total:</span>
                                                <span className={cn(
                                                    'font-mono font-bold',
                                                    result.calculation.limit && result.calculation.total_hours > result.calculation.limit
                                                        ? 'text-red-400'
                                                        : 'text-emerald-400'
                                                )}>
                                                    {result.calculation.total_hours.toFixed(1)}h
                                                </span>
                                            </div>
                                        )}
                                    </>
                                )}

                                {result.calculation.limit !== undefined && (
                                    <div className="flex justify-between bg-slate-800/50 rounded px-2 py-1">
                                        <span className="text-gray-400">Limit:</span>
                                        <span className="text-white font-mono">
                                            {result.calculation.limit}
                                            {result.calculation.day_count !== undefined ? ' days' : 'h'}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// =============================================================================
// MAIN MODAL COMPONENT
// =============================================================================

export function ComplianceModal({
    isOpen,
    onClose,
    result,
    input,
    title = 'Compliance Check Details'
}: ComplianceModalProps) {
    // Build initial rule states from registered rules + any existing results
    const buildRuleStates = useCallback((): RuleDisplayState[] => {
        const registeredRules = getRegisteredRules();

        return registeredRules.map(rule => {
            // Find existing result if available
            const existingResult = result?.results.find(r => r.rule_id === rule.id);

            return {
                ruleId: rule.id,
                ruleName: rule.name,
                description: rule.description,
                blocking: rule.blocking,
                status: existingResult?.status || 'not-run',
                result: existingResult || null,
                isRunning: false
            };
        });
    }, [result]);

    const [ruleStates, setRuleStates] = useState<RuleDisplayState[]>(buildRuleStates);

    // Update rule states when result changes
    React.useEffect(() => {
        setRuleStates(buildRuleStates());
    }, [result, buildRuleStates]);

    // Run a single rule
    const handleRunRule = useCallback((ruleId: string) => {
        if (!input) {
            console.warn('[ComplianceModal] Cannot run rule - no input provided');
            return;
        }

        // Set running state
        setRuleStates(prev => prev.map(r =>
            r.ruleId === ruleId ? { ...r, isRunning: true } : r
        ));

        // Run the rule (slight delay for UI feedback)
        setTimeout(() => {
            const ruleResult = runRule(ruleId, input);

            setRuleStates(prev => prev.map(r => {
                if (r.ruleId !== ruleId) return r;

                return {
                    ...r,
                    isRunning: false,
                    status: ruleResult?.status || 'not-run',
                    result: ruleResult
                };
            }));
        }, 100);
    }, [input]);

    // Run all rules
    const handleRunAll = useCallback(() => {
        if (!input) return;

        ruleStates.forEach(r => handleRunRule(r.ruleId));
    }, [input, ruleStates, handleRunRule]);

    if (!isOpen) return null;

    // Compute overall status from current rule states
    const runResults = ruleStates.filter(r => r.status !== 'not-run');
    const hasBlockingFail = ruleStates.some(r => r.status === 'fail' && r.blocking);
    const hasWarning = ruleStates.some(r => r.status === 'warning');
    const allPassed = runResults.length > 0 && runResults.every(r => r.status === 'pass');

    const overallStatus = hasBlockingFail ? 'fail' : hasWarning ? 'warning' : allPassed ? 'pass' : 'not-run';

    const headerColors = {
        'pass': 'from-emerald-600/20 to-transparent border-emerald-500/30',
        'fail': 'from-red-600/20 to-transparent border-red-500/30',
        'warning': 'from-amber-600/20 to-transparent border-amber-500/30',
        'not-run': 'from-slate-600/20 to-transparent border-slate-500/30'
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative w-full max-w-lg mx-4 bg-slate-900 rounded-xl shadow-2xl border border-slate-700 overflow-hidden">
                {/* Header */}
                <div className={cn(
                    'px-6 py-4 border-b bg-gradient-to-b',
                    headerColors[overallStatus]
                )}>
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-white">{title}</h3>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors"
                        >
                            <X className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>

                    {/* Overall status */}
                    <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {overallStatus === 'fail' && (
                                <>
                                    <XCircle className="w-5 h-5 text-red-400" />
                                    <span className="text-red-400 font-medium">Action blocked</span>
                                </>
                            )}
                            {overallStatus === 'warning' && (
                                <>
                                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                                    <span className="text-amber-400 font-medium">Proceed with caution</span>
                                </>
                            )}
                            {overallStatus === 'pass' && (
                                <>
                                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                                    <span className="text-emerald-400 font-medium">All checks passed</span>
                                </>
                            )}
                            {overallStatus === 'not-run' && (
                                <>
                                    <Circle className="w-5 h-5 text-gray-400" />
                                    <span className="text-gray-400 font-medium">No checks run</span>
                                </>
                            )}
                        </div>

                        {/* Run All Button */}
                        {input && (
                            <button
                                onClick={handleRunAll}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                            >
                                <Play className="w-3.5 h-3.5" />
                                Run All
                            </button>
                        )}
                    </div>
                </div>

                {/* Body - Rule List */}
                <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-3">
                    {ruleStates.map((ruleState) => (
                        <RuleCard
                            key={ruleState.ruleId}
                            ruleState={ruleState}
                            onRun={handleRunRule}
                        />
                    ))}

                    {ruleStates.length === 0 && (
                        <div className="text-center py-8 text-gray-400">
                            No compliance rules registered
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-700 flex justify-between items-center">
                    <span className="text-xs text-gray-500">
                        {runResults.length}/{ruleStates.length} rules evaluated
                    </span>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ComplianceModal;
