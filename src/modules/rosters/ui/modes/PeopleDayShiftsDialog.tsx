import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock, Flame, Minus, Plus, Siren } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import type { PeopleModeEmployee, PeopleModeShift } from './people-mode.types';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';

export interface DayShiftSelection {
  employee: PeopleModeEmployee;
  date: Date;
  shifts: PeopleModeShift[];
}

interface PeopleDayShiftsDialogProps {
  selection: DayShiftSelection | null;
  onOpenChange: (open: boolean) => void;
  onViewShift: (shift: PeopleModeShift) => void;
  onAddShift: (employee: PeopleModeEmployee, date: Date) => void;
}

type ShiftPriority = 'critical' | 'urgent' | 'normal';

const PRIORITY_RANK: Record<ShiftPriority, number> = { critical: 3, urgent: 2, normal: 1 };
const CLOSE_ANIMATION_MS = 300;

/**
 * The mobile branch read `bidding_priority_text`, a column this database does
 * not have — only bidding_close_at / bidding_enabled / bidding_open_at /
 * bidding_status / is_on_bidding exist. Rather than reintroduce a fourth
 * private definition of "how urgent is this shift", defer to the canonical
 * time-to-start helper in domain/bidding-urgency, whose 'emergent' tier is
 * this component's 'critical'.
 */
function resolveShiftPriority(shift: PeopleModeShift): ShiftPriority {
  const raw = shift.rawShift;
  if (raw?.shift_date && raw?.start_time) {
    const urgency = computeShiftUrgency(
      raw.shift_date,
      raw.start_time,
      (raw as { start_at?: string }).start_at,
    );
    if (urgency === 'emergent') return 'critical';
    if (urgency === 'urgent') return 'urgent';
  }
  // A manager can flag a shift urgent for bidding independently of its start time.
  if (raw?.bidding_status === 'on_bidding_urgent') return 'urgent';
  return 'normal';
}

function PriorityMarker({ priority }: { priority: ShiftPriority }) {
  const Icon = priority === 'critical' ? Siren : priority === 'urgent' ? Flame : Minus;
  const color = priority === 'critical'
    ? 'border-rose-500/30 bg-rose-500/20 text-rose-400'
    : priority === 'urgent'
      ? 'border-orange-500/30 bg-orange-500/20 text-orange-400'
      : 'border-primary/25 bg-primary/15 text-primary';

  return (
    <span
      aria-label={`${priority} priority`}
      className={`absolute inset-y-0 left-0 flex w-9 items-center justify-center border-r ${color}`}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function PeopleDayShiftsDialog({
  selection,
  onOpenChange,
  onViewShift,
  onAddShift,
}: PeopleDayShiftsDialogProps) {
  const [isClosing, setIsClosing] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const sortedShifts = selection
    ? [...selection.shifts].sort(
        (left, right) => PRIORITY_RANK[resolveShiftPriority(right)] - PRIORITY_RANK[resolveShiftPriority(left)],
      )
    : [];

  const beginClose = (pendingAction?: () => void) => {
    if (isClosing) return;
    pendingActionRef.current = pendingAction ?? null;
    setIsClosing(true);
  };

  useEffect(() => {
    if (!isClosing) return;
    const timer = window.setTimeout(() => {
      onOpenChange(false);
      pendingActionRef.current?.();
    }, CLOSE_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [isClosing, onOpenChange]);

  if (!selection) return null;

  const handleAddShift = () => {
    beginClose(() => onAddShift(selection.employee, selection.date));
  };

  const handleViewShift = (shift: PeopleModeShift) => {
    beginClose(() => onViewShift(shift));
  };

  return (
    <Dialog open={!isClosing} onOpenChange={(open) => !open && beginClose()}>
      <DialogContent
        data-hide-bottom-nav="true"
        overlayClassName="bg-slate-950/55 backdrop-blur-xl"
        className="z-[160] w-[calc(100vw-1rem)] max-w-sm gap-0 border-0 bg-transparent p-0 shadow-none duration-300 data-[state=closed]:slide-out-to-bottom-12 data-[state=closed]:zoom-out-90 [&>button]:right-4 [&>button]:top-4 [&>button]:z-30 [&>button]:flex [&>button]:h-9 [&>button]:w-9 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-xl [&>button]:bg-black/10 [&>button]:backdrop-blur-md"
      >
        <motion.div
          initial={{ opacity: 0, y: 80, scale: 0.78, rotateX: 8 }}
          animate={isClosing
            ? { opacity: 0, y: 64, scale: 0.86, rotateX: 6 }
            : { opacity: 1, y: 0, scale: 1, rotateX: 0 }}
          transition={isClosing
            ? { duration: CLOSE_ANIMATION_MS / 1000, ease: [0.4, 0, 1, 1] }
            : { type: 'spring', stiffness: 320, damping: 26, mass: 0.8 }}
          className="relative flex max-h-[min(70dvh,560px)] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-background/80 shadow-[0_30px_100px_-20px_rgba(0,0,0,0.85)] ring-1 ring-primary/15 backdrop-blur-2xl"
          style={{ transformPerspective: 1000 }}
        >
          <div className="pointer-events-none absolute -left-20 -top-24 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 -right-20 h-52 w-52 rounded-full bg-cyan-400/10 blur-3xl" />

          <DialogHeader className="relative z-10 border-b border-white/10 bg-gradient-to-br from-primary/15 via-transparent to-cyan-400/5 px-5 py-5 pr-14 text-left">
            <DialogTitle className="text-xl font-black tracking-tight">{selection.employee.name}</DialogTitle>
            <DialogDescription className="mt-1 flex items-center gap-2 text-xs">
              <CalendarDays className="h-4 w-4 text-primary" />
              {format(selection.date, 'EEE, d MMM yyyy')} · {selection.shifts.length} shifts
            </DialogDescription>
          </DialogHeader>

          <div className="relative z-10 min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {sortedShifts.map((shift, index) => {
              const priority = resolveShiftPriority(shift);
              return (
            <motion.button
              key={shift.id}
              type="button"
              onClick={() => handleViewShift(shift)}
              initial={{ opacity: 0, x: 28, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ delay: 0.12 + index * 0.055, type: 'spring', stiffness: 360, damping: 28 }}
              whileTap={{ scale: 0.97 }}
              className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/5 py-3 pl-12 pr-3 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/10"
            >
              <PriorityMarker priority={priority} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-foreground">{shift.subGroup || shift.role}</div>
                <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {shift.startTime} – {shift.endTime}
                </div>
              </div>
              <Badge variant="outline" className="shrink-0 text-[9px] uppercase">
                {shift.status}
              </Badge>
            </motion.button>
              );
            })}
          </div>

          <div className="relative z-10 border-t border-white/10 bg-background/40 p-4 backdrop-blur-xl">
            <Button type="button" onClick={handleAddShift} className="h-12 w-full rounded-2xl bg-gradient-to-r from-primary to-blue-500 font-black shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]">
              <Plus className="mr-2 h-4 w-4" />
              Add Shift
            </Button>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
