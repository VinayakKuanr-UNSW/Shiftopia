/**
 * Cancel a published shift (docs/design/shift-trading/03-bidding-fsm.md B-D13..B-D15).
 *
 * Drafts are deleted; a published shift — or one in progress that nobody has
 * clocked in to — is cancelled instead, which keeps its history. The manager must
 * say why: the note goes to the assignee and anyone whose trade or bid it ends.
 * The database decides what is allowed (sm_cancel_shift); this dialog only
 * collects the note and reports the refusal if there is one.
 */

import { useId, useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useCancelShift } from '../../state/useRosterShifts';

export interface CancelShiftTarget {
  id: string;
  version?: number;
  /** Shown in the dialog, e.g. "Bartender · Mon 8 Dec 09:00–12:00". */
  label: string;
}

interface CancelShiftDialogProps {
  /** The shift to cancel; null keeps the dialog closed. */
  shift: CancelShiftTarget | null;
  onClose: () => void;
}

export function CancelShiftDialog({ shift, onClose }: CancelShiftDialogProps) {
  const [note, setNote] = useState('');
  const cancelShift = useCancelShift();
  const { toast } = useToast();
  const noteId = useId();
  const hasNote = note.trim().length > 0;

  const close = () => {
    setNote('');
    onClose();
  };

  const handleConfirm = async () => {
    if (!shift || !hasNote) return;
    try {
      await cancelShift.mutateAsync({ shiftId: shift.id, reason: note.trim(), expectedVersion: shift.version });
      toast({ title: 'Shift cancelled', description: 'Everyone affected has been told.' });
      close();
    } catch (error: unknown) {
      toast({
        title: 'Could not cancel the shift',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <AlertDialog open={shift !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel shift?</AlertDialogTitle>
          <AlertDialogDescription>
            {shift?.label}. The shift stays on the roster as cancelled. The assigned employee, and anyone whose
            trade or bid it ends, will be notified with your reason.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={noteId}>Reason (required)</Label>
          <Textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Event cancelled by the client"
            maxLength={500}
            disabled={cancelShift.isPending}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelShift.isPending}>Keep shift</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!hasNote || cancelShift.isPending}
          >
            {cancelShift.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
            Cancel shift
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
