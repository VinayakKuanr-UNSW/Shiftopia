/**
 * GroupStatsSummary - Phase 4 Enterprise Component
 *
 * Displays aggregate statistics per visual group row:
 * - Total Hours
 * - Estimated Cost (Hours * Rate)
 * - Headcount (unique assigned employees)
 * - Shift count breakdown (assigned vs unassigned)
 *
 * MUST NOT:
 * - Fetch data (receives shifts as props)
 * - Mutate state
 */

import React, { useMemo } from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Clock, DollarSign, Users, BarChart3 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { Shift } from '../../domain/shift.entity';
import { estimateDetailedCostFromShift, formatCost } from '../../domain/projections/utils/cost';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';

// ============================================================================
// TYPES
// ============================================================================

export interface GroupStatsSummaryProps {
    shifts: Shift[];
    className?: string;
    /** Compact mode shows fewer stats (for narrow headers) */
    compact?: boolean;
}

interface GroupStats {
    totalShifts: number;
    assignedShifts: number;
    unassignedShifts: number;
    totalHours: number;
    estimatedCost: number;
    uniqueEmployees: number;
    breakdown: {
        base: number;
        penalty: number;
        overtime: number;
        allowance: number;
        leave: number;
    };
}

// ============================================================================
// COMPONENT
// ============================================================================

export const GroupStatsSummary: React.FC<GroupStatsSummaryProps> = ({
    shifts,
    className,
    compact = false,
}) => {
    const stats = useMemo((): GroupStats => {
        const activeShifts = shifts.filter((s) => !s.is_cancelled && !s.deleted_at);
        const assigned = activeShifts.filter((s) => s.assigned_employee_id);
        const unassigned = activeShifts.filter((s) => !s.assigned_employee_id);

        const totalHours = activeShifts.reduce((acc, s) => {
            return acc + (s.net_length_minutes || 0) / 60;
        }, 0);

        const breakdown = {
            base: 0,
            penalty: 0,
            overtime: 0,
            allowance: 0,
            leave: 0,
        };

        const estimatedCost = activeShifts.reduce((acc, s) => {
            const detail = estimateDetailedCostFromShift(s);
            breakdown.base += detail.ordinaryCost;
            breakdown.penalty += detail.penaltyCost;
            breakdown.overtime += detail.overtimeCost;
            breakdown.allowance += detail.allowanceCost ?? 0;
            return acc + detail.totalCost;
        }, 0);

        const uniqueEmployeeIds = new Set(
            assigned.map((s) => s.assigned_employee_id).filter(Boolean)
        );

        return {
            totalShifts: activeShifts.length,
            assignedShifts: assigned.length,
            unassignedShifts: unassigned.length,
            totalHours,
            estimatedCost,
            uniqueEmployees: uniqueEmployeeIds.size,
            breakdown,
        };
    }, [shifts]);

    if (compact) {
        return (
            <div className={cn('flex items-center gap-3 text-xs', className)}>
                <span className="text-white/70 font-medium">
                    {stats.totalShifts} shift{stats.totalShifts !== 1 ? 's' : ''}
                </span>
                <span className="text-white/40">|</span>
                <span className="text-emerald-400 font-medium">{stats.totalHours.toFixed(0)}h</span>
                <span className="text-white/40">|</span>
                <span className="text-white/70">
                    <Users className="h-3 w-3 inline mr-0.5" />
                    {stats.uniqueEmployees}
                </span>
            </div>
        );
    }

    return (
        <div className={cn('flex items-center gap-4 text-xs', className)}>
            {/* Shift count */}
            <div className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-white/50" />
                <span className="text-white/80 font-medium">{stats.totalShifts}</span>
                <span className="text-white/40">
                    ({stats.assignedShifts}
                    <span className="text-emerald-400/80"> filled</span>
                    {stats.unassignedShifts > 0 && (
                        <>, {stats.unassignedShifts}
                        <span className="text-amber-400/80"> open</span></>
                    )})
                </span>
            </div>

            {/* Hours */}
            <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-white/50" />
                <span className="text-white/80 font-medium">{stats.totalHours.toFixed(1)}h</span>
            </div>

            {/* Cost */}
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5 cursor-help hover:bg-white/5 px-1.5 py-0.5 rounded transition-colors">
                            <DollarSign className="h-3.5 w-3.5 text-white/50" />
                            <span className="text-white/80 font-medium">${stats.estimatedCost.toFixed(0)}</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent className="w-56 p-3 bg-zinc-900 border-white/10 shadow-xl" side="bottom">
                        <div className="space-y-2">
                            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Labour Cost Breakdown</p>
                            <div className="space-y-1.5">
                                <div className="flex justify-between text-xs">
                                    <span className="text-white/60">Base Pay</span>
                                    <span className="text-white font-medium">{formatCost(stats.breakdown.base)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-white/60">Penalties (Sat/Sun/Night)</span>
                                    <span className="text-emerald-400 font-medium">+{formatCost(stats.breakdown.penalty)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-white/60">Overtime</span>
                                    <span className="text-amber-400 font-medium">+{formatCost(stats.breakdown.overtime)}</span>
                                </div>
                                {stats.breakdown.allowance > 0 && (
                                    <div className="flex justify-between text-xs">
                                        <span className="text-white/60">Allowances</span>
                                        <span className="text-blue-400 font-medium">+{formatCost(stats.breakdown.allowance)}</span>
                                    </div>
                                )}
                                {stats.breakdown.leave > 0 && (
                                    <div className="flex justify-between text-xs">
                                        <span className="text-white/60">Leave Loading</span>
                                        <span className="text-purple-400 font-medium">+{formatCost(stats.breakdown.leave)}</span>
                                    </div>
                                )}
                                <div className="pt-2 border-t border-white/10 flex justify-between text-sm font-bold">
                                    <span className="text-white">Total Estimate</span>
                                    <span className="text-white">{formatCost(stats.estimatedCost)}</span>
                                </div>
                            </div>
                            <p className="text-[10px] text-white/30 italic mt-2 leading-tight">
                                Estimates based on MA000080 Award interpretation rules.
                            </p>
                        </div>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            {/* Headcount */}
            <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-white/50" />
                <span className="text-white/80 font-medium">{stats.uniqueEmployees}</span>
                <span className="text-white/40">people</span>
            </div>
        </div>
    );
};

export default GroupStatsSummary;
