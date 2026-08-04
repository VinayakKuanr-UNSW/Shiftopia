import React from 'react';
import {
  Calendar,
  Clock,
  Coffee,
  Megaphone,
  UserPlus,
  UserCheck as LucideUserCheck,
  Circle,
  Gavel,
  Flame,
  Minus,
  CheckSquare,
  Square,
  Users,
} from 'lucide-react';
import { SharedShiftCard } from '../../../../ui/components/SharedShiftCard';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';

import type { ManagerBidShift, OpenShift, TimeRemaining } from './types';
import { formatTimeRemaining } from './utils';
// `.../utils/cost` resolves to cost.ts — the LEGACY positional-argument
// variant. This file calls the object-options form, so it must import the
// barrel explicitly (same as auto-scheduler.controller.ts). Resolution
// preferring cost.ts over cost/index.ts made this a silent mismatch.
import { estimateDetailedShiftCost } from '@/modules/rosters/domain/projections/utils/cost/index';
import type { EarningsLine } from '@/modules/payroll/model/gross-pay.types';

interface ShiftCardProps {
  /** `group.items` is `ManagerBidShift[]`; this card only reads `group` and
   *  `location` from the wider `OpenShift`, and both already have `||`
   *  fallbacks. Narrowing the prop instead of forcing a cast keeps the call
   *  site honest about what is actually guaranteed. */
  shift: ManagerBidShift & Partial<OpenShift>;
  isSelected: boolean;
  onClick: () => void;
  timeRemaining: TimeRemaining;
  isBulkMode?: boolean;
  isBulkSelected?: boolean;

}

export const ShiftCard: React.FC<ShiftCardProps> = ({
  shift,
  isSelected,
  onClick,
  timeRemaining,
  isBulkMode = false,
  isBulkSelected = false,

}) => {
  // Net duration
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  let durationMins = (eh * 60 + em) - (sh * 60 + sm);
  if (durationMins < 0) durationMins += 24 * 60;
  const netMins = durationMins - shift.unpaidBreak;

  // Venue-inherited card theming (mirrors index.tsx getGroupVariant)
  const g = (shift.groupType || shift.group || '').toLowerCase();
  const d = (shift.department || '').toLowerCase();
  const groupVariant =
    g.includes('convention') || d.includes('convention') ? 'convention' :
    g.includes('exhibition') || d.includes('exhibition') ? 'exhibition' :
    g.includes('theatre') || g.includes('theater') || d.includes('theatre') || d.includes('theater') ? 'theatre' :
    g.includes('cutaway') || d.includes('cutaway') ? 'cutaway' :
    'default';

  const bidsCount = shift.bidCount ?? (shift as any).bidsCount ?? 0;
  const assignedName = shift.assignedEmployeeName || (shift as any).assigned_employee_name || (shift as any).employeeName;
  const isAssigned = !!(shift.assignedEmployeeId || assignedName);

  const costBreakdown = React.useMemo(() => {
    try {
      const detailed = estimateDetailedShiftCost({
        netMinutes: netMins,
        start_time: shift.startTime,
        end_time: shift.endTime,
        rate: (shift as any).remuneration_rate ?? (shift as any).hourlyRate ?? null,
        scheduled_length_minutes: durationMins,
        is_overnight: (shift as any).is_overnight ?? false,
        is_cancelled: false,
        shift_date: shift.date,
        unpaid_break_minutes: shift.unpaidBreak,
        isSecurityRole: (shift.role || '').toLowerCase().includes('security'),
      });
      if (!detailed || !detailed.totalCost) return null;

      const lines: EarningsLine[] = [];
      if (detailed.ordinaryCost > 0) {
        lines.push({
          code: 'ordinary',
          description: 'Ordinary Rate',
          hours: detailed.ordinaryHours,
          amount: detailed.ordinaryCost,
        });
      }
      if (detailed.overtimeCost > 0) {
        lines.push({
          code: 'overtime',
          description: 'Overtime Rate',
          hours: detailed.overtimeHours,
          amount: detailed.overtimeCost,
        });
      }
      if (detailed.penaltyCost > 0) {
        lines.push({
          code: 'penalty',
          description: 'Penalty Rates',
          amount: detailed.penaltyCost,
        });
      }
      if (detailed.allowanceCost && detailed.allowanceCost > 0) {
        lines.push({
          code: 'other_allowance',
          description: 'Meal Allowance',
          amount: detailed.allowanceCost,
        });
      }

      return {
        formattedPay: `$${detailed.totalCost.toFixed(2)}`,
        lines,
      };
    } catch {
      return null;
    }
  }, [netMins, durationMins, shift.startTime, shift.endTime, shift.date, shift.unpaidBreak, shift.role, (shift as any).remuneration_rate, (shift as any).hourlyRate]);

  const footerActions = (
    <div className="flex flex-col gap-2 mt-2 w-full">
      {isAssigned ? (
        <div className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-black uppercase tracking-wider">
          <LucideUserCheck className="h-4 w-4 shrink-0" />
          Assigned to {assignedName || 'Employee'}
        </div>
      ) : bidsCount > 0 ? (
        <Button
          className="w-full font-black text-xs uppercase tracking-wider h-10 rounded-xl transition-all shadow-md active:scale-[0.98] bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/30"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          <Users className="mr-2 h-4 w-4" /> Review Bids ({bidsCount})
        </Button>
      ) : (
        <div className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-muted/20 border border-border/30 text-muted-foreground/50 text-xs font-bold uppercase tracking-wider">
          <Clock className="h-3.5 w-3.5 shrink-0" /> No Bids Placed
        </div>
      )}
    </div>
  );

  return (
    <SharedShiftCard
        variant="timecard"
        hideActualClocking={true}
        hidePayrollSection={true}
        defaultExpandedSections={{ scheduled: true }}
        groupVariant={groupVariant}
        organization={shift.organization || shift.location || 'ICC Sydney'}
        department={shift.department}
        subGroup={shift.subDepartment}
        role={shift.role}
        employeeName={assignedName}
        estimatedPay={costBreakdown?.formattedPay || (shift as any).estimatedPay || (shift as any).estimated_pay}
        estimatedPayBreakdown={costBreakdown?.lines}
        shiftDate={shift.date}
        startTime={shift.startTime}
        endTime={shift.endTime}
        netLength={netMins}
        paidBreak={shift.paidBreak}
        unpaidBreak={shift.unpaidBreak}
        timerText={timeRemaining.isExpired ? 'Bidding Closed' : `Closes in ${formatTimeRemaining(timeRemaining)}`}
        isExpired={timeRemaining.isExpired}
        isUrgent={shift.isUrgent || shift.toggle === 'urgent'}
        lifecycleStatus={shift.lifecycleStatus || 'Published'}
        footerActions={footerActions}
        shiftData={shift}

        topContent={
            isBulkMode ? (
                <div className="flex flex-col gap-2 w-full">
                    <div className="flex items-center gap-2">
                        <span className="text-cyan-400/80">
                          {isBulkSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider">
                            {isBulkSelected ? 'Selected' : 'Select'}
                        </span>
                    </div>
                </div>
            ) : undefined
        }
        className={cn(
            isSelected && !isBulkMode && 'bg-primary/5 border-l-4 border-l-primary shadow-inner',
            isBulkSelected && 'bg-primary/10 border-l-4 border-l-primary shadow-inner'
        )}
        onClick={bidsCount > 0 ? onClick : undefined}
    />
  );
};
