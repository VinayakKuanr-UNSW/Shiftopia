/**
 * DndAssignModal — Compliance-gated DnD employee-to-shift assignment dialog.
 *
 * Opened when an employee card is dropped onto an unassigned shift in Group Mode.
 * Auto-runs the full V2 compliance engine on mount and gates the Assign button
 * on `canProceed` (no blockers, no system fails, warnings acknowledged).
 *
 * On confirm, delegates to `executeAssignShift` for the actual DB write
 * (which re-runs compliance — redundant but fail-closed).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, User, Clock, Calendar, Briefcase, AlertTriangle } from 'lucide-react';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { evaluateShiftAvailabilityFromSlots } from '@/modules/rosters/domain/availability-check';
import { useAvailabilityMode } from '@/modules/availability/state/useAvailabilityMode';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { useCompliancePanel } from '@/modules/compliance/ui/useCompliancePanel';
import { CompliancePanel } from '@/modules/compliance/ui/CompliancePanel';
import { buildAssignInput } from '@/modules/planning/unified/compliance/input-builder';
import {
  fetchV8EmployeeContext,
  fetchEmployeeShiftsV2,
} from '@/modules/compliance/employee-context';
import { getAvailabilitySlots } from '@/modules/availability/api/availability.api';
import { getAssignedShiftsForAvailability } from '@/modules/availability/api/availability-view.api';
import type { V8AvailabilityData } from '@/modules/compliance/v8/orchestrator/types';
import type { V8OrchestratorShift, V8OrchestratorInput } from '@/modules/compliance/v8/orchestrator/types';
import { supabase } from '@/platform/supabase/client';

// =============================================================================
// PROPS
// =============================================================================

export interface DndAssignModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (options: { ignoreWarnings: boolean }) => void;
  /** Is the parent currently executing the assignment? */
  isAssigning?: boolean;
  // Assignment data
  shiftId: string;
  employeeId: string;
  employeeName: string;
  // Display data
  shiftRole: string;
  shiftDate: string;      // YYYY-MM-DD
  shiftStartTime?: string | null; // HH:mm
  shiftEndTime?: string | null;   // HH:mm
  /**
   * Which job the shift belongs to. OPTIONAL, and normally omitted — the modal
   * resolves it from the shift row itself (see `resolvedSubDeptId`), because
   * both call sites hand this component a display object rather than the DB row
   * and neither of them carried the sub-department. Pass it only to override.
   *
   * `undefined` means "look it up"; an explicit `null` means "person-wide" and
   * is honoured as given.
   */
  subDepartmentId?: string | null;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const DndAssignModal: React.FC<DndAssignModalProps> = ({
  open,
  onClose,
  onConfirm,
  isAssigning = false,
  shiftId,
  employeeId,
  employeeName,
  shiftRole,
  shiftDate,
  shiftStartTime = '',
  shiftEndTime = '',
  subDepartmentId,
}) => {
  const autoRanRef = useRef(false);
  const [availAck, setAvailAck] = useState(false);

  // WHICH JOB THIS SHIFT IS FOR — read from the shift row rather than taken on
  // trust from the caller.
  //
  // Availability is per-job now: the same person can be Full-Time in Security
  // (silence means available) and Casual in Set-up (silence means unavailable),
  // so answering "is this employee available?" without knowing which job the
  // shift belongs to gives the wrong answer for one of them. Neither call site
  // passes it — GroupModeView hands over a `ShiftDisplay` and RostersPlannerPage
  // a loosely-typed drag payload, and adding the prop to both would leave the
  // next caller free to forget it again. A missing scope does not fail loudly;
  // it silently reverts to the person-wide answer this workstream exists to
  // remove, so the safe default is to look it up.
  const needsLookup = subDepartmentId === undefined;
  const { data: lookedUpSubDeptId, isLoading: scopeLoading } = useQuery({
    queryKey: ['shift', 'sub-department', shiftId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('shifts')
        .select('sub_department_id')
        .eq('id', shiftId)
        .single();
      if (error) throw error;
      return (data?.sub_department_id as string | null) ?? null;
    },
    enabled: open && !!shiftId && needsLookup,
    staleTime: 5 * 60_000,
  });

  const resolvedSubDeptId = needsLookup ? (lookedUpSubDeptId ?? null) : subDepartmentId;
  // Until the lookup lands, `resolvedSubDeptId` is null — which reads as
  // "person-wide", the very answer we are trying not to give. So the reads below
  // wait for it rather than evaluating against a scope that is about to change.
  const scopeReady = !needsLookup || !scopeLoading;

  // Warn-only declared-availability check for this MANUAL assignment. It never
  // blocks (that's the Auto Scheduler's job) — it just surfaces a notice, gated
  // by an explicit acknowledgement. Uses the same `availability_slots` source and
  // full-containment rule as the optimizer so the manual warning and the hard
  // constraint agree.
  const { data: availSlots } = useQuery({
    queryKey: ['availability', 'slots', 'assign-modal', employeeId, shiftDate, resolvedSubDeptId],
    queryFn: () => getAvailabilitySlots(employeeId, shiftDate, shiftDate, resolvedSubDeptId),
    enabled: open && !!employeeId && !!shiftDate && scopeReady,
    staleTime: 30_000,
  });
  // …and what an EMPTY slot list means for this person. FT/PT hold no slots by
  // design, so without the mode every permanent would warn here.
  const { mode: availMode } = useAvailabilityMode(
    employeeId,
    open && scopeReady,
    resolvedSubDeptId != null ? { subDepartmentId: resolvedSubDeptId } : undefined,
  );
  const availResult = useMemo(
    () => evaluateShiftAvailabilityFromSlots(
      availSlots ?? [], shiftDate, shiftStartTime || '', shiftEndTime || '', availMode,
    ),
    [availSlots, shiftDate, shiftStartTime, shiftEndTime, availMode],
  );

  // Stable buildInputs — mirrors runFullCompliancePreCheck from assignShift.command.ts
  const buildInputs = useCallback(async (): Promise<[V8OrchestratorInput]> => {
    // 1. Fetch shift details (role, quals) for candidate V8OrchestratorShift
    const { data: shift } = await supabase
      .from('shifts')
      .select(`
        id,
        shift_date,
        start_time,
        end_time,
        role_id,
        unpaid_break_minutes,
        required_skills,
        required_licenses
      `)
      .eq('id', shiftId)
      .single();

    // 2. Fetch employee context + shift history + availability in parallel
    const [employeeCtx, existingShifts, availSlots, assignedShifts] = await Promise.all([
      fetchV8EmployeeContext(employeeId),
      fetchEmployeeShiftsV2(employeeId, shift?.shift_date ?? shiftDate, 35, shiftId),
      // SAME SCOPE as the warn-only banner above. These were divergent: the
      // banner read the employee's Set-up slots while the compliance engine
      // read every slot they hold anywhere, so for a multi-contract employee
      // the dialog could show "outside declared availability" over a panel that
      // had just passed them — two answers to one question, on one screen.
      getAvailabilitySlots(
        employeeId,
        shift?.shift_date ?? shiftDate,
        shift?.shift_date ?? shiftDate,
        resolvedSubDeptId,
      ),
      getAssignedShiftsForAvailability(employeeId, shift?.shift_date ?? shiftDate, shift?.shift_date ?? shiftDate),
    ]);

    // 3. Build candidate V8OrchestratorShift
    const candidateShift: V8OrchestratorShift = {
      id:                      shift?.id ?? shiftId,
      date:                    shift?.shift_date ?? shiftDate,
      start_time:              shift?.start_time ?? shiftStartTime ?? '',
      end_time:                shift?.end_time ?? shiftEndTime ?? '',
      role_id:                 shift?.role_id ?? '',
      required_qualifications: [
        ...(((shift?.required_skills as any) ?? []) as string[]),
        ...(((shift?.required_licenses as any) ?? []) as string[]),
      ],
      is_ordinary_hours:    true,
      break_minutes:        shift?.unpaid_break_minutes ?? 0,
      unpaid_break_minutes: shift?.unpaid_break_minutes ?? 0,
    };

    // 4. Build availability data
    const availabilityData: V8AvailabilityData = {
      declared_slots: availSlots.map(s => ({
        slot_date:  s.slot_date,
        start_time: s.start_time,
        end_time:   s.end_time,
      })),
      assigned_shifts: assignedShifts
        .filter(s => s.id !== shiftId)
        .map(s => ({
          id:         s.id,
          date:       s.shift_date,
          start_time: s.start_time,
          end_time:   s.end_time,
          is_ordinary_hours: true,
        })),
    };

    // 5. Assemble V8OrchestratorInput via the canonical builder
    const input = buildAssignInput({
      employeeId,
      employeeContext: employeeCtx,
      existingShifts,
      candidateShift,
      stage: 'PUBLISH',
      availabilityData,
    });

    return [input];
  }, [shiftId, employeeId, shiftDate, shiftStartTime, shiftEndTime, resolvedSubDeptId]);

  const panel = useCompliancePanel({ buildInputs, stage: 'PUBLISH' });

  // Auto-run compliance when the modal opens — but not before we know which job
  // the shift is for.
  //
  // `panel.run()` fires ONCE per open, and `buildInputs` reads
  // `resolvedSubDeptId` at call time. Running on the first render would capture
  // the pre-lookup null, evaluate the whole engine against person-wide
  // availability, and then never re-run to correct itself — a stale verdict that
  // looks authoritative because the panel renders it as a finished result.
  useEffect(() => {
    if (open && scopeReady && !autoRanRef.current) {
      autoRanRef.current = true;
      panel.run();
    }
    if (!open) {
      autoRanRef.current = false;
      setAvailAck(false);
    }
  }, [open, scopeReady]); // intentionally excluding panel.run to avoid re-trigger loops

  // Format display values
  const formatTime = (t: string | undefined | null) => {
    if (!t) return '--:--';
    
    let timePart = t;
    if (t.includes('T')) {
      const tSplit = t.split('T');
      if (tSplit[1]) {
        timePart = tSplit[1].split(/[+-Z]/)[0];
      }
    }
    
    const parts = timePart.split(':');
    if (parts.length >= 2) {
      const hourVal = parseInt(parts[0], 10);
      const minVal = parts[1];
      if (!isNaN(hourVal) && minVal) {
        const ampm = hourVal >= 12 ? 'PM' : 'AM';
        const displayHour = hourVal % 12 || 12;
        const displayMin = minVal.substring(0, 2);
        return `${displayHour}:${displayMin} ${ampm}`;
      }
    }
    
    try {
      const d = new Date(t);
      if (!isNaN(d.getTime())) {
        const hourVal = d.getHours();
        const minVal = d.getMinutes().toString().padStart(2, '0');
        const ampm = hourVal >= 12 ? 'PM' : 'AM';
        const displayHour = hourVal % 12 || 12;
        return `${displayHour}:${minVal} ${ampm}`;
      }
    } catch {
      // ignore
    }
    
    return t;
  };

  const formatDate = (d: string | undefined | null) => {
    if (!d) return '---';
    let dateStr = d;
    if (d.includes('T')) {
      dateStr = d.split('T')[0];
    }
    const date = new Date(dateStr + 'T00:00:00');
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-black uppercase tracking-wider">
            Assign Employee
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Review compliance before confirming assignment
          </DialogDescription>
        </DialogHeader>

        {/* Assignment Summary — Compact 1-row layout */}
        <div className="grid grid-cols-4 gap-4 p-2.5 rounded-xl border border-border/50 bg-muted/10">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <User className="h-4 w-4 text-indigo-500" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Employee</p>
              <p className="text-sm font-bold text-foreground">{employeeName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Briefcase className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Role</p>
              <p className="text-sm font-bold text-foreground">{shiftRole}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Calendar className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Date</p>
              <p className="text-sm font-bold text-foreground">{formatDate(shiftDate)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Time</p>
              <p className="text-sm font-bold text-foreground">
                {formatTime(shiftStartTime)} – {formatTime(shiftEndTime)}
              </p>
            </div>
          </div>
        </div>

        {/* Compliance Panel — Scrollable to protect footer */}
        <div className="max-h-[380px] overflow-y-auto pr-1 -mr-1 custom-scrollbar">
          <CompliancePanel hook={panel} />
        </div>

        {/* Availability — warn-only (never blocks; requires explicit acknowledgement) */}
        {availResult.isWarning && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2 font-semibold mb-1">
              <AlertTriangle className="h-4 w-4" />
              Outside declared availability
            </div>
            <p className="text-xs opacity-90">{availResult.message}</p>
            <label className="mt-2 flex items-center gap-2 cursor-pointer text-xs font-medium">
              <Checkbox checked={availAck} onCheckedChange={(v) => setAvailAck(v === true)} />
              Assign anyway — I acknowledge this shift is outside the employee’s availability.
            </label>
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="mt-2 gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isAssigning}
            className="text-xs font-black uppercase tracking-widest"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({ ignoreWarnings: panel.warningsAcknowledged })}
            disabled={!panel.canProceed || isAssigning || (availResult.isWarning && !availAck)}
            className={cn(
              'text-xs font-black uppercase tracking-widest shadow-lg transition-all active:scale-95',
              panel.canProceed
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {isAssigning ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Assigning…
              </>
            ) : (
              'Assign'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DndAssignModal;
