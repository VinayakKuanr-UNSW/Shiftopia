import React, { useMemo } from 'react';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { Plus } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { SmartShiftCard, type ComplianceInfo } from '@/modules/rosters/ui/components/SmartShiftCard';
import { AvailabilityBar } from '@/modules/rosters/ui/components/AvailabilityBar';
import { useResolvedAvailability } from '@/modules/rosters/hooks/useResolvedAvailability';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import { isShiftLocked } from '@/modules/rosters/domain/policies/canEditShift.policy';
import { PeopleModeEmployee, PeopleModeShift } from './people-mode.types';

/* ============================================================
   INTERFACES
   ============================================================ */

// Re-export for backward compatibility if needed, or just use the imported ones
export type EmployeeShift = PeopleModeShift;
export type Employee = PeopleModeEmployee;

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
}) => {
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
              <table className="w-full border-collapse">
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
                          <Avatar className="h-10 w-10 shrink-0">
                            <AvatarImage src={employee.avatar} alt={employee.name} />
                            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                              {employee.name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>

                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {employee.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              ID: {employee.employeeId}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {employee.currentHours}h / {employee.contractedHours}h
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
                                    isLocked={isShiftLocked(date, shift.endTime)}
                                  />
                                ))
                              ) : (
                                /* Empty state - show Add Shift button */
                                !bulkModeActive &&
                                canEdit && (
                                  <button
                                    className="w-full text-xs text-primary hover:underline flex items-center justify-center gap-1 py-4"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAddShift(employee, date);
                                    }}
                                  >
                                    <Plus className="h-3 w-3" />
                                    Add Shift
                                  </button>
                                )
                              )}

                              {/* Add Shift button when there are existing shifts */}
                              {shifts.length > 0 && canEdit && !bulkModeActive && (
                                <button
                                  className="w-full text-xs text-primary/70 hover:text-primary hover:underline flex items-center justify-center gap-1 py-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAddShift(employee, date);
                                  }}
                                >
                                  <Plus className="h-3 w-3" />
                                  Add Shift
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
