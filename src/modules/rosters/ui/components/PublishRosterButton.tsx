import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { Send, Loader2, Calendar } from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';
import type { PublishRosterPlan } from '@/modules/rosters/domain/bulk-action-engine';

/** Outcome of executing a {@link PublishRosterPlan}. */
export interface PublishRosterResult {
  published: number;
  deleted: number;
  failed: number;
  failedReasons?: string[];
}

interface PublishRosterButtonProps {
  /** Disables the trigger (e.g. no edit permission or no org selected). */
  disabled?: boolean;
  /**
   * Loads the current roster and partitions it into the publish plan. Called
   * when the button is clicked — runs a (cached) fetch so it works in every
   * view, including the default Group Bucket View where the grid renders
   * summary cells only and no per-shift list is loaded.
   */
  loadPlan: () => Promise<PublishRosterPlan>;
  /** Executes the plan: deletes dead shifts, then publishes the rest. */
  execute: (plan: PublishRosterPlan) => Promise<PublishRosterResult>;
  selectedViewType?: string;
  selectedViewRange?: string;
}

/**
 * Six-state-free mini machine: idle → loading (fetch plan) → confirming
 * (dialog with counts) → executing → back to idle. The dialog is only mounted
 * once a plan is in hand.
 */
type State =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'confirming'; plan: PublishRosterPlan }
  | { type: 'executing'; plan: PublishRosterPlan };

/**
 * One-click roster finalize. Publishes all assigned drafts (→ offers) and all
 * unassigned drafts (→ open bidding), and deletes dead shifts (unassigned
 * drafts whose window is already live). Always confirms first — the action
 * broadcasts to employees and permanently deletes shifts.
 */
export const PublishRosterButton: React.FC<PublishRosterButtonProps> = ({
  disabled,
  loadPlan,
  execute,
  selectedViewType,
  selectedViewRange,
}) => {
  const [state, setState] = useState<State>({ type: 'idle' });
  const { toast } = useToast();

  const isLoading = state.type === 'loading';
  const isExecuting = state.type === 'executing';
  const dialogOpen = state.type === 'confirming' || state.type === 'executing';

  const plan =
    state.type === 'confirming' || state.type === 'executing' ? state.plan : null;
  const assignedCount = plan?.assignedIds.length ?? 0;
  const unassignedCount = plan?.unassignedIds.length ?? 0;
  const emergentAssignedCount = plan?.emergentAssignedIds.length ?? 0;
  const emergentUnassignedCount = plan?.emergentUnassignedIds.length ?? 0;
  const deadCount = plan?.deadIds.length ?? 0;
  const alreadyPublishedCount = plan?.alreadyPublishedCount ?? 0;

  // What the Confirm button will actually change: publishes (X + Y + A) and
  // deletes (W). Emergent-unassigned (B) and already-published (Z) are skips.
  const actionableCount =
    assignedCount + unassignedCount + emergentAssignedCount + deadCount;
  // The plan considered no shifts at all → nothing to show.
  const consideredCount =
    actionableCount + emergentUnassignedCount + alreadyPublishedCount;
  const nothingToDo = plan !== null && consideredCount === 0;

  // The six calculations shown in the confirm dialog, in order.
  const steps: Array<{
    count: number;
    title: string;
    desc: string;
    tone: 'success' | 'info' | 'warning' | 'muted' | 'danger';
  }> = [
    {
      count: assignedCount,
      title: `${assignedCount} Assigned Shift${assignedCount !== 1 ? 's' : ''}`,
      desc: 'Sent as offers to scheduled employees',
      tone: 'success',
    },
    {
      count: unassignedCount,
      title: `${unassignedCount} Unassigned Shift${unassignedCount !== 1 ? 's' : ''}`,
      desc: 'Pushed to open bidding for eligible employees',
      tone: 'success',
    },
    {
      count: emergentAssignedCount,
      title: `${emergentAssignedCount} Assigned · starts < 4h`,
      desc: 'Emergency-assigned to the scheduled employee',
      tone: 'info',
    },
    {
      count: emergentUnassignedCount,
      title: `${emergentUnassignedCount} Unassigned · starts < 4h`,
      desc: 'Can’t open bidding — assign these manually (skipped)',
      tone: 'warning',
    },
    {
      count: alreadyPublishedCount,
      title: `${alreadyPublishedCount} Already Published`,
      desc: 'Left unchanged — skipped',
      tone: 'muted',
    },
    {
      count: deadCount,
      title: `${deadCount} Dead Shift${deadCount !== 1 ? 's' : ''}`,
      desc: 'Unassigned & already live — permanently deleted',
      tone: 'danger',
    },
  ];

  // Node styling per tone when the step is active (count > 0).
  const TONE_NODE: Record<(typeof steps)[number]['tone'], string> = {
    success: 'border-emerald-500 text-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10',
    info: 'border-blue-500 text-blue-500 bg-blue-500/5 dark:bg-blue-500/10',
    warning: 'border-amber-500 text-amber-500 bg-amber-500/5 dark:bg-amber-500/10',
    muted: 'border-slate-300 dark:border-white/15 text-slate-400',
    danger: 'border-red-500 text-red-500 bg-red-500/5 dark:bg-red-500/10',
  };
  const TONE_GLYPH: Record<(typeof steps)[number]['tone'], string> = {
    success: '✓',
    info: '⚡',
    warning: '!',
    muted: '–',
    danger: '✗',
  };

  const handleClick = async () => {
    setState({ type: 'loading' });
    try {
      const loaded = await loadPlan();
      setState({ type: 'confirming', plan: loaded });
    } catch {
      toast({
        title: 'Could not prepare publish',
        description: 'Failed to load the roster. Try again.',
        variant: 'destructive',
      });
      setState({ type: 'idle' });
    }
  };

  const handleConfirm = async () => {
    if (state.type !== 'confirming') return;
    const toRun = state.plan;
    setState({ type: 'executing', plan: toRun });
    try {
      const result = await execute(toRun);
      const parts: string[] = [];
      if (result.published) parts.push(`${result.published} published`);
      if (result.deleted)
        parts.push(`${result.deleted} dead shift${result.deleted !== 1 ? 's' : ''} removed`);
      if (result.failed) parts.push(`${result.failed} skipped`);
      toast({
        title: result.failed ? 'Roster published — with skips' : 'Roster published',
        description: parts.length ? parts.join(' · ') : 'Nothing to publish.',
        variant: result.failed ? 'destructive' : 'default',
      });
      setState({ type: 'idle' });
    } catch (e: any) {
      toast({
        title: 'Publish failed',
        description: e?.message ?? 'Something went wrong.',
        variant: 'destructive',
      });
      setState({ type: 'idle' });
    }
  };

  return (
    <>
      <Button
        size="sm"
        onClick={handleClick}
        disabled={disabled || isLoading}
        aria-label="Publish roster — send offers, open bidding, remove dead shifts"
        className={cn(
          'h-10 min-h-[44px] sm:min-h-[36px] sm:h-9 gap-2 rounded-xl px-4 text-xs font-extrabold uppercase tracking-wider shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
          'bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95',
        )}
        title="Publish roster — send offers, open bidding, remove dead shifts"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
        ) : (
          <Send className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        Publish
      </Button>

      <AlertDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && !isExecuting) setState({ type: 'idle' });
        }}
      >
        <AlertDialogContent className="max-w-xl rounded-2xl border border-slate-200 dark:border-white/10 p-8 bg-white dark:bg-slate-950 shadow-2xl">
          <AlertDialogHeader className="space-y-5">
            <AlertDialogTitle className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
              Confirm Publish
            </AlertDialogTitle>
            
            {/* VIEW SELECTED Card */}
            <div className="flex items-center gap-4 p-5 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl shadow-sm">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-500">
                <Calendar className="h-6 w-6" />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-white/40">
                  VIEW SELECTED
                </span>
                <span className="text-base font-extrabold text-slate-900 dark:text-white">
                  {selectedViewType || 'Week'}
                </span>
                <span className="text-sm text-slate-500 dark:text-white/60 font-semibold mt-0.5">
                  {selectedViewRange || '6 Jul - 12 Jul'}
                </span>
              </div>
            </div>

            <AlertDialogDescription asChild>
              <div className="space-y-6 text-sm">
                {nothingToDo ? (
                  <p className="text-muted-foreground text-center py-6 text-base font-medium">
                    No draft or dead shifts in the current view — nothing to publish.
                  </p>
                ) : (
                  <>
                    <p className="text-slate-600 dark:text-slate-400 text-left text-sm font-semibold">
                      The following will be applied to every draft shift in the current view:
                    </p>

                    {/* Stepper / Timeline Checklist — all six calculations */}
                    <div className="relative pl-8 space-y-6 text-left before:absolute before:left-[13px] before:top-2.5 before:bottom-2.5 before:w-[2px] before:bg-slate-100 dark:before:bg-white/10">
                      {steps.map((step, i) => {
                        const active = step.count > 0;
                        return (
                          <div key={i} className="relative flex items-start gap-4">
                            <div
                              className={cn(
                                'absolute left-[-25px] flex items-center justify-center w-7 h-7 rounded-full border bg-white dark:bg-slate-950 text-xs font-black transition-colors',
                                active
                                  ? TONE_NODE[step.tone]
                                  : 'border-slate-200 dark:border-white/10 text-slate-400',
                              )}
                            >
                              {active ? (
                                <span>{TONE_GLYPH[step.tone]}</span>
                              ) : (
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-white/20" />
                              )}
                            </div>
                            <div className="flex flex-col">
                              <span
                                className={cn(
                                  'text-base font-bold',
                                  active
                                    ? 'text-slate-900 dark:text-white'
                                    : 'text-slate-400 dark:text-white/40',
                                )}
                              >
                                {step.title}
                              </span>
                              <span
                                className={cn(
                                  'text-sm',
                                  active && step.tone === 'danger'
                                    ? 'text-red-500 font-semibold'
                                    : active && step.tone === 'warning'
                                      ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                      : 'text-slate-500 dark:text-white/60 font-medium',
                                )}
                              >
                                {step.desc}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col-reverse sm:flex-row gap-3 mt-6">
            <AlertDialogCancel 
              disabled={isExecuting}
              className="w-full sm:w-auto rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 py-6 h-12 font-bold transition-all text-sm"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="w-full sm:w-auto bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white/90 font-bold rounded-xl py-6 h-12 shadow-md transition-all flex items-center justify-center gap-2 text-sm"
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              disabled={isExecuting || nothingToDo}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Publishing…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Confirm Publish
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PublishRosterButton;
