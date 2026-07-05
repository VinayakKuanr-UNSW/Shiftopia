import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Eye, RefreshCw, ShieldCheck, ShieldX, Undo2, Zap } from 'lucide-react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Button } from '@/modules/core/ui/primitives/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';
import {
    swapPolicyApi,
    isDecisionRevertable,
    type SwapApprovalPolicy,
    type SwapAutoDecision,
    type SwapPolicyPatch,
} from '../../api/swapPolicy.api';

/* ============================================================
   MODE HELPERS
   ============================================================ */

type AutoApproveMode = 'OFF' | 'SHADOW' | 'LIVE';

const policyMode = (p: Pick<SwapApprovalPolicy, 'enabled' | 'shadow_mode'> | null): AutoApproveMode =>
    !p || !p.enabled ? 'OFF' : p.shadow_mode ? 'SHADOW' : 'LIVE';

const MODE_STYLES: Record<AutoApproveMode, { badge: string; label: string }> = {
    OFF:    { badge: 'bg-muted text-muted-foreground/50 border-border',                                          label: 'Off' },
    SHADOW: { badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',                   label: 'Shadow' },
    LIVE:   { badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',           label: 'Live' },
};

const decisionPartyNames = (d: SwapAutoDecision): string => {
    const name = (p?: { first_name: string | null; last_name: string | null } | null) =>
        [p?.first_name, p?.last_name].filter(Boolean).join(' ');
    const a = name(d.swap?.requested_by);
    const b = name(d.swap?.swap_with);
    if (a && b) return `${a} ↔ ${b}`;
    return a || b || 'Open market swap';
};

/* ============================================================
   PER-REQUEST DECISION CHIP  (used by ManagerSwaps rows/cards)
   ============================================================ */

const chipPresentation = (d: SwapAutoDecision): { label: string; cls: string } => {
    if (d.reverted_at) {
        return { label: 'Auto-approval undone', cls: 'bg-muted text-muted-foreground/60 border-border' };
    }
    if (d.shadow) {
        const verb = d.decision === 'AUTO_APPROVE' ? 'would approve' : d.decision === 'AUTO_REJECT' ? 'would reject' : 'would review';
        const tone = d.decision === 'AUTO_APPROVE'
            ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/5'
            : d.decision === 'AUTO_REJECT'
                ? 'text-rose-600 dark:text-rose-400 border-rose-500/20 bg-rose-500/5'
                : 'text-amber-600 dark:text-amber-400 border-amber-500/20 bg-amber-500/5';
        return { label: `Bot: ${verb}`, cls: tone };
    }
    if (d.committed && d.decision === 'AUTO_APPROVE') {
        return { label: 'Auto-approved', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' };
    }
    if (d.committed && d.decision === 'AUTO_REJECT') {
        return { label: 'Auto-rejected', cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' };
    }
    if (d.decision === 'MANUAL_REVIEW') {
        return { label: 'Bot: needs review', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' };
    }
    return { label: `Bot: ${d.decision.replace('_', ' ').toLowerCase()} (not committed)`, cls: 'bg-muted text-muted-foreground/60 border-border' };
};

export const AutoDecisionChip: React.FC<{ decision: SwapAutoDecision }> = ({ decision }) => {
    const { label, cls } = chipPresentation(decision);
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className={cn(
                        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[8px] font-black font-mono uppercase tracking-wider whitespace-nowrap',
                        cls,
                    )}>
                        <Bot className="h-2.5 w-2.5" />
                        {label}
                    </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-popover text-popover-foreground border-border shadow-xl max-w-[260px]">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-black uppercase tracking-wider">{label}</span>
                        {decision.reason && (
                            <span className="text-[9px] text-muted-foreground leading-relaxed">{decision.reason}</span>
                        )}
                        <span className="text-[9px] font-mono text-muted-foreground opacity-60">
                            {format(parseISO(decision.created_at), 'MMM d, h:mm a')} · {decision.engine_version}
                        </span>
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

/* ============================================================
   DECISION FEED ROW
   ============================================================ */

const DECISION_ROW_ICON: Record<SwapAutoDecision['decision'], React.ReactNode> = {
    AUTO_APPROVE:  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />,
    AUTO_REJECT:   <ShieldX className="h-3.5 w-3.5 text-rose-500" />,
    MANUAL_REVIEW: <Eye className="h-3.5 w-3.5 text-amber-500" />,
};

const DecisionFeedRow: React.FC<{
    decision: SwapAutoDecision;
    onRevert?: (d: SwapAutoDecision) => void;
    isReverting: boolean;
}> = ({ decision, onRevert, isReverting }) => (
    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-border/40 bg-muted/10">
        <div className="mt-0.5 shrink-0">{DECISION_ROW_ICON[decision.decision]}</div>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80">
                    {decision.decision.replace('_', ' ')}
                </span>
                {decision.shadow && (
                    <span className="text-[8px] font-black font-mono uppercase px-1.5 py-0 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        Shadow
                    </span>
                )}
                {decision.committed && !decision.reverted_at && (
                    <span className="text-[8px] font-black font-mono uppercase px-1.5 py-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        Committed
                    </span>
                )}
                {decision.reverted_at && (
                    <span className="text-[8px] font-black font-mono uppercase px-1.5 py-0 rounded-full border border-border bg-muted text-muted-foreground/60">
                        Reverted
                    </span>
                )}
            </div>
            <span className="text-[10px] font-mono text-foreground/60 truncate">{decisionPartyNames(decision)}</span>
            {decision.reason && (
                <span className="text-[9px] text-muted-foreground/60 italic leading-relaxed line-clamp-2" title={decision.reason}>
                    {decision.reason}
                </span>
            )}
            <span className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-wider">
                {formatDistanceToNow(parseISO(decision.created_at), { addSuffix: true })}
            </span>
        </div>
        {onRevert && isDecisionRevertable(decision) && (
            <Button
                size="sm"
                variant="outline"
                disabled={isReverting}
                onClick={() => onRevert(decision)}
                className="h-7 px-2 shrink-0 rounded-lg border-border/60 text-muted-foreground hover:text-foreground text-[9px] font-black uppercase tracking-wider"
            >
                <Undo2 className="h-3 w-3 mr-1" />
                Undo
            </Button>
        )}
    </div>
);

/* ============================================================
   MAIN CONTROL
   ============================================================ */

interface AutoApproveSwapsControlProps {
    organizationId?: string;
    /** auth user id — stamped as updated_by on the policy and as the revert actor */
    userId?: string | null;
    /** Called after a revert so the parent can refetch its request list. */
    onChanged?: () => void;
}

interface PolicyDraft {
    enabled: boolean;
    shadow_mode: boolean;
    auto_approve_warnings: boolean;
    max_auto_per_employee_per_week: number;
}

const DEFAULT_DRAFT: PolicyDraft = {
    enabled: false,
    shadow_mode: true,
    auto_approve_warnings: false,
    max_auto_per_employee_per_week: 3,
};

const draftFromPolicy = (p: SwapApprovalPolicy | null): PolicyDraft =>
    p
        ? {
            enabled: p.enabled,
            shadow_mode: p.shadow_mode,
            auto_approve_warnings: p.auto_approve_warnings,
            max_auto_per_employee_per_week: p.max_auto_per_employee_per_week,
        }
        : { ...DEFAULT_DRAFT };

export const AutoApproveSwapsControl: React.FC<AutoApproveSwapsControlProps> = ({
    organizationId,
    userId,
    onChanged,
}) => {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [revertingId, setRevertingId] = useState<string | null>(null);
    const [policy, setPolicy] = useState<SwapApprovalPolicy | null>(null);
    const [draft, setDraft] = useState<PolicyDraft>({ ...DEFAULT_DRAFT });
    const [decisions, setDecisions] = useState<SwapAutoDecision[]>([]);

    const mode = policyMode(policy);
    const draftMode = policyMode(draft);
    const modeStyle = MODE_STYLES[mode];

    const isDirty = useMemo(() => {
        const base = draftFromPolicy(policy);
        return (Object.keys(draft) as (keyof PolicyDraft)[]).some(k => draft[k] !== base[k]);
    }, [draft, policy]);

    const load = useCallback(async () => {
        if (!organizationId) return;
        setIsLoading(true);
        try {
            const [p, feed] = await Promise.all([
                swapPolicyApi.getOrgPolicy(organizationId),
                swapPolicyApi.getRecentDecisions(20),
            ]);
            setPolicy(p);
            setDraft(draftFromPolicy(p));
            setDecisions(feed);
        } catch (error) {
            console.error('[AutoApproveSwaps] load failed:', error);
            toast({
                title: 'Auto-approve unavailable',
                description: error instanceof Error ? error.message : 'Failed to load the auto-approve policy.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, toast]);

    // Fetch the badge state once on mount (cheap: one row), and the full feed on open.
    useEffect(() => {
        if (!organizationId) return;
        swapPolicyApi.getOrgPolicy(organizationId)
            .then(p => { setPolicy(p); setDraft(draftFromPolicy(p)); })
            .catch(() => { /* badge stays OFF; the popover load surfaces errors */ });
    }, [organizationId]);

    useEffect(() => {
        if (open) load();
    }, [open, load]);

    const handleSave = async () => {
        if (!organizationId) return;
        setIsSaving(true);
        try {
            const patch: SwapPolicyPatch = { ...draft };
            const saved = await swapPolicyApi.saveOrgPolicy(organizationId, patch, userId);
            setPolicy(saved);
            setDraft(draftFromPolicy(saved));
            toast({
                title: 'Auto-approve policy saved',
                description: `Mode: ${MODE_STYLES[policyMode(saved)].label}`,
            });
        } catch (error) {
            console.error('[AutoApproveSwaps] save failed:', error);
            toast({
                title: 'Save failed',
                description: error instanceof Error ? error.message : 'Could not save the policy.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleRevert = async (decision: SwapAutoDecision) => {
        if (!userId) {
            toast({ title: 'Cannot undo', description: 'No authenticated user.', variant: 'destructive' });
            return;
        }
        setRevertingId(decision.id);
        try {
            await swapPolicyApi.revertAutoDecision(decision.id, userId);
            toast({ title: 'Auto-approval undone', description: 'The swap was reverted via the gateway.' });
            await load();
            onChanged?.();
        } catch (error) {
            console.error('[AutoApproveSwaps] revert failed:', error);
            toast({
                title: 'Undo failed',
                description: error instanceof Error ? error.message : 'Could not revert the decision.',
                variant: 'destructive',
            });
        } finally {
            setRevertingId(null);
        }
    };

    if (!organizationId) return null;

    return (
        // modal={false}: modal popovers inside overlay contexts set pointer-events:none on ancestors
        <Popover open={open} onOpenChange={setOpen} modal={false}>
            <PopoverTrigger asChild>
                <button
                    className={cn(
                        'flex items-center gap-2 px-3.5 py-2 rounded-2xl border transition-all duration-300 shrink-0',
                        'bg-muted/30 border-border text-[11px] font-black hover:bg-muted/50',
                        open ? 'text-foreground' : 'text-muted-foreground/70 hover:text-foreground',
                    )}
                    title="Auto-approve swap requests"
                >
                    <Bot className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline uppercase tracking-wider">Auto-Approve</span>
                    <span className={cn(
                        'px-1.5 py-0 rounded-full border text-[8px] font-black font-mono uppercase tracking-wider',
                        modeStyle.badge,
                    )}>
                        {modeStyle.label}
                    </span>
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                sideOffset={8}
                className="w-[400px] p-0 rounded-2xl border-border bg-popover shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20">
                    <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                            <Zap className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[11px] font-black uppercase tracking-widest text-foreground">Auto-Approve Swaps</span>
                            <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">
                                Bot decides manager-pending swaps
                            </span>
                        </div>
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={load}
                        disabled={isLoading}
                        className="h-7 w-7 p-0 rounded-lg text-muted-foreground/60 hover:text-foreground"
                    >
                        <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                    </Button>
                </div>

                {/* Policy controls */}
                <div className="px-4 py-3 flex flex-col gap-3 border-b border-border/50">
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80">Enabled</span>
                            <span className="text-[9px] text-muted-foreground/50">New pending swaps are queued for the bot</span>
                        </div>
                        <Switch
                            checked={draft.enabled}
                            onCheckedChange={v => setDraft(d => ({ ...d, enabled: v }))}
                        />
                    </label>

                    {/* Shadow / Live segmented switch */}
                    <div className={cn('flex flex-col gap-1.5', !draft.enabled && 'opacity-40 pointer-events-none')}>
                        <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80">Mode</span>
                        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/30 border border-border">
                            {(['SHADOW', 'LIVE'] as const).map(m => {
                                const active = (m === 'SHADOW') === draft.shadow_mode;
                                return (
                                    <button
                                        key={m}
                                        onClick={() => setDraft(d => ({ ...d, shadow_mode: m === 'SHADOW' }))}
                                        className={cn(
                                            'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all',
                                            active
                                                ? m === 'LIVE'
                                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20'
                                                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20'
                                                : 'text-muted-foreground/50 hover:text-foreground',
                                        )}
                                    >
                                        {m === 'SHADOW' ? <Eye className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
                                        {m === 'SHADOW' ? 'Shadow' : 'Live'}
                                    </button>
                                );
                            })}
                        </div>
                        <span className="text-[9px] text-muted-foreground/50 leading-relaxed">
                            Shadow: the bot only logs what it <em>would</em> do. Live: approvals and rejections are committed automatically.
                        </span>
                    </div>

                    <label className={cn('flex items-center justify-between gap-3 cursor-pointer', !draft.enabled && 'opacity-40 pointer-events-none')}>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80">Auto-approve warnings</span>
                            <span className="text-[9px] text-muted-foreground/50">Approve swaps with WARNING-level compliance hits</span>
                        </div>
                        <Switch
                            checked={draft.auto_approve_warnings}
                            onCheckedChange={v => setDraft(d => ({ ...d, auto_approve_warnings: v }))}
                        />
                    </label>

                    <label className={cn('flex items-center justify-between gap-3', !draft.enabled && 'opacity-40 pointer-events-none')}>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80">Max auto per employee / week</span>
                            <span className="text-[9px] text-muted-foreground/50">Further swaps route to manual review</span>
                        </div>
                        <input
                            type="number"
                            min={0}
                            max={99}
                            value={draft.max_auto_per_employee_per_week}
                            onChange={e => setDraft(d => ({
                                ...d,
                                max_auto_per_employee_per_week: Math.max(0, Number(e.target.value) || 0),
                            }))}
                            className="w-16 h-8 px-2 rounded-lg border border-border bg-background text-center text-xs font-mono font-black text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                    </label>

                    {/* Going-live warning */}
                    {isDirty && draftMode === 'LIVE' && mode !== 'LIVE' && (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/5">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <span className="text-[9px] text-amber-600 dark:text-amber-400 leading-relaxed font-medium">
                                Live mode lets the bot approve and reject swaps without a manager. Its compliance check covers
                                overlap, 48h weekly, 11h rest and qualifications — a subset of the full rule set. Review the
                                shadow feed below before going live.
                            </span>
                        </div>
                    )}

                    {isDirty && (
                        <Button
                            onClick={handleSave}
                            disabled={isSaving}
                            size="sm"
                            className="h-9 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[10px] font-black uppercase tracking-wider"
                        >
                            {isSaving ? 'Saving…' : 'Save policy'}
                        </Button>
                    )}
                </div>

                {/* Decision feed */}
                <div className="px-4 py-3 flex flex-col gap-2 max-h-[280px] overflow-y-auto custom-scrollbar">
                    <span className="text-[9px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/50">
                        Recent bot decisions
                    </span>
                    {decisions.length === 0 ? (
                        <div className="flex flex-col items-center gap-1.5 py-5 text-center">
                            <Bot className="h-5 w-5 text-muted-foreground/20" />
                            <span className="text-[10px] text-muted-foreground/40 font-mono">
                                No decisions yet. {mode === 'OFF' ? 'Enable the policy to start.' : 'They appear as swaps reach manager review.'}
                            </span>
                        </div>
                    ) : (
                        decisions.map(d => (
                            <DecisionFeedRow
                                key={d.id}
                                decision={d}
                                onRevert={handleRevert}
                                isReverting={revertingId === d.id}
                            />
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};
