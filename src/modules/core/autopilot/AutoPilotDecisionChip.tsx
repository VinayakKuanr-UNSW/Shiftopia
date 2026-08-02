import React from 'react';
import { Bot } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import { type AutoPilotCopy, type AutoPilotDecision } from './types';

/** Presentation for one normalized decision. Uniform across every domain. */
const chipPresentation = (
    d: AutoPilotDecision,
    copy: AutoPilotCopy,
): { label: string; cls: string } => {
    if (d.revertedAt) {
        return { label: 'Auto-decision undone', cls: 'bg-muted text-muted-foreground/60 border-border' };
    }
    if (d.committed && d.kind === 'AUTO_APPROVE') {
        return { label: copy.committedLabels.approve, cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' };
    }
    if (d.committed && d.kind === 'AUTO_REJECT') {
        return { label: copy.committedLabels.reject, cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' };
    }
    if (d.kind === 'MANUAL_REVIEW') {
        return { label: 'Bot: needs review', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' };
    }
    return { label: 'Bot: not committed', cls: 'bg-muted text-muted-foreground/60 border-border' };
};

export const AutoPilotDecisionChip: React.FC<{
    decision: AutoPilotDecision;
    copy: AutoPilotCopy;
}> = ({ decision, copy }) => {
    const { label, cls } = chipPresentation(decision, copy);
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={cn(
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[8px] font-black font-mono uppercase tracking-wider whitespace-nowrap',
                            cls,
                        )}
                    >
                        <Bot className="h-2.5 w-2.5" />
                        {label}
                        {decision.target && <span className="opacity-70">→ {decision.target}</span>}
                    </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-popover text-popover-foreground border-border shadow-xl max-w-[260px]">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-black uppercase tracking-wider">{label}</span>
                        {decision.subtitle && (
                            <span className="text-[9px] font-mono text-muted-foreground">{decision.subtitle}</span>
                        )}
                        {decision.reason && (
                            <span className="text-[9px] text-muted-foreground leading-relaxed">{decision.reason}</span>
                        )}
                        <span className="text-[9px] font-mono text-muted-foreground opacity-60">
                            {format(parseISO(decision.createdAt), 'MMM d, h:mm a')} · {decision.engineVersion}
                        </span>
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};
