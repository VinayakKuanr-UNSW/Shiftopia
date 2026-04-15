import React, { useState, useEffect } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Calendar, Clock, AlertTriangle, ArrowRightLeft, Send, Timer, Flame, Zap, Loader2 } from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';
import { motion } from 'framer-motion';
import { Shift } from '@/modules/rosters';
import { useSwaps } from '@/modules/planning';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';

interface CreateSwapRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  shift: Shift;
  shiftDate: Date;
  groupName?: string;
  subGroupName?: string;
  groupColor?: string;
}

const formatTime = (time: string): string => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const getGradientClass = (color: string): string => {
  switch (color) {
    case 'blue':
    case 'convention':
      return 'dept-card-glass-base dept-card-glass-convention';
    case 'green':
    case 'exhibition':
      return 'dept-card-glass-base dept-card-glass-exhibition';
    case 'red':
    case 'theatre':
      return 'dept-card-glass-base dept-card-glass-theatre';
    default:
      return 'dept-card-glass-base dept-card-glass-default';
  }
};

const calculateNetLength = (startTime: string, endTime: string, breakMinutes: number): string => {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let total = eh * 60 + em - (sh * 60 + sm);
  if (total < 0) total += 24 * 60;
  const net = total - breakMinutes;
  const h = Math.floor(net / 60);
  const m = net % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

const CreateSwapRequestModal: React.FC<CreateSwapRequestModalProps> = ({
  isOpen,
  onClose,
  shift,
  shiftDate: _shiftDate,
  groupName,
  subGroupName,
  groupColor = 'slate',
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { createSwap } = useSwaps();

  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setReason('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!shift) return null;

  const netLength = calculateNetLength(
    shift.start_time,
    shift.end_time,
    shift.break_minutes || 0
  );

  const urgency = computeShiftUrgency(shift.shift_date, shift.start_time, (shift as any).start_at);

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please provide a reason for the swap request.',
        variant: 'destructive',
      });
      return;
    }

    if (!user?.id) return;

    setIsSubmitting(true);

    try {
      createSwap({
        requesterShiftId: shift.id,
        requestedByEmployeeId: user.id || shift.assigned_employee_id!,
        swapWithEmployeeId: null, // Always open for now
        reason: reason.trim(),
      }, {
        onSuccess: () => {
          setIsSubmitting(false);
          onClose();
        },
        onError: () => {
          setIsSubmitting(false);
        }
      });
    } catch (error) {
      console.error(error);
      setIsSubmitting(false);
    }
  };


  // ── Shared content ────────────────────────────────────────────────────────────
  const shiftCard = (
    <div className={cn('rounded-2xl p-4 shadow-xl text-foreground', getGradientClass(groupColor))}>
      <div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-widest text-foreground/50">
        <Calendar className="h-3.5 w-3.5" />
        Shift to Swap
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xl font-black tracking-tight text-foreground">{shift.roles?.name || 'Shift'}</div>
        <div className="flex items-center gap-1.5">
          {urgency === 'emergent' && (
            <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-400/40 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 animate-pulse">
              <Flame className="h-2.5 w-2.5" />
              Emergent
            </Badge>
          )}
          {urgency === 'urgent' && (
            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/40 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
              <Zap className="h-2.5 w-2.5" />
              Urgent
            </Badge>
          )}
        </div>
      </div>
      <div className="text-xs font-bold text-foreground/70 mb-4 uppercase tracking-tight">
        {groupName || shift.departments?.name} | {subGroupName || shift.sub_group_name}
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-center gap-2 bg-muted/40 dark:bg-black/20 rounded-xl p-2.5">
          <Clock className="h-4 w-4 opacity-60" />
          <span className="font-bold text-foreground">{formatTime(shift.start_time)}-{formatTime(shift.end_time)}</span>
        </div>
        <div className="flex items-center gap-2 bg-muted/40 dark:bg-black/20 rounded-xl p-2.5 text-center justify-center">
          <Timer className="h-4 w-4 opacity-60" />
          <span className="font-bold text-foreground">{netLength}</span>
        </div>
      </div>
    </div>
  );

  const formBody = (
    <div className="space-y-4">
      {shiftCard}
      {/* Reason */}
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Reason for Swap <span className="text-rose-500">*</span>
        </Label>
        <Textarea
          placeholder="Why do you need to swap?..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="rounded-2xl resize-none"
        />
      </div>
      {/* Compliance Notice */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-[11px]">
            <p className="font-black text-amber-500 mb-1 uppercase tracking-wider">Guidelines</p>
            <ul className="text-amber-500/70 space-y-1 font-medium">
              <li>• Must be at least 4 hours before the shift</li>
              <li>• Both employees must be role-qualified</li>
              <li>• Subject to manager final approval</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );

  const actionButtons = (
    <>
      <Button
        variant="ghost"
        onClick={onClose}
        className="h-12 rounded-2xl uppercase text-xs font-black"
      >
        Keep Shift
      </Button>
      <Button
        onClick={handleSubmit}
        disabled={!reason.trim() || isSubmitting}
        className="h-12 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white shadow-xl shadow-purple-950/20 uppercase text-xs font-black"
      >
        {isSubmitting ? (
          <Loader2 className="animate-spin h-5 w-5" />
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            Create Request
          </>
        )}
      </Button>
    </>
  );

  return (
    <ResponsiveDialog
      open={isOpen}
      onOpenChange={onClose}
      dialogClassName="max-w-md"
      drawerClassName="bg-background border-border"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <ResponsiveDialog.Header>
          <ResponsiveDialog.Title className="flex items-center gap-2 text-xl font-black">
            <ArrowRightLeft className="h-5 w-5 text-purple-500" />
            Request Shift Swap
          </ResponsiveDialog.Title>
          <ResponsiveDialog.Description>
            Select a reason and post your shift for swapping.
          </ResponsiveDialog.Description>
        </ResponsiveDialog.Header>
        <ResponsiveDialog.Body className="space-y-4 mt-2">
          {formBody}
        </ResponsiveDialog.Body>
        <ResponsiveDialog.Footer className="mt-6 gap-3">
          {actionButtons}
        </ResponsiveDialog.Footer>
      </motion.div>
    </ResponsiveDialog>
  );
};

export default CreateSwapRequestModal;
