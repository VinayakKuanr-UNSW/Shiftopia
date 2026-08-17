import React from 'react';
import { format, parseISO } from 'date-fns';
import { PhoneCall, Calendar, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import type { NearMiss } from '../../domain/team-coverage';

interface Props {
    nearMisses: ReadonlyArray<NearMiss>;
    limit?: number;
}

export const NearMissPanel: React.FC<Props> = ({ nearMisses, limit = 40 }) => {
    const { isDark } = useTheme();

    const groups = React.useMemo(() => {
        const map = new Map<string, NearMiss[]>();
        for (const nm of nearMisses.slice(0, limit)) {
            const list = map.get(nm.shiftId) ?? [];
            list.push(nm);
            map.set(nm.shiftId, list);
        }
        return [...map.values()];
    }, [nearMisses, limit]);

    if (nearMisses.length === 0) {
        return (
            <div className="py-12 text-center rounded-2xl border border-dashed border-border/40 bg-muted/10 p-6">
                <AlertTriangle className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm font-bold text-foreground">
                    No near misses in this range
                </p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
                    Every unfilled shift is either fully coverable or has nobody available within an hour of fitting.
                </p>
            </div>
        );
    }

    return (
        <section aria-labelledby="near-misses-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3 pb-1 border-b border-border/20">
                <h3 id="near-misses-heading" className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                    <span>
                        {nearMisses.length} Near {nearMisses.length === 1 ? 'Miss' : 'Misses'}
                    </span>
                </h3>
                <p className="text-[11px] font-medium text-muted-foreground">
                    Showing closest available members matching unfilled shift times
                </p>
            </div>

            <ul className="space-y-3" aria-label="Near miss shift list">
                {groups.map((group) => {
                    const shift = group[0];
                    const formattedDate = format(parseISO(shift.shiftDate), 'EEE d MMM');

                    return (
                        <li
                            key={shift.shiftId}
                            className={cn(
                                'rounded-2xl border p-3.5 transition-all duration-200 shadow-xs hover:border-primary/30',
                                isDark
                                    ? 'bg-[#111827]/70 border-white/10'
                                    : 'bg-white border-slate-200/90 shadow-slate-100',
                            )}
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-border/20">
                                <div className="flex items-center gap-2">
                                    <span className="flex items-center gap-1.5 text-xs font-black text-foreground">
                                        <Calendar className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                        {formattedDate}
                                    </span>
                                    <span className="text-border/40">•</span>
                                    <span className="flex items-center gap-1 text-xs font-bold text-foreground tabular-nums">
                                        <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                                        {shift.shiftStart}–{shift.shiftEnd}
                                    </span>
                                </div>
                                <span className="px-2 py-0.5 rounded-lg bg-primary/10 text-primary text-[10px] font-black uppercase tracking-wider border border-primary/20">
                                    {shift.roleName ?? 'Unfilled Shift'}
                                </span>
                            </div>

                            <ul className="space-y-2" aria-label={`Near miss candidate members for ${formattedDate}`}>
                                {group.map((nm) => (
                                    <li
                                        key={`${nm.shiftId}-${nm.profileId}`}
                                        className={cn(
                                            'flex flex-wrap items-center justify-between gap-2.5 p-2.5 rounded-xl border transition-colors',
                                            isDark ? 'bg-muted/20 border-white/5 hover:bg-white/5' : 'bg-slate-50 border-slate-200/60 hover:bg-slate-100/80'
                                        )}
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <button
                                                type="button"
                                                title={`Contact ${nm.memberName}`}
                                                aria-label={`Contact ${nm.memberName}`}
                                                className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
                                            >
                                                <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
                                            </button>
                                            <div className="min-w-0">
                                                <span className="block text-xs font-bold text-foreground truncate">
                                                    {nm.memberName}
                                                </span>
                                                <span className="block text-[10px] font-medium text-muted-foreground tabular-nums">
                                                    Declared: {nm.windows.map((w) => `${w.start}–${w.end}`).join(', ')}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase tracking-wider tabular-nums">
                                                {nm.shortfallMinutes} min short
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

export default NearMissPanel;
