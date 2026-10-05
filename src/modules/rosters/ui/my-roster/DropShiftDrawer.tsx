import React, { useState, useEffect } from 'react';
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
import { AlertTriangle, Loader2, UserX } from 'lucide-react';
import { Shift } from '@/modules/rosters';
import { MobileShiftCard } from './MobileShiftCard';
import { cn } from '@/modules/core/lib/utils';
import { useCancellationReasons } from '@/modules/insights/hooks/useCancellationReasons';

export interface DropShiftDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  shift: Shift | null;
  shiftDate: Date;
  groupName?: string;
  subGroupName?: string;
  groupColor?: string;
  isWithinLockoutPeriod?: boolean;
  /**
   * `reasonCode` is the structured pick; `note` is the free text. The note is
   * mandatory only when the chosen reason says so (currently "Other"), and the
   * RPC re-validates both — the UI is a convenience, not the guard.
   */
  onConfirmDrop: (note: string, reasonCode: string) => Promise<void> | void;
  isDropping: boolean;
}

export const DropShiftDrawer: React.FC<DropShiftDrawerProps> = ({
  isOpen,
  onClose,
  shift,
  groupName = '',
  subGroupName,
  groupColor = 'blue',
  isWithinLockoutPeriod = false,
  onConfirmDrop,
  isDropping,
}) => {
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState<string>('');
  const { data: reasons = [], isLoading: loadingReasons } = useCancellationReasons();

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setReasonCode('');
    }
  }, [isOpen]);

  if (!shift) return null;

  const selected = reasons.find((r) => r.code === reasonCode);
  // A note is only required when the reason says so. Before this, every drop
  // demanded free text and then discarded it — sm_employee_drop_shift accepted
  // p_reason and never wrote it anywhere.
  const noteRequired = selected?.requires_note ?? false;
  const canConfirm = !!reasonCode && (!noteRequired || reason.trim().length > 0);

  const handleConfirm = async () => {
    if (!canConfirm || isDropping) return;
    await onConfirmDrop(reason.trim(), reasonCode);
  };

  return (
    <Drawer open={isOpen} onOpenChange={(open) => { if (!open && !isDropping) onClose(); }}>
      <DrawerContent
        className="max-w-lg mx-auto bg-background border-border max-h-[90dvh] flex flex-col rounded-t-[32px] overflow-hidden"
        aria-labelledby="drop-drawer-title"
        aria-describedby="drop-drawer-desc"
      >
        <DrawerHeader className="px-5 pt-5 pb-2 text-left">
          <DrawerTitle id="drop-drawer-title" className="flex items-center gap-2 text-lg font-bold text-foreground">
            <UserX className="h-5 w-5 text-rose-500" aria-hidden="true" />
            Drop Shift Assignment
          </DrawerTitle>
          <DrawerDescription id="drop-drawer-desc" className="text-xs text-muted-foreground">
            Release this shift back to the open roster marketplace.
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
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Drop Rules & Guidelines</span>
            </div>
            <ul className="text-xs space-y-1 text-amber-700/90 dark:text-amber-300/90 pl-1 list-disc list-inside">
              <li>Dropped shifts return to the open marketplace pool for replacement.</li>
              <li>Dropping with 24 hours notice or less counts as a <strong>critical</strong> cancellation on your record.</li>
              <li>Dropping shifts within 4 hours of start time enters an emergent state and requires supervisor escalation.</li>
              <li>Repeated unworked drops may impact scheduling reliability scores.</li>
            </ul>
            {isWithinLockoutPeriod && (
              <div className="mt-2 p-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" />
                <span>Emergent Notice: This shift starts within 4 hours.</span>
              </div>
            )}
          </div>

          {/* 3. Reason for Drop — a pick, then an optional note */}
          <fieldset className="space-y-2" disabled={isDropping}>
            <legend className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Reason for Drop <span className="text-rose-500" aria-hidden="true">*</span>
            </legend>
            {loadingReasons ? (
              <p className="text-xs text-muted-foreground">Loading reasons…</p>
            ) : (
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Reason for dropping this shift">
                {reasons.map((r) => {
                  const active = r.code === reasonCode;
                  return (
                    <button
                      key={r.code}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setReasonCode(r.code)}
                      title={r.description ?? undefined}
                      className={cn(
                        'min-h-11 rounded-2xl border px-3 py-2.5 text-left text-xs font-semibold transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500',
                        active
                          ? 'border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          : 'border-border bg-muted/30 text-foreground hover:bg-muted/60',
                      )}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="space-y-1.5 pt-1">
              <Label
                htmlFor="drop-shift-reason"
                className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
              >
                {noteRequired ? (
                  <>Tell us more <span className="text-rose-500" aria-hidden="true">*</span></>
                ) : (
                  <>Anything to add <span className="font-normal normal-case tracking-normal">(optional)</span></>
                )}
              </Label>
              <Textarea
                id="drop-shift-reason"
                placeholder={noteRequired
                  ? 'A short note is required for this reason…'
                  : 'Add context for your manager…'}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                disabled={isDropping}
                aria-required={noteRequired}
                className="rounded-2xl resize-none bg-muted/30 text-sm focus-visible:ring-rose-500"
              />
            </div>
          </fieldset>
        </div>

        {/* 4. Action Buttons */}
        <DrawerFooter className="px-5 py-4 border-t border-border/50 bg-card/50 flex flex-row items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isDropping}
            className="flex-1 h-12 rounded-2xl uppercase text-xs font-bold border-border/80 hover:bg-muted active:scale-[0.98] transition-all"
          >
            Keep Shift
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={isDropping || !canConfirm}
            className="flex-1 h-12 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white uppercase text-xs font-bold shadow-lg shadow-rose-950/20 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {isDropping ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Dropping...
              </span>
            ) : (
              'Confirm Drop'
            )}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default DropShiftDrawer;
