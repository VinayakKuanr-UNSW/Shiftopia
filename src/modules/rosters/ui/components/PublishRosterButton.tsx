import React, { useEffect, useId, useState } from 'react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { Send, Loader2, Calendar } from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';
import type { PublishRosterPlan } from '@/modules/rosters/domain/bulk-action-engine';

/** Outcome of executing a {@link PublishRosterPlan}. */
export interface PublishRosterResult {
  published: number;
  failed: number;
  failedReasons?: string[];
}

interface PublishRosterButtonProps {
  /** Disables the trigger (e.g. no edit permission or no org selected). */
  disabled?: boolean;
  /**
   * Why it is disabled. Shown on hover and focus and read as the button's
   * description. The button stays focusable (aria-disabled, not `disabled`)
   * so a keyboard user can reach the explanation at all.
   */
  disabledReason?: string;
  /**
   * Loads the current roster and partitions it into the publish plan. Called
   * when the button is clicked — a fresh, strict read (it throws rather than
   * plan from a partial roster) so it works in every view, including the
   * default Group Bucket View where the grid renders summary cells only and no
   * per-shift list is loaded.
   */
  loadPlan: () => Promise<PublishRosterPlan>;
  /** Executes the plan: publishes the drafts. Started shifts are never deleted. */
  execute: (plan: PublishRosterPlan) => Promise<PublishRosterResult>;
  selectedViewType?: string;
  selectedViewRange?: string;
  className?: string;
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
 * unassigned drafts (→ open bidding). Unassigned drafts that have already
 * started are reported and left alone: a started shift is never deleted.
 * Always confirms first — the action broadcasts to employees.
 */
/**
 * Group skip reasons for the result toast: most common first, a count when a
 * reason repeats, the rest summarised. Without it the toast said "3 skipped"
 * and the manager could not tell a compliance block from a timeout.
 */
export function summariseReasons(reasons: readonly string[], max = 2): string {
  const counts = new Map<string, number>();
  for (const r of reasons) {
    if (!r) continue;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const shown = sorted.slice(0, max).map(([r, n]) => (n > 1 ? `${r} (×${n})` : r));
  const rest = sorted.length - shown.length;
  return shown.join(' · ') + (rest > 0 ? ` · and ${rest} other reason${rest > 1 ? 's' : ''}` : '');
}

export const PublishRosterButton: React.FC<PublishRosterButtonProps> = ({
  disabled,
  disabledReason,
  loadPlan,
  execute,
  selectedViewType,
  selectedViewRange,
  className,
}) => {
  const [state, setState] = useState<State>({ type: 'idle' });
  const { toast } = useToast();
  const reasonId = useId();

  const isLoading = state.type === 'loading';
  const isExecuting = state.type === 'executing';
  const dialogOpen = state.type === 'confirming' || state.type === 'executing';

  // Closing the tab mid-publish leaves the manager without the result (and the
  // emergency shifts, published one by one, half done), so the browser asks first.
  useEffect(() => {
    if (!isExecuting) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isExecuting]);

  const plan =
    state.type === 'confirming' || state.type === 'executing' ? state.plan : null;
  const assignedCount = plan?.assignedIds.length ?? 0;
  const unassignedCount = plan?.unassignedIds.length ?? 0;
  const emergentAssignedCount = plan?.emergentAssignedIds.length ?? 0;
  const emergentUnassignedCount = plan?.emergentUnassignedIds.length ?? 0;
  const deadCount = plan?.deadIds.length ?? 0;
  const fullTimeCount = plan?.fullTimeIds.length ?? 0;
  const fullTimeUnassignedCount = plan?.fullTimeUnassignedIds.length ?? 0;
  const onLeaveCount = plan?.onLeaveIds?.length ?? 0;
  const pastCount = plan?.pastIds?.length ?? 0;
  const noPermissionCount = plan?.noPermissionIds?.length ?? 0;
  const alreadyPublishedCount = plan?.alreadyPublishedCount ?? 0;

  // What the Confirm button will actually change: publishes (X + Y + A).
  // Emergent-unassigned (B), started-unstaffed (W) and already-published (Z)
  // are skips.
  const actionableCount =
    assignedCount + unassignedCount + emergentAssignedCount + fullTimeCount;
  // The plan considered no shifts at all → nothing to show.
  const consideredCount =
    actionableCount + emergentUnassignedCount + alreadyPublishedCount + deadCount + fullTimeUnassignedCount
    + onLeaveCount + pastCount + noPermissionCount;
  const nothingToDo = plan !== null && consideredCount === 0;
  // Drafts exist, but every one is a skip: Confirm would change nothing.
  const nothingPublishable = plan !== null && !nothingToDo && actionableCount === 0;

  // The calculations shown in the confirm dialog, in order.
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
      count: fullTimeCount,
      title: `${fullTimeCount} Full-time Shift${fullTimeCount !== 1 ? 's' : ''}`,
      desc: 'Confirmed directly — contracted hours, no offer to accept',
      tone: 'success',
    },
    {
      count: fullTimeUnassignedCount,
      title: `${fullTimeUnassignedCount} Full-time · nobody on it`,
      desc: 'A full-time shift never goes to bidding — assign it first (skipped)',
      tone: 'warning',
    },
    {
      count: onLeaveCount,
      title: `${onLeaveCount} On approved leave`,
      desc: 'The assignee is on approved leave that day — reassign or remove the shift (skipped)',
      tone: 'warning',
    },
    {
      count: noPermissionCount,
      title: `${noPermissionCount} Where you can only view`,
      desc: 'You do not have publish rights in that department — skipped',
      tone: 'warning',
    },
    {
      count: pastCount,
      title: `${pastCount} Already started or finished`,
      desc: 'Too late to publish — skipped',
      tone: 'muted',
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
      title: `${deadCount} Started · nobody on it`,
      desc: 'Already started, so it can’t be published or deleted — skipped',
      tone: 'warning',
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

  // Only checks that hit a shift get a row; the rest collapse to one line.
  const activeSteps = steps.filter((s) => s.count > 0);
  const emptyStepLabels = steps
    .filter((s) => s.count === 0)
    .map((s) => s.title.replace(/^0 /, ''));

  const handleClick = async () => {
    // aria-disabled, not `disabled`: the button stays focusable, so guard here.
    if (disabled || state.type !== 'idle') return;
    setState({ type: 'loading' });
    try {
      const loaded = await loadPlan();
      setState({ type: 'confirming', plan: loaded });
    } catch (e) {
      // No dialog on a failed or incomplete read: a plan built from part of the
      // roster would publish part of it. Say why (e.g. a view over the row cap).
      toast({
        title: 'Could not prepare publish',
        description: e instanceof Error && e.message ? e.message : 'Failed to load the roster. Try again.',
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
      if (result.failed) parts.push(`${result.failed} skipped`);
      const why = result.failed ? summariseReasons(result.failedReasons ?? []) : '';
      toast({
        title: result.failed ? 'Roster published — with skips' : 'Roster published',
        description: (parts.length ? parts.join(' · ') : 'Nothing to publish.') + (why ? ` — ${why}` : ''),
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
      {(() => {
        const inert = disabled || isLoading;
        const explain = disabled && disabledReason ? disabledReason : undefined;
        const trigger = (
          <button
            type="button"
            onClick={handleClick}
            // aria-disabled, not `disabled`: a natively disabled button leaves
            // the tab order, so a keyboard user could never reach the reason.
            aria-disabled={inert || undefined}
            aria-describedby={explain ? reasonId : undefined}
            aria-label="Publish roster — send offers, open bidding"
            className={cn(
              'h-10 w-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
              'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 active:scale-95',
              disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent text-slate-400 dark:text-slate-600 active:scale-100',
              className,
            )}
            title={explain ? undefined : 'Publish roster — send offers, open bidding'}
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden="true" />
            ) : (
              <Send className="h-5 w-5 shrink-0" aria-hidden="true" />
            )}
            {explain && <span id={reasonId} className="sr-only">{explain}</span>}
          </button>
        );

        return (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="text-[11px] uppercase font-extrabold tracking-wider bg-slate-900 border border-slate-700 text-white shadow-xl px-2.5 py-1 rounded-md max-w-xs"
              >
                {explain || 'Publish roster — send offers, open bidding'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })()}

      <AlertDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && !isExecuting) setState({ type: 'idle' });
        }}
      >
        {/* Header and footer pinned, the checklist scrolls: the dialog never
            outgrows the viewport however many skip reasons apply. */}
        <AlertDialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden border-slate-200 bg-white p-0 dark:bg-slate-950">
          <AlertDialogHeader className="space-y-3 border-b border-slate-100 px-5 pb-4 pt-5 text-left dark:border-white/10">
            <AlertDialogTitle>Confirm Publish</AlertDialogTitle>
            {(selectedViewType || selectedViewRange) && (
              <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-600 dark:text-white/70">
                <Calendar className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <span>{[selectedViewType, selectedViewRange].filter(Boolean).join(' · ')}</span>
              </div>
            )}
          </AlertDialogHeader>

          <AlertDialogDescription asChild>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 text-left text-[13px]">
              {nothingToDo ? (
                <p className="py-6 text-center text-[14px] font-medium text-muted-foreground">
                  No draft shifts in the current view — nothing to publish.
                </p>
              ) : (
                <>
                  <p className="mb-3 font-semibold text-slate-600 dark:text-slate-400">
                    {nothingPublishable
                      ? 'Nothing in this view can be published — every draft is skipped for a reason below.'
                      : 'Applied to every draft shift in the current view:'}
                  </p>
                  <ul className="space-y-2">
                    {activeSteps.map((step) => (
                      <li
                        key={step.title}
                        className="flex items-start gap-3 rounded-xl border border-slate-100 px-3 py-2.5 dark:border-white/10"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-black',
                            TONE_NODE[step.tone],
                          )}
                        >
                          {TONE_GLYPH[step.tone]}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[14px] font-bold text-slate-900 dark:text-white">
                            {step.title}
                          </span>
                          <span
                            className={cn(
                              step.tone === 'warning'
                                ? 'font-semibold text-amber-600 dark:text-amber-400'
                                : 'font-medium text-slate-500 dark:text-white/60',
                            )}
                          >
                            {step.desc}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {emptyStepLabels.length > 0 && (
                    <p className="mt-3 text-[11px] font-medium text-slate-400 dark:text-white/40">
                      None: {emptyStepLabels.join(' · ')}
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>

          <AlertDialogFooter className="gap-2 border-t border-slate-100 px-5 py-4 dark:border-white/10">
            <AlertDialogCancel
              disabled={isExecuting}
              className="mt-0 w-full border border-slate-200 font-bold text-[13px] hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5 sm:w-auto"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="w-full sm:w-auto bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white/90 font-bold shadow-md flex items-center justify-center gap-2 text-[13px]"
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              disabled={isExecuting || nothingToDo || nothingPublishable}
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
