/**
 * GroupStatsSummary - Phase 4 Enterprise Component
 *
 * Displays aggregate statistics per visual group row:
 * - Total Hours
 * - Headcount (unique assigned employees)
 * - Shift count breakdown (assigned vs unassigned)
 *
 * No labour cost: money is shown in Gross Pay alone (decision 2026-10-09).
 *
 * MUST NOT:
 * - Fetch data (receives shifts as props)
 * - Mutate state
 */

import React, { useMemo } from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Clock, Users, BarChart3 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { Shift } from '../../domain/shift.entity';

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
    uniqueEmployees: number;
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

        const uniqueEmployeeIds = new Set(
            assigned.map((s) => s.assigned_employee_id).filter(Boolean)
        );

        return {
            totalShifts: activeShifts.length,
            assignedShifts: assigned.length,
            unassignedShifts: unassigned.length,
            totalHours,
            uniqueEmployees: uniqueEmployeeIds.size,
        };
    }, [shifts]);

    if (compact) {
        return (
            <div className={cn('flex items-center gap-3 text-xs', className)}>
                <span className="text-emerald-400 font-medium">{stats.totalHours.toFixed(0)}h</span>
                <span className="text-white/40">|</span>
                <span className="text-white/70">
                    <Users className="h-3 w-3 inline mr-1 text-white/60" />
                    {stats.uniqueEmployees} employee{stats.uniqueEmployees !== 1 ? 's' : ''}
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
