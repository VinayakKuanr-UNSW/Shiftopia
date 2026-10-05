/**
 * The leave dialogs' shared frame — request (employee), review (manager) and
 * an employee's ledger (manager). Centred, and ONE card in a ledger pastel
 * (`LEDGER_TONE`): sections inside it are divided by hairlines, never split
 * into separate tiles.
 *
 * The shell is solid and borderless; the toned card inside carries the tint
 * and border. The dark tones are translucent washes (as on the ledger cards),
 * so without a solid base the blurred page shows through.
 */
import React from 'react';
import { X } from 'lucide-react';

import { cn } from '@/modules/core/lib/utils';
import { Dialog, DialogClose, DialogContent } from '@/modules/core/ui/primitives/dialog';
import type { LedgerKind } from '../../domain/leave-ledger';
import { LEDGER_TONE } from './LedgerCards';

/** Padding for one section of the card. */
export const cardSection = 'px-6 py-5';
/** Hairlines between sections — put on the scrolling body. */
export const cardDivide = 'divide-y divide-black/[0.06] dark:divide-white/[0.08]';
/** Inputs sit white on the pastel. */
export const cardField = 'rounded-xl border-transparent bg-white shadow-sm dark:bg-background/60';

export const CardDialogClose: React.FC = () => (
    <DialogClose
        className="-mr-3 -mt-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-white/10"
    >
        <X className="h-[18px] w-[18px]" aria-hidden="true" />
        <span className="sr-only">Close</span>
    </DialogClose>
);

export const LeaveCardDialog: React.FC<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Which pastel. Omitted ⇒ neutral. */
    kind?: LedgerKind;
    className?: string;
    /** The scrolling body — give it `cardDivide` and sections `cardSection`. */
    children: React.ReactNode;
    /** Pinned below the body. */
    footer?: React.ReactNode;
}> = ({ open, onOpenChange, kind, className, children, footer }) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
            hideClose
            className={cn(
                'flex max-h-[92dvh] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-3xl border-0 bg-background p-0 sm:rounded-3xl',
                className,
            )}
        >
            <div className={cn('flex min-h-0 flex-1 flex-col rounded-3xl border',
                kind ? LEDGER_TONE[kind] : 'border-border bg-card')}>
                {children}
                {footer && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] px-6 py-4 dark:border-white/[0.08]">
                        {footer}
                    </div>
                )}
            </div>
        </DialogContent>
    </Dialog>
);
