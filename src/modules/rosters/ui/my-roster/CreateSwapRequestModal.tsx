import React, { useState, useEffect } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/modules/core/ui/primitives/drawer';
import { Button } from '@/modules/core/ui/primitives/button';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import { ArrowLeftRight, Loader2, Send, ShieldCheck } from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Shift } from '@/modules/rosters';
import { useSwaps } from '@/modules/planning';
import { MobileShiftCard } from './MobileShiftCard';

export interface CreateSwapRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  shift: Shift;
  shiftDate: Date;
  groupName?: string;
  subGroupName?: string;
  groupColor?: string;
}

export const CreateSwapRequestModal: React.FC<CreateSwapRequestModalProps> = ({
  isOpen,
  onClose,
  shift,
  groupName = '',
  subGroupName,
  groupColor = 'blue',
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { createSwap } = useSwaps();

  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!shift) return null;

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
      createSwap(
        {
          requesterV8ShiftId: shift.id,
          requestedByEmployeeId: user.id || shift.assigned_employee_id!,
          swapWithEmployeeId: null, // Open to all qualified peers
          reason: reason.trim(),
        },
        {
          onSuccess: () => {
            setIsSubmitting(false);
            onClose();
          },
          onError: () => {
            setIsSubmitting(false);
          },
        }
      );
    } catch (error) {
      console.error(error);
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={isOpen} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <DrawerContent
        className="max-w-lg mx-auto bg-background border-border max-h-[90dvh] flex flex-col rounded-t-[32px] overflow-hidden"
        aria-labelledby="swap-drawer-title"
        aria-describedby="swap-drawer-desc"
      >
        <DrawerHeader className="px-5 pt-5 pb-2 text-left">
          <DrawerTitle id="swap-drawer-title" className="flex items-center gap-2 text-lg font-bold text-foreground">
            <ArrowLeftRight className="h-5 w-5 text-indigo-500" aria-hidden="true" />
            Request Shift Swap
          </DrawerTitle>
          <DrawerDescription id="swap-drawer-desc" className="text-xs text-muted-foreground">
            Post your shift for eligible team members to swap with.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {/* 1. Compact Shift Card (Same as Template and MyRoster) */}
          <div className="rounded-xl overflow-hidden">
            <MobileShiftCard
              shiftData={{
                shift,
                groupName: groupName || shift.departments?.name || '',
                groupColor,
                subGroupName: subGroupName || (shift as any).sub_group_name,
              }}
            />
          </div>

          {/* 2. Rules & Compliance Guidelines */}
          <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Swap Rules & Guidelines</span>
            </div>
            <ul className="text-xs space-y-1 text-indigo-700/90 dark:text-indigo-300/90 pl-1 list-disc list-inside">
              <li>Must be requested at least 4 hours before the shift start.</li>
              <li>Both employees must hold matching role qualifications and active licences.</li>
              <li>Swap requests are subject to manager final approval.</li>
            </ul>
          </div>

          {/* 3. Reason for Swap */}
          <div className="space-y-1.5">
            <Label
              htmlFor="swap-shift-reason"
              className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              Reason for Swap <span className="text-rose-500" aria-hidden="true">*</span>
            </Label>
            <Textarea
              id="swap-shift-reason"
              placeholder="Why do you need to swap this shift?..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              disabled={isSubmitting}
              aria-required="true"
              className="rounded-2xl resize-none bg-muted/30 text-sm focus-visible:ring-indigo-500"
            />
          </div>
        </div>

        {/* 4. Action Buttons */}
        <DrawerFooter className="px-5 py-4 border-t border-border/50 bg-card/50 flex flex-row items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 h-12 rounded-2xl uppercase text-xs font-bold border-border/80 hover:bg-muted active:scale-[0.98] transition-all"
          >
            Keep Shift
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !reason.trim()}
            className="flex-1 h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white uppercase text-xs font-bold shadow-lg shadow-indigo-950/20 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Submitting...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Send className="h-4 w-4" aria-hidden="true" />
                Request Swap
              </span>
            )}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default CreateSwapRequestModal;
