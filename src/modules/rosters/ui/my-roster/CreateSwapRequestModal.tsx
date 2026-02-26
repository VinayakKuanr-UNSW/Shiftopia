import React, { useState, useEffect } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Calendar, Clock, AlertTriangle, ArrowRightLeft, Send, Timer } from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { motion } from 'framer-motion';
import { Shift } from '@/modules/rosters';
import { useSwaps } from '@/modules/planning';

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
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 || 12;
  return `${display}:${m.toString().padStart(2, '0')} ${period}`;
};

const getGradientClass = (color: string): string => {
  switch (color) {
    case 'blue': return 'bg-gradient-to-br from-blue-600 to-blue-800';
    case 'green': return 'bg-gradient-to-br from-green-600 to-green-800';
    case 'red': return 'bg-gradient-to-br from-red-600 to-red-800';
    case 'purple': return 'bg-gradient-to-br from-purple-600 to-purple-800';
    default: return 'bg-gradient-to-br from-slate-600 to-slate-800';
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
  shiftDate,
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


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-[#0d1424] border-white/10 text-white max-h-[90vh] overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <ArrowRightLeft className="h-5 w-5 text-purple-400" />
              Request Shift Swap
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {/* Shift Details Card */}
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className={cn(
                'rounded-xl p-4 text-white',
                getGradientClass(groupColor)
              )}
            >
              <div className="flex items-center gap-2 mb-2 text-xs opacity-80">
                <Calendar className="h-3.5 w-3.5" />
                Your Shift to Swap
              </div>

              <div className="flex items-center justify-between mb-2">
                <div className="text-lg font-bold">{shift.roles?.name || 'Shift'}</div>
                <Badge className="bg-white/20 text-white text-[10px]">
                  {shift.remuneration_levels?.level_name || 'Standard'}
                </Badge>
              </div>

              <div className="text-sm opacity-80 mb-3">
                {groupName || shift.departments?.name} • {subGroupName || shift.sub_group_name}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5 bg-black/20 rounded-lg p-2">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{formatTime(shift.start_time)} - {formatTime(shift.end_time)}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-black/20 rounded-lg p-2">
                  <Timer className="h-3.5 w-3.5" />
                  <span>Net: {netLength}</span>
                </div>
              </div>

              <div className="mt-2 text-xs opacity-80">
                <Calendar className="h-3.5 w-3.5 inline mr-1" />
                {format(shiftDate, 'EEEE, MMMM d, yyyy')}
              </div>
            </motion.div>


            {/* Reason */}
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="space-y-2"
            >
              <Label className="text-white/80">
                Reason for Swap <span className="text-red-400">*</span>
              </Label>
              <Textarea
                placeholder="Please explain why you need to swap this shift..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="bg-[#1a1f2e] border-white/10 text-white placeholder:text-white/30 resize-none"
              />
            </motion.div>

            {/* Compliance Notice */}
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 }}
              className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs">
                  <p className="font-medium text-amber-400 mb-1">Swap Guidelines</p>
                  <ul className="text-amber-300/80 space-y-0.5">
                    <li>• Requests must be submitted at least 4 hours before the shift</li>
                    <li>• Both employees must be qualified for the respective roles</li>
                    <li>• Manager approval may be required</li>
                  </ul>
                </div>
              </div>
            </motion.div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={onClose}
              className="border-white/20 text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!reason.trim() || isSubmitting}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                  >
                    ⏳
                  </motion.div>
                  Posting...
                </div>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Create Swap Request
                </>
              )}
            </Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateSwapRequestModal;
