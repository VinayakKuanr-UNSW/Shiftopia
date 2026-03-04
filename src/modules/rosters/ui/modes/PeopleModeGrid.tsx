import React, { useMemo } from 'react';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { Plus, MoreHorizontal, Undo2, Edit2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { SmartShiftCard, type ComplianceInfo } from '@/modules/rosters/ui/components/SmartShiftCard';
import { AvailabilityBar } from '@/modules/rosters/ui/components/AvailabilityBar';
import { useResolvedAvailability } from '@/modules/rosters/hooks/useResolvedAvailability';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import { PeopleModeEmployee, PeopleModeShift } from './people-mode.types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';

/* ============================================================
   INTERFACES
   ============================================================ */

// Re-export for backward compatibility if needed, or just use the imported ones
export type EmployeeShift = PeopleModeShift;
export type Employee = PeopleModeEmployee;

// ── canUnpublish — any Published shift can be unpublished (→ S1 or S2) ───────
function canUnpublish(shift: PeopleModeShift): boolean {
  return shift.lifecycleStatus === 'published';
}

interface PeopleModeGridProps {
  employees: PeopleModeEmployee[];
  dates: Date[];
  canEdit: boolean;
  showAvailabilities: boolean;
  bulkModeActive?: boolean;
  selectedShifts?: string[];
  onToggleShiftSelection?: (shiftId: string) => void;
  onAddShift: (employee: PeopleModeEmployee, date: Date) => void;
  onViewShift?: (shift: PeopleModeShift) => void;
  /** Compliance data map: shiftId -> ComplianceInfo */
  complianceMap?: Record<string, ComplianceInfo>;
  /** Card variant: compact (default) or detailed */
  cardVariant?: 'compact' | 'detailed';
  // Interactive Handlers
  onBidShift?: (shiftId: string) => void;
  onSwapShift?: (shiftId: string) => void;
  onCancelShift?: (shiftId: string) => void;
  onUnpublishShift?: (shiftId: string) => void;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export const PeopleModeGrid: React.FC<PeopleModeGridProps> = ({
  employees,
  dates,
  canEdit,
  showAvailabilities,
  bulkModeActive = false,
  selectedShifts = [],
  onToggleShiftSelection,
  onAddShift,
  onViewShift,
  complianceMap,
  cardVariant = 'compact',
  onBidShift,
  onSwapShift,
  onCancelShift,
  onUnpublishShift,
}) => {
  const buildShiftMenu = (shift: PeopleModeShift) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="h-4 w-4 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-white/20 rounded transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3 w-3 text-slate-500 dark:text-white/60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-white dark:bg-[#1a2744] border-slate-200 dark:border-white/10 min-w-[160px] z-50">
        <DropdownMenuItem
          onClick={() => onViewShift?.(shift)}
          className="text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
        >
          <Edit2 className="h-4 w-4 mr-2" />
          Edit Shift
        </DropdownMenuItem>

        {canUnpublish(shift) && onUnpublishShift && (
          <>
            <DropdownMenuSeparator className="bg-slate-200 dark:bg-white/10" />
            <DropdownMenuItem
              onClick={() => onUnpublishShift(shift.id)}
              className="text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 cursor-pointer"
            >
              <Undo2 className="h-4 w-4 mr-2" />
              Unpublish Shift
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  // Get all profile IDs for availability lookup
  const profileIds = useMemo(() => employees.map(e => e.id), [employees]);

  // Fetch resolved availability from database
  const { getAvailability, isLoading: availabilityLoading } = useResolvedAvailability(
    profileIds,
    dates,
    showAvailabilities // Only fetch when availabilities are shown
  );

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-6">
          {/* ==================== TABLE CONTAINER ==================== */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse relative">
                {/* ==================== HEADER ROW ==================== */}
                <thead>
                  <tr className="bg-muted/30">
                    {/* Employee Column Header */}
                    <th className="sticky left-0 z-10 bg-muted/30 border-r border-b border-border px-4 py-3 text-left font-medium text-sm min-w-[200px]">
                      Employee
                    </th>

                    {/* Date Column Headers */}
                    {dates.map((date, idx) => (
                      <th
                        key={idx}
                        className={cn(
                          'border-b border-border px-3 py-3 text-center font-medium text-sm min-w-[160px]',
                          idx < dates.length - 1 && 'border-r'
                        )}
                      >
                        <div className="font-semibold">{format(date, 'EEE')}</div>
                        <div className="text-xs text-muted-foreground font-normal">
                          {format(date, 'MMM d')}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* ==================== BODY ROWS ==================== */}
                <tbody>
                  {employees.map((employee, empIdx) => (
                    <tr
                      key={employee.id}
                      className={cn(
                        'hover:bg-muted/20 transition-colors',
                        empIdx < employees.length - 1 && 'border-b border-border'
                      )}
                    >
                      {/* ========== EMPLOYEE INFO CELL ========== */}
                      <td className="sticky left-0 z-10 bg-background border-r border-border px-4 py-3 align-top">
                        <div className="flex items-center gap-3">
                          <Avatar className={cn(
                            'h-10 w-10 shrink-0 ring-2 ring-offset-1',
                            employee.overHoursWarning
                              ? 'ring-amber-400/70'
                              : 'ring-transparent'
                          )}>
                            <AvatarImage src={employee.avatar} alt={employee.name} />
                            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                              {employee.name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>

                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">
                              {employee.name}
                            </div>
                            <div className="text-[10px] tracking-[0.08em] uppercase font-mono text-muted-foreground/70">
                              {employee.employeeId}
                            </div>
                            {/* Hours capacity strip */}
                            <div className="mt-1.5 space-y-0.5">
                              <div className="flex items-center justify-between">
                                <span className={cn(
                                  'text-[10px] font-mono tabular-nums',
                                  employee.overHoursWarning ? 'text-amber-400' : 'text-muted-foreground'
                                )}>
                                  {employee.currentHours.toFixed(1)}h
                                  <span className="text-muted-foreground/50"> / {employee.contractedHours}h</span>
                                </span>
                                {employee.overHoursWarning && (
                                  <span className="text-[9px] font-mono tracking-wider text-amber-400 uppercase">
                                    OT
                                  </span>
                                )}
                              </div>
                              {/* Progress bar */}
                              <div className="h-[3px] w-full bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    'h-full rounded-full transition-all duration-500',
                                    employee.overHoursWarning ? 'bg-amber-400' : 'bg-primary/60'
                                  )}
                                  style={{
                                    width: `${Math.min(100, employee.contractedHours > 0
                                      ? (employee.currentHours / employee.contractedHours) * 100
                                      : 0
                                    )}%`
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* ========== DATE CELLS ========== */}
                      {dates.map((date, dateIdx) => {
                        const dateKey = format(date, 'yyyy-MM-dd');
                        const shifts = employee.shifts[dateKey] ?? [];

                        // Get availability for this employee on this date
                        const availability = getAvailability(
                          employee.id,
                          dateKey
                        );

                        return (
                          <td
                            key={dateIdx}
                            className={cn(
                              'px-3 py-3 align-top',
                              dateIdx < dates.length - 1 && 'border-r border-border',
                              canEdit && !bulkModeActive && 'cursor-pointer hover:bg-primary/5'
                            )}
                            onClick={() => {
                              if (canEdit && !bulkModeActive && shifts.length === 0) {
                                onAddShift(employee, date);
                              }
                            }}
                          >
                            <div className={cn(
                              'space-y-2',
                              // Minimum height ensures consistent spacing
                              showAvailabilities ? 'min-h-[110px]' : 'min-h-[80px]'
                            )}>
                              {/* ========== SHIFTS ========== */}
                              {shifts.length > 0 ? (
                                shifts.map((shift) => (
                                  <SmartShiftCard
                                    key={shift.id}
                                    headerAction={canEdit && !bulkModeActive ? buildShiftMenu(shift) : undefined}
                                    shift={shift.rawShift || ({
                                      id: shift.id,
                                      start_time: shift.startTime,
                                      end_time: shift.endTime,
                                      lifecycle_status: shift.lifecycleStatus === 'published' ? 'Published' : 'Draft',
                                      assigned_employee_id: shift.assignmentStatus === 'assigned' ? employee.id : null,
                                      bidding_status: shift.fulfillmentStatus === 'bidding' ? 'on_bidding_normal' : 'not_on_bidding',
                                      is_trade_requested: shift.isTradeRequested,
                                      is_cancelled: shift.isCancelled,
                                      sub_group_name: shift.subGroup,
                                      required_skills: shift.requiredSkills || [],
                                      roles: { id: '', name: shift.role },
                                      assigned_profiles: { first_name: employee.name.split(' ')[0], last_name: employee.name.split(' ').slice(1).join(' ') },
                                    } as any)}
                                    variant={cardVariant}
                                    groupColor={shift.groupColor || 'blue'}
                                    compliance={complianceMap?.[shift.id]}
                                    isSelected={selectedShifts.includes(shift.id)}
                                    onClick={(e) => {
                                      if (bulkModeActive) {
                                        onToggleShiftSelection?.(shift.id);
                                      } else {
                                        onViewShift?.(shift);
                                      }
                                    }}
                                    isLocked={isShiftLocked(dateKey, shift.startTime, 'roster_management')}
                                  />
                                ))
                              ) : (
                                /* Empty state — Data Ops dashed ring */
                                !bulkModeActive &&
                                canEdit && (
                                  <button
                                    className="w-full flex items-center justify-center gap-1 py-4 rounded border border-dashed border-slate-300 dark:border-white/10 text-[11px] font-mono text-slate-300 dark:text-white/25 transition-all hover:border-slate-400 dark:hover:border-white/25 hover:text-slate-500 dark:hover:text-white/50 hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAddShift(employee, date);
                                    }}
                                  >
                                    <Plus className="h-3 w-3" />
                                    add
                                  </button>
                                )
                              )}

                              {/* Add another shift when cell already has shifts */}
                              {shifts.length > 0 && canEdit && !bulkModeActive && (
                                <button
                                  className="w-full flex items-center justify-center gap-1 py-1 rounded border border-dashed border-slate-200 dark:border-white/[0.07] text-[10px] font-mono text-slate-300 dark:text-white/20 transition-all hover:border-slate-300 dark:hover:border-white/20 hover:text-slate-400 dark:hover:text-white/40"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAddShift(employee, date);
                                  }}
                                >
                                  <Plus className="h-2.5 w-2.5" />
                                  add
                                </button>
                              )}

                              {/* ========== AVAILABILITY BAR ========== */}
                              {showAvailabilities && (
                                <AvailabilityBar
                                  availability={availability}
                                  className="pt-1"
                                />
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default PeopleModeGrid;
