import React, { useState } from 'react';
import { AlertTriangle, Bot, Eye, RefreshCw, ShieldCheck, ShieldX, Undo2, Zap } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import {
    type AutoPilotAdapter,
    type AutoPilotDecision,
    type AutoPilotMode,
    isDecisionRevertable,
    policyMode,
} from './types';
import { useAutoPilot } from './useAutoPilot';

/* ============================================================ MODE STYLES */

const MODE_STYLES: Record<AutoPilotMode, { badge: string; label: string }> = {
    OFF: { badge: 'bg-muted text-muted-foreground/50 border-border', label: 'Off' },
    ON: { badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', label: 'On' },
};

/* ============================================================ FEED ROW */

const DECISION_ROW_ICON: Record<AutoPilotDecision['kind'], React.ReactNode> = {
    AUTO_APPROVE: <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />,
    AUTO_REJECT: <ShieldX className="h-3.5 w-3.5 text-rose-500" />,
    MANUAL_REVIEW: <Eye className="h-3.5 w-3.5 text-amber-500" />,
};

const DecisionFeedRow: React.FC<{
    decision: AutoPilotDecision;
    canRevert: boolean;
    onRevert?: (d: AutoPilotDecision) => void;
    isReverting: boolean;
}> = ({ decision, canRevert, onRevert, isReverting }) => (
    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-border/40 bg-muted/10">
        <div className="mt-0.5 shrink-0">{DECISION_ROW_ICON[decision.kind]}</div>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80">
                    {decision.kind.replace('_', ' ')}
                    {decision.target && <span className="text-foreground/50"> → {decision.target}</span>}
                </span>
                {decision.committed && !decision.revertedAt && (
                    <span className="text-[8px] font-black font-mono uppercase px-1.5 py-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        Committed
                    </span>
                )}
                {decision.revertedAt && (
                    <span className="text-[8px] font-black font-mono uppercase px-1.5 py-0 rounded-full border border-border bg-muted text-muted-foreground/60">
                        Reverted
                    </span>
                )}
            </div>
            {decision.subtitle && (
                <span className="text-[10px] font-mono text-foreground/60 truncate">{decision.subtitle}</span>
            )}
            {decision.reason && (
                <span className="text-[9px] text-muted-foreground/60 italic leading-relaxed line-clamp-2" title={decision.reason}>
                    {decision.reason}
                </span>
            )}
            <span className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-wider">
                {formatDistanceToNow(parseISO(decision.createdAt), { addSuffix: true })}
            </span>
        </div>
        {canRevert && onRevert && isDecisionRevertable(decision) && (
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

/* ============================================================ MAIN CONTROL */

interface AutoPilotControlProps {
    adapter: AutoPilotAdapter;
    /** whether the current org context is resolved; hidden until then */
    ready?: boolean;
    /** refetch the parent list after an undo commits */
    onChanged?: () => void;
}

export const AutoPilotControl: React.FC<AutoPilotControlProps> = ({ adapter, ready = true, onChanged }) => {
    const [open, setOpen] = useState(false);
    const {
        isLoading, isSaving, revertingId,
        policy, draft, setDraft, decisions, isDirty, load, save, revert,
    } = useAutoPilot(adapter, open);

    const { copy, policyFields, supportsRevert } = adapter;
    const mode = policyMode(policy);
    const draftMode = policyMode(draft);
    const modeStyle = MODE_STYLES[mode];

    if (!ready) return null;

    const setField = (key: string, value: number | boolean) =>
        setDraft(d => ({ ...d, fields: { ...d.fields, [key]: value } }));

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
                    title={copy.buttonTitle}
                >
                    <Bot className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline uppercase tracking-wider">{copy.buttonLabel}</span>
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
                            <span className="text-[11px] font-black uppercase tracking-widest text-foreground">{copy.title}</span>
                            <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">{copy.subtitle}</span>
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
                            <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80">AutoPilot</span>
                            <span className="text-[9px] text-muted-foreground/50">
                                {draft.enabled ? 'The bot acts automatically' : 'Off — every decision stays manual'}
                            </span>
                        </div>
                        <Switch checked={draft.enabled} onCheckedChange={v => setDraft(d => ({ ...d, enabled: v }))} />
                    </label>

                    {/* Domain-specific policy fields */}
                    {policyFields.map(f => {
                        const gated = f.gatedByEnabled && !draft.enabled;
                        if (f.type === 'toggle') {
                            return (
                                <label key={f.key} className={cn('flex items-center justify-between gap-3 cursor-pointer', gated && 'opacity-40 pointer-events-none')}>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80">{f.label}</span>
                                        {f.hint && <span className="text-[9px] text-muted-foreground/50">{f.hint}</span>}
                                    </div>
                                    <Switch checked={!!draft.fields[f.key]} onCheckedChange={v => setField(f.key, v)} />
                                </label>
                            );
                        }
                        return (
                            <label key={f.key} className={cn('flex items-center justify-between gap-3', gated && 'opacity-40 pointer-events-none')}>
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80">{f.label}</span>
                                    {f.hint && <span className="text-[9px] text-muted-foreground/50">{f.hint}</span>}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <input
                                        type="number"
                                        min={f.min ?? 0}
                                        max={f.max ?? 999}
                                        value={Number(draft.fields[f.key] ?? 0)}
                                        onChange={e => {
                                            const raw = Number(e.target.value) || 0;
                                            const clamped = Math.min(f.max ?? 999, Math.max(f.min ?? 0, raw));
                                            setField(f.key, clamped);
                                        }}
                                        className="w-16 h-8 px-2 rounded-lg border border-border bg-background text-center text-xs font-mono font-black text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                                    />
                                    {f.unit && <span className="text-[9px] font-mono text-muted-foreground/50">{f.unit}</span>}
                                </div>
                            </label>
                        );
                    })}

                    {/* Turning-ON warning */}
                    {isDirty && draftMode === 'ON' && mode !== 'ON' && (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/20 bg-amber-500/5">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <span className="text-[9px] text-amber-600 dark:text-amber-400 leading-relaxed font-medium">
                                {copy.onWarning}
                            </span>
                        </div>
                    )}

                    {isDirty && (
                        <Button
                            onClick={() => save()}
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
                                No decisions yet. {mode === 'OFF' ? 'Enable the policy to start.' : copy.emptyFeedHint}
                            </span>
                        </div>
                    ) : (
                        decisions.map(d => (
                            <DecisionFeedRow
                                key={d.id}
                                decision={d}
                                canRevert={supportsRevert && !!adapter.revert}
                                onRevert={dec => revert(dec, onChanged)}
                                isReverting={revertingId === d.id}
                            />
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};
