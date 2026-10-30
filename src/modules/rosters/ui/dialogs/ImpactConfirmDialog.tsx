/**
 * Confirmation for roster changes that are hard to take back: deleting a
 * sub-group, undoing a template application, applying a template on top of
 * shifts that are already there.
 *
 * It never guesses. Each time it opens it asks the database for a dry run of the
 * exact change (`load`) and shows what that will do. When the change takes away
 * shifts staff already rely on (assigned or published), confirming needs a tick.
 */

import React, { useEffect, useRef, useState } from 'react';
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
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { AlertTriangle, Info, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { ChangeSummary } from './rosterChangeCopy';

// ── Summary body, shared with the rename / clone review step ──────────────────

interface ImpactSummaryViewProps {
  summary: ChangeSummary;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  acknowledgementLabel?: string;
  idPrefix: string;
}

export const ImpactSummaryView: React.FC<ImpactSummaryViewProps> = ({
  summary,
  acknowledged,
  onAcknowledgedChange,
  acknowledgementLabel = 'I understand staff already rely on some of these shifts.',
  idPrefix,
}) => (
  <div className="space-y-3 text-[13px]">
    {summary.lines.length > 0 && (
      <ul className="space-y-1.5 text-foreground leading-relaxed list-disc pl-5" aria-label="What this changes">
        {summary.lines.map(line => <li key={line}>{line}</li>)}
      </ul>
    )}

    {summary.warnings.length > 0 && (
      <div role="note" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-1.5 text-amber-800 dark:text-amber-200">
        {summary.warnings.map(w => (
          <p key={w} className="flex items-start gap-2 leading-relaxed">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{w}</span>
          </p>
        ))}
      </div>
    )}

    {summary.blocked && (
      <p role="status" className="rounded-xl border border-border bg-muted/40 p-3 text-foreground leading-relaxed flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>{summary.blocked}</span>
      </p>
    )}

    {!summary.blocked && summary.needsAcknowledgement && (
      <label htmlFor={`${idPrefix}-ack`} className="flex items-start gap-3 rounded-xl border border-border p-3 cursor-pointer min-h-[44px]">
        <Checkbox
          id={`${idPrefix}-ack`}
          checked={acknowledged}
          onCheckedChange={v => onAcknowledgedChange(v === true)}
          className="mt-0.5"
        />
        <span className="text-foreground leading-relaxed">{acknowledgementLabel}</span>
      </label>
    )}
  </div>
);

/** Whether a summary allows its confirm button. */
export function canConfirmSummary(summary: ChangeSummary | null, acknowledged: boolean): boolean {
  if (!summary || summary.blocked) return false;
  return !summary.needsAcknowledgement || acknowledged;
}

// ── Dialog ────────────────────────────────────────────────────────────────────

interface ImpactConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  tone?: 'destructive' | 'default';
  /** Dry run of the change. Called each time the dialog opens. */
  load: () => Promise<ChangeSummary>;
  /** Makes the change. The dialog closes when it resolves and stays open if it throws. */
  onConfirm: () => Promise<void>;
  acknowledgementLabel?: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; summary: ChangeSummary }
  | { status: 'error'; message: string };

export const ImpactConfirmDialog: React.FC<ImpactConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  tone = 'destructive',
  load,
  onConfirm,
  acknowledgementLabel,
}) => {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const idPrefix = React.useId();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: 'loading' });
    setAcknowledged(false);
    loadRef.current()
      .then(summary => { if (!cancelled) setState({ status: 'ready', summary }); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Could not check what this changes.' });
      });
    return () => { cancelled = true; };
  }, [open, attempt]);

  const summary = state.status === 'ready' ? state.summary : null;
  const canConfirm = canConfirmSummary(summary, acknowledged) && !confirming;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setConfirming(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The mutation reports the failure; leave the dialog open to retry or cancel.
    } finally {
      setConfirming(false);
    }
  };

  const destructive = tone === 'destructive';

  return (
    <AlertDialog open={open} onOpenChange={next => { if (!confirming) onOpenChange(next); }}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] p-0 overflow-hidden text-foreground max-h-[calc(100dvh-3rem)] flex flex-col">
        <div className={cn('p-6 sm:p-7 pb-5 border-b border-border', destructive ? 'bg-destructive/5' : 'bg-muted/30')}>
          <AlertDialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-inner',
                  destructive
                    ? 'bg-destructive/10 text-destructive border-destructive/20'
                    : 'bg-primary/10 text-primary border-primary/20',
                )}
              >
                {destructive ? <AlertTriangle className="h-5 w-5" aria-hidden="true" /> : <Info className="h-5 w-5" aria-hidden="true" />}
              </div>
              <div className="min-w-0">
                <AlertDialogTitle className={cn('text-[15px] sm:text-[17px] font-bold tracking-tight', destructive && 'text-destructive')}>
                  {title}
                </AlertDialogTitle>
                {description && (
                  <AlertDialogDescription className="mt-0.5">
                    {description}
                  </AlertDialogDescription>
                )}
              </div>
            </div>
          </AlertDialogHeader>
        </div>

        <div className="p-6 sm:p-7 overflow-y-auto flex-1" aria-live="polite" aria-busy={state.status === 'loading'}>
          {state.status === 'loading' && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Checking what this changes…
            </p>
          )}
          {state.status === 'error' && (
            <div role="alert" className="space-y-3">
              <p className="text-[13px] text-destructive leading-relaxed">{state.message}</p>
              <Button variant="outline" size="sm" onClick={() => setAttempt(a => a + 1)} className="min-h-[44px] rounded-xl">
                <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
                Try again
              </Button>
            </div>
          )}
          {summary && (
            <ImpactSummaryView
              summary={summary}
              acknowledged={acknowledged}
              onAcknowledgedChange={setAcknowledged}
              acknowledgementLabel={acknowledgementLabel}
              idPrefix={idPrefix}
            />
          )}
        </div>

        <AlertDialogFooter className="p-6 sm:p-7 pt-4 bg-muted/20 dark:bg-muted/5 border-t border-border flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
          <AlertDialogCancel
            disabled={confirming}
            className="w-full sm:w-auto border border-border text-foreground hover:bg-muted font-semibold text-[13px]"
          >
            {summary?.blocked ? 'Close' : 'Cancel'}
          </AlertDialogCancel>
          {!summary?.blocked && (
            <Button
              onClick={handleConfirm}
              disabled={!canConfirm}
              aria-busy={confirming}
              className={cn(
                'w-full sm:w-auto h-11 px-6 rounded-xl font-bold text-[13px] flex items-center justify-center gap-2',
                destructive
                  ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
                  : 'bg-primary hover:bg-primary/90 text-primary-foreground',
              )}
            >
              {confirming && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {summary?.confirmLabel ?? 'Confirm'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
