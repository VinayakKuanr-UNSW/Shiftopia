/**
 * Why people cancelled — the distribution the reason picker exists to produce.
 *
 * Horizontal bars rather than a donut: reason labels are words, not codes, and
 * a horizontal bar gives each one a full line to be read on. The bar is split
 * standard / critical so a manager can see not just WHICH reasons dominate but
 * whether that reason tends to arrive with notice.
 *
 * A visually-hidden table carries the same numbers, because an SVG-free bar
 * chart is still a chart to a screen reader.
 */

import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import type { CancellationReasonRow } from '../../hooks/useCancellationReasonBreakdown';

interface ReasonBreakdownProps {
    rows: CancellationReasonRow[];
    className?: string;
}

export const ReasonBreakdown: React.FC<ReasonBreakdownProps> = ({ rows, className }) => {
    const max = Math.max(1, ...rows.map((r) => r.total));

    return (
        <div className={cn('rounded-2xl border border-border bg-card p-4', className)}>
            <ul className="flex flex-col gap-3" aria-hidden="true">
                {rows.map((r) => {
                    const standardWidth = (r.standard_count / max) * 100;
                    const criticalWidth = (r.critical_count / max) * 100;
                    return (
                        <li key={r.reason_code} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
                            <span className={cn(text.label, 'truncate text-foreground')} title={r.reason_label}>
                                {r.reason_label}
                            </span>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex h-5 w-full cursor-help items-center gap-px overflow-hidden rounded-md bg-muted/50">
                                        {r.standard_count > 0 && (
                                            <div
                                                className="h-full rounded-l-md bg-slate-400 dark:bg-slate-500"
                                                style={{ width: `${standardWidth}%` }}
                                            />
                                        )}
                                        {r.critical_count > 0 && (
                                            <div
                                                className="h-full bg-rose-500/80"
                                                style={{ width: `${criticalWidth}%` }}
                                            />
                                        )}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[260px]">
                                    <p className="font-semibold">{r.reason_label}</p>
                                    <p className="mt-1 text-xs">
                                        {r.standard_count} standard · {r.critical_count} critical
                                        {r.emergent_count > 0 && ` (${r.emergent_count} inside the 4h emergent window)`}
                                    </p>
                                    {r.avg_notice_hours !== null && (
                                        <p className="text-xs">Average notice {r.avg_notice_hours}h</p>
                                    )}
                                </TooltipContent>
                            </Tooltip>

                            <span className={cn(text.metric, 'w-20 text-right text-muted-foreground')}>
                                {r.total} · {r.share_pct}%
                            </span>
                        </li>
                    );
                })}
            </ul>

            <div className="mt-4 flex items-center gap-4 border-t border-border pt-3">
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-slate-400 dark:bg-slate-500" aria-hidden="true" />
                    <span className={text.caption}>Standard — more than 24h notice</span>
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-rose-500/80" aria-hidden="true" />
                    <span className={text.caption}>Critical — 24h or less</span>
                </span>
            </div>

            {/* Same numbers, reachable without seeing the bars. */}
            <table className="sr-only">
                <caption>Cancellations by reason</caption>
                <thead>
                    <tr>
                        <th scope="col">Reason</th>
                        <th scope="col">Total</th>
                        <th scope="col">Standard</th>
                        <th scope="col">Critical</th>
                        <th scope="col">Share</th>
                        <th scope="col">Average notice (hours)</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.reason_code}>
                            <th scope="row">{r.reason_label}</th>
                            <td>{r.total}</td>
                            <td>{r.standard_count}</td>
                            <td>{r.critical_count}</td>
                            <td>{r.share_pct}%</td>
                            <td>{r.avg_notice_hours ?? 'unknown'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default ReasonBreakdown;
