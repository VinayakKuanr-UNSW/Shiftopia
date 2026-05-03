import React, { useState, useMemo, useEffect } from 'react';

import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { Plus, MoreHorizontal, Undo2, Edit2, Zap } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { SmartShiftCard, type ComplianceInfo } from '@/modules/rosters/ui/components/SmartShiftCard';
import { AvailabilityBar } from '@/modules/rosters/ui/components/AvailabilityBar';
import { resolveGroupType, resolveShiftStatus } from '@/modules/rosters/utils/roster-utils';
import { DroppableDateCell } from '@/modules/rosters/ui/components/DroppableDateCell';
import { useResolvedAvailability } from '@/modules/rosters/hooks/useResolvedAvailability';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import { isSydneyPast } from '@/modules/core/lib/date.utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useCreateShift } from '@/modules/rosters/state/useRosterShifts';
import { 
  PeopleModeEmployee, 
  PeopleModeShift, 
  DND_UNFILLED_SHIFT, 
  DND_SHIFT_TYPE,
  ShiftDragItem
} from './people-mode.types';
import type { UnfilledShift } from './UnfilledShiftsPanel';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { useDrag } from 'react-dnd';
import { canDragShift } from '@/modules/rosters/utils/dnd.utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { formatCost } from '@/modules/rosters/domain/projections/utils/cost';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';

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
  isBulkMode?: boolean;
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

  /** Called when an unfilled shift is drag-dropped onto an employee date cell */
  onAssignShift?: (shift: UnfilledShift, employeeId: string, dateKey: string) => void;
  /** Called when an existing shift is moved */
  onMoveShift?: (shiftId: string, targetEmployeeId: string, targetDate: string) => void;
}

/* ============================================================
   DRAGGABLE SHIFT CARD WRAPPER
   ============================================================ */

interface DraggableShiftCardProps {
  shift: PeopleModeShift;
  employee: PeopleModeEmployee;
  children: React.ReactNode;
  disabled?: boolean;
}

const DraggableShiftCard: React.FC<DraggableShiftCardProps> = ({
  shift,
  employee,
  children,
  disabled,
}) => {
  const isDnDModeActive = useRosterStore(s => s.isDnDModeActive);

  const [{ isDragging }, drag] = useDrag(() => ({
    type: DND_SHIFT_TYPE,
    item: {
      shiftId: shift.id,
      sourceGroupType: (shift as any).groupType || 'people-mode',
      sourceSubGroup: shift.subGroup || 'Unassigned',
      shiftDate: shift.rawShift?.shift_date || '',
      startTime: shift.startTime,
      endTime: shift.endTime,
      lifecycle_status: shift.lifecycleStatus === 'published' ? 'Published' : 'Draft',
      is_cancelled: shift.isCancelled,
    } as ShiftDragItem,
    canDrag: () => canDragShift(
      { 
        lifecycle_status: shift.lifecycleStatus === 'published' ? 'Published' : 'Draft',
        is_cancelled: shift.isCancelled 
      }, 
      isDnDModeActive
    ) && !disabled,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [shift, isDnDModeActive, disabled, employee.id]);

  return (
    <div
      ref={drag}
      className={cn(
        'transition-all duration-300',
        isDragging && 'opacity-40 scale-95 rotate-1 grayscale shadow-none'
      )}
    >
      {React.cloneElement(children as React.ReactElement, { isDragging })}
    </div>
  );
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export const PeopleModeGrid: React.FC<PeopleModeGridProps> = ({
  employees,
  dates,
  canEdit,
  showAvailabilities,
  isBulkMode: propIsBulkMode = false,
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

  onAssignShift,
  onMoveShift,
}) => {
  const { toast } = useToast();
  const createShiftMutation = useCreateShift();
  const { 
    bulkModeActive: globalBulkModeActive, 
    selectedShiftIds: globalSelectedShiftIds,
    toggleShiftSelection: globalToggleShiftSelection
  } = useRosterStore();

  const isBulkMode = propIsBulkMode || globalBulkModeActive;
  const { toggleShiftSelection: uiToggleShiftSelection } = useRosterUI();

  const currentSelectedShifts = propsSelectedShifts;

  const handleCloneShift = async (shift: PeopleModeShift) => {
    try {
      const { rawShift } = shift;
      if (!rawShift) {
        toast({ title: 'Error', description: 'Could not find raw shift data to clone.', variant: 'destructive' });
        return;
      }

      const cloneData: any = {
        roster_id: rawShift.roster_id,
        department_id: rawShift.department_id,
        sub_department_id: rawShift.sub_department_id,
        shift_date: rawShift.shift_date,
        start_time: rawShift.start_time,
        end_time: rawShift.end_time,
        organization_id: rawShift.organization_id,
        group_type: rawShift.group_type,
        sub_group_name: rawShift.sub_group_name,
        shift_group_id: rawShift.shift_group_id,
        shift_subgroup_id: rawShift.shift_subgroup_id || (rawShift as any).roster_subgroup_id,
        role_id: rawShift.role_id,
        remuneration_level_id: rawShift.remuneration_level_id,
        paid_break_minutes: rawShift.paid_break_minutes,
        unpaid_break_minutes: rawShift.unpaid_break_minutes,
        timezone: rawShift.timezone,
        required_skills: rawShift.required_skills || [],
        required_licenses: rawShift.required_licenses || [],
        event_ids: rawShift.event_ids || [],
        tags: rawShift.tags || [],
        notes: rawShift.notes,
        is_training: rawShift.is_training,
      };

      await createShiftMutation.mutateAsync(cloneData);
      toast({
        title: 'Shift Cloned',
        description: 'A new draft replica has been created (unassigned).',
      });
    } catch (error: any) {
      toast({
        title: 'Clone Failed',
        description: error.message || 'Could not clone shift.',
        variant: 'destructive',
      });
    }
  };

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

        <DropdownMenuItem
          onClick={() => handleCloneShift(shift)}
          className="text-popover-foreground hover:bg-accent cursor-pointer"
        >
          <Plus className="h-4 w-4 mr-2" />
          Clone Shift
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

      </DropdownMenuContent>
    </DropdownMenu>
  );
  const isDnDModeActive = useRosterStore(s => s.isDnDModeActive);
  // Get all profile IDs for availability lookup
  const profileIds = useMemo(() => employees.map(e => e.id), [employees]);

  // Fetch resolved availability from database
  const { getAvailability, isLoading: availabilityLoading } = useResolvedAvailability(
    profileIds,
    dates,
    showAvailabilities // Only fetch when availabilities are shown
  );

  return (
    <>
      {/* DnD Mode Indicator */}
      {isDnDModeActive && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-500 pointer-events-none">
          <Badge className="px-6 py-2 bg-emerald-500/90 text-white backdrop-blur-md border border-emerald-400/50 shadow-[0_0_20px_rgba(16,185,129,0.3)] flex items-center gap-2 text-sm font-medium rounded-full">
            <Zap className="h-4 w-4 animate-pulse" />
            DnD Mode Active
          </Badge>
        </div>
      )}

      <ScrollArea className="h-full custom-scrollbar">
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
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-[10px] font-mono tabular-nums text-emerald-400/80 cursor-help hover:text-emerald-400 transition-colors">
                                        {formatCost(employee.estimatedPay)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="w-52 p-3 bg-zinc-900 border-white/10 shadow-xl" side="right" sideOffset={15}>
                                      <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{employee.name.split(' ')[0]}'s Estimate</p>
                                        <div className="space-y-1.5">
                                          <div className="flex justify-between text-xs">
                                            <span className="text-white/60">Base Pay</span>
                                            <span className="text-white font-medium">{formatCost(employee.payBreakdown.base)}</span>
                                          </div>
                                          <div className="flex justify-between text-xs">
                                            <span className="text-white/60">Penalties</span>
                                            <span className="text-emerald-400 font-medium">+{formatCost(employee.payBreakdown.penalty)}</span>
                                          </div>
                                          <div className="flex justify-between text-xs">
                                            <span className="text-white/60">Overtime</span>
                                            <span className="text-amber-400 font-medium">+{formatCost(employee.payBreakdown.overtime)}</span>
                                          </div>
                                          {employee.payBreakdown.allowance > 0 && (
                                            <div className="flex justify-between text-xs">
                                              <span className="text-white/60">Allowances</span>
                                              <span className="text-blue-400 font-medium">+{formatCost(employee.payBreakdown.allowance)}</span>
                                            </div>
                                          )}
                                          {employee.payBreakdown.leave > 0 && (
                                            <div className="flex justify-between text-xs">
                                              <span className="text-white/60">Leave Loading</span>
                                              <span className="text-purple-400 font-medium">+{formatCost(employee.payBreakdown.leave)}</span>
                                            </div>
                                          )}
                                          <div className="pt-1 border-t border-white/10 flex justify-between text-xs font-bold">
                                            <span className="text-white">Total</span>
                                            <span className="text-white">{formatCost(employee.estimatedPay)}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
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

                        const cellClassName = cn(
                          'px-3 py-3 align-top relative group/cell',
                          dateIdx < dates.length - 1 && 'border-r border-border',
                          canEdit && !isBulkMode && 'cursor-pointer',
                        );
                        const cellOnClick = () => {
                          if (canEdit && !isBulkMode && shifts.length === 0 && !isSydneyPast(date)) {
                            onAddShift(employee, date);
                          }
                        };

                        // DroppableDateCell is always used — it is a plain <td> when
                        // onAssignShift is absent or DnD is inactive (no-op handler).
                        return (
                          <DroppableDateCell
                            key={dateIdx}
                            employeeId={employee.id}
                            dateKey={dateKey}
                            className={cellClassName}
                            onClick={cellOnClick}
                            onAssign={onAssignShift ?? (() => {})}
                            onMove={onMoveShift}
                          >
                            <div className={cn(
                              'space-y-2',
                              // Minimum height ensures consistent spacing
                              showAvailabilities ? 'min-h-[110px]' : 'min-h-[80px]'
                            )}>
                              {/* ========== SHIFTS ========== */}
                              {shifts.length > 0 ? (
                                shifts.map((shift) => {
                                    const { isPast, isLocked: isManagementLocked } = resolveShiftStatus(shift);
                                    const isLocked = isManagementLocked || (isDnDModeActive && shift.lifecycleStatus !== 'draft');

                                    return (
                                      <DraggableShiftCard
                                        key={shift.id}
                                        shift={shift}
                                        employee={employee}
                                        disabled={isManagementLocked}
                                      >
                                        <SmartShiftCard
                                          headerAction={canEdit && !isBulkMode ? buildShiftMenu(shift) : undefined}
                                          shift={shift.rawShift || ({
                                            id: shift.id,
                                            start_time: shift.startTime,
                                            end_time: shift.endTime,
                                            lifecycle_status: shift.lifecycleStatus === 'published' ? 'Published' : 'Draft',
                                            assigned_employee_id: shift.assignmentStatus === 'assigned' ? employee.id : null,
                                            bidding_status: shift.fulfillmentStatus === 'bidding' ? 'on_bidding' : 'not_on_bidding',
                                            is_trade_requested: shift.isTradeRequested,
                                            is_cancelled: shift.isCancelled,
                                            sub_group_name: shift.subGroup,
                                            required_skills: shift.requiredSkills || [],
                                            roles: { id: '', name: shift.role },
                                            assigned_profiles: { first_name: employee.name.split(' ')[0], last_name: employee.name.split(' ').slice(1).join(' ') },
                                          } as any)}
                                          variant={cardVariant}
                                          groupColor={resolveGroupType(shift.rawShift || shift)}
                                          compliance={complianceMap?.[shift.id]}
                                          isSelected={currentSelectedShifts.includes(shift.id)}
                                          isLocked={isLocked}
                                          isPast={isPast}
                                          isDnDActive={isDnDModeActive}
                                          showStatusIcons={true}
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
                                        />
                                      </DraggableShiftCard>
                                    );
                                })
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
                          </DroppableDateCell>
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
    </>
  );
};

export default PeopleModeGrid;
