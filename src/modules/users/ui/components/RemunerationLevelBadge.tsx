import React from 'react';
import { cn } from '@/modules/core/lib/utils';

export interface RemunerationLevelBadgeProps {
    /** -1, null, or undefined render as the unlevelled "—" badge. */
    level: number | null | undefined;
    className?: string;
}

/**
 * L0–L7 colour-coded level badge.
 *
 * Extracted from AddContractDialog.tsx and ContractsSection.tsx, where the
 * exact same 8-branch ternary was duplicated verbatim — now a third
 * consumer (the contract wizard) needs it too.
 */
export const RemunerationLevelBadge: React.FC<RemunerationLevelBadgeProps> = ({ level, className }) => {
    const levelNumber = level != null ? Number(level) : -1;
    const levelLabel = levelNumber >= 0 ? `L${levelNumber}` : '—';

    return (
        <span className={cn(
            "px-2.5 py-1 rounded-lg text-xs font-black font-mono border shrink-0 inline-block",
            levelNumber === 7 ? "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30" :
            levelNumber === 6 ? "bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30" :
            levelNumber === 5 ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30" :
            levelNumber === 4 ? "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30" :
            levelNumber === 3 ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30" :
            levelNumber === 2 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30" :
            levelNumber === 1 ? "bg-teal-500/15 text-teal-600 dark:text-teal-300 border-teal-500/30" :
            "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
            className,
        )}>
            {levelLabel}
        </span>
    );
};

export default RemunerationLevelBadge;
