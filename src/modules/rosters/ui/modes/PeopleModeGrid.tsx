import React, { useState, useMemo, useEffect } from 'react';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { Plus, MoreHorizontal, Undo2, Edit2, History } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { SmartShiftCard, type ComplianceInfo } from '@/modules/rosters/ui/components/SmartShiftCard';
import { AvailabilityBar } from '@/modules/rosters/ui/components/AvailabilityBar';
import { useResolvedAvailability } from '@/modules/rosters/hooks/useResolvedAvailability';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import { isSydneyPast } from '@/modules/core/lib/date.utils';
import { PeopleModeEmployee, PeopleModeShift } from './people-mode.types';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
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
  onViewAudit?: (shiftId: string) => void;
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
  selectedShifts: propsSelectedShifts = [],
  onToggleShiftSelection,
  onAddShift,
  onViewShift,
  complianceMap,
  cardVariant = 'compact',
  onBidShift,
  onSwapShift,
  onCancelShift,
  onUnpublishShift,
  onViewAudit,
}) => {
  const { 
    bulkModeActive: globalBulkModeActive, 
    selectedShiftIds: globalSelectedShiftIds,
    toggleShiftSelection: globalToggleShiftSelection
  } = useRosterStore();

  const { toggleShiftSelection: uiToggleShiftSelection } = useRosterUI();

  const isBulkMode = bulkModeActive || globalBulkModeActive;
  const currentSelectedShifts = propsSelectedShifts.length > 0 ? propsSelectedShifts : globalSelectedShiftIds;

  const buildShiftMenu = (shift: PeopleModeShift) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="h-4 w-4 flex items-center justify-center hover:bg-muted dark:hover:bg-white/20 rounded transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3 w-3 text-muted-foreground dark:text-white/60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border min-w-[160px] z-50">
        <DropdownMenuItem
          onClick={() => onViewShift?.(shift)}
          className="text-popover-foreground hover:bg-accent cursor-pointer"
        >
          <Edit2 className="h-4 w-4 mr-2" />
          Edit Shift
        </DropdownMenuItem>

        {canUnpublish(shift) && onUnpublishShift && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={() => onUnpublishShift(shift.id)}
              className="text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer"
            >
              <Undo2 className="h-4 w-4 mr-2" />
              Unpublish Shift
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem
          onClick={(e) => { e.stopPropagation(); onViewAudit?.(shift.id); }}
          className="text-muted-foreground hover:bg-accent cursor-pointer"
        >
          <History className="h-4 w-4 mr-2" />
          Audit Trail
        </DropdownMenuItem>

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
                    <th className="sticky top-0 left-0 z-30 bg-muted/30 border-r border-b border-border px-4 py-3 text-left min-w-[200px]">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] font-mono">Employee</span>
                    </th>

                    {/* Date Column Headers */}
                    {dates.map((date, idx) => {
                      const dateIsToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                      return (
                        <th
                          key={idx}
                          className={cn(
                            'sticky top-0 z-20 bg-muted/30 border-b border-border px-3 py-3 text-center min-w-[160px]',
                            idx < dates.length - 1 && 'border-r',
                            dateIsToday && 'bg-primary/5'
                          )}
                        >
                          <div className={cn("text-[10px] font-bold uppercase tracking-[0.12em] font-mono", dateIsToday ? "text-primary" : "text-muted-foreground")}>{format(date, 'EEE')}</div>
                          <div className={cn("text-sm font-mono tabular-nums mt-0.5", dateIsToday ? "text-primary font-bold" : "text-muted-foreground/50 font-medium")}>
                            {format(date, 'MMM d')}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                {/* ==================== BODY ROWS ==================== */}
                <tbody>
                  {employees.map((employee, empIdx) => (
                    <tr
                      key={employee.id}
                      className={cn(
                        'group transition-colors',
                        'hover:bg-accent/30',
                        empIdx % 2 === 0 ? "bg-card" : "bg-muted/30",
                        empIdx < employees.length - 1 && 'border-b border-border'
                      )}
                    >
                      {/* ========== EMPLOYEE INFO CELL ========== */}
                      <td className="sticky left-0 z-10 bg-card group-hover:bg-accent/50 transition-colors border-r border-border px-4 py-3 align-top">
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
                              <div className="h-[3px] w-full bg-muted rounded-full overflow-hidden">
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
                              'px-3 py-3 align-top relative group/cell',
                              dateIdx < dates.length - 1 && 'border-r border-border',
                              canEdit && !isBulkMode && 'cursor-pointer'
                            )}
                            onClick={() => {
                              if (canEdit && !isBulkMode && shifts.length === 0 && !isSydneyPast(date)) {
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
                                    headerAction={canEdit && !isBulkMode ? buildShiftMenu(shift) : undefined}
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
                                    isSelected={currentSelectedShifts.includes(shift.id)}
                                    onClick={(e) => {
                                      if (isBulkMode) {
                                        // Prioritize prop-based toggle, then global store, then UI context
                                        if (onToggleShiftSelection) {
                                          onToggleShiftSelection(shift.id);
                                        } else if (globalToggleShiftSelection) {
                                          globalToggleShiftSelection(shift.id);
                                        } else {
                                          uiToggleShiftSelection(shift.id);
                                        }
                                      } else {
                                        onViewShift?.(shift);
                                      }
                                    }}
                                    isLocked={isShiftLocked(dateKey, shift.startTime, 'roster_management')}
                                  />
                                ))
                              ) : null}

                              {/* Unified Add Shift Button — Repositioned to corner if shifts exist */}
                              {!isBulkMode && canEdit && !isSydneyPast(date) && (
                                <div className={cn(
                                  "absolute inset-0 flex pointer-events-none z-10",
                                  shifts.length > 0 ? "items-end justify-end p-2" : "items-center justify-center"
                                )}>
                                  <button
                                    className={cn(
                                      "flex items-center justify-center rounded-full transition-all duration-300 pointer-events-auto",
                                      "bg-primary/30 text-primary border border-primary/40 backdrop-blur-md",
                                      "hover:bg-primary/60 hover:scale-110 active:scale-95 shadow-[0_0_20px_rgba(var(--primary),0.3)]",
                                      shifts.length > 0 
                                        ? "w-7 h-7 opacity-0 scale-75 group-hover/cell:opacity-100 group-hover/cell:scale-100" 
                                        : "w-9 h-9 opacity-40 scale-90 hover:opacity-100",
                                      "group/add"
                                    )}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAddShift(employee, date);
                                    }}
                                    title="Add Shift"
                                  >
                                    <Plus className={cn(
                                      shifts.length > 0 ? "h-4 w-4" : "h-5 w-5",
                                      "transition-transform group-hover/add:rotate-90"
                                    )} />
                                  </button>
                                </div>
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
