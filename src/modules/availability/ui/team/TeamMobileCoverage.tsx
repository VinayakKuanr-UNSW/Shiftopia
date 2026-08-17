/**
 * TeamMobileCoverage — the coverage curve for one day, on a phone.
 *
 * The desktop heatmap encodes gap as a diverging FILL across an hours × days
 * grid. On one column that reads as a colour strip with no scale, and the fill
 * is the only channel — which fails SC 1.4.1 the moment the grid is gone. So
 * the phone states the numbers and uses length, not hue, as the visual channel:
 * a bar per hour, required against assigned, with the gap written out.
 *
 * Hours with no demand at all are dropped rather than drawn as 24 empty rows —
 * a venue running 06:00–23:00 should not spend a third of the screen on
 * midnight.
 *
 * SHORTFALL IS NOT "MORE RED". A gap you can still fill from declared
 * availability is a rostering task; one you cannot is a recruitment or
 * availability-chasing task. They are separate rows of the same card, never a
 * darker shade of each other.
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { gapFill } from './coverage-palette';
import type { CoverageBucket } from '../../model/team-availability.types';

interface Props {
    buckets: ReadonlyArray<CoverageBucket>;
    /** yyyy-MM-dd — the single day on screen. */
    date: string;
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

export const TeamMobileCoverage: React.FC<Props> = ({ buckets, date }) => {
    const { isDark } = useTheme();
    const headingId = `coverage-${date}`;

    const rows = React.useMemo(
        () =>
            buckets
                .filter((b) => b.date === date && (b.required > 0 || b.assigned > 0))
                .sort((a, b) => a.hour - b.hour),
        [buckets, date],
    );

    const peak = React.useMemo(
        () => rows.reduce((max, b) => Math.max(max, b.required, b.assigned), 0),
        [rows],
    );

    if (rows.length === 0) {
        return (
            <div className="py-12 px-4 text-center border rounded-2xl bg-muted/10">
                <p className="text-sm font-semibold text-muted-foreground">
                    Nothing is scheduled on {format(parseISO(date), 'EEEE d MMMM')}.
                </p>
            </div>
        );
    }

    return (
        <section aria-labelledby={headingId} className="flex flex-col gap-2">
            <h2 id={headingId} className="sr-only">
                {`Coverage by hour for ${format(parseISO(date), 'EEEE d MMMM yyyy')}`}
            </h2>

            <ul role="list" className="flex flex-col gap-1.5 list-none p-0 m-0">
                {rows.map((b) => {
                    const short = b.gap > 0;
                    const summary = [
                        hourLabel(b.hour),
                        `${b.required} required`,
                        `${b.assigned} assigned`,
                        `${b.available} available`,
                        short
                            ? `short ${b.gap}`
                            : b.gap < 0
                              ? `over-rostered by ${Math.abs(b.gap)}`
                              : 'fully staffed',
                        b.shortfall > 0 ? `${b.shortfall} cannot be filled from declared availability` : null,
                    ]
                        .filter(Boolean)
                        .join(', ');

                    return (
                        // The group lives on an inner element, NOT on the <li>:
                        // an explicit role on a list item replaces its implicit
                        // `listitem` role, which silently empties the list for
                        // assistive tech even though it still looks right.
                        <li key={b.hour}>
                        <div
                            role="group"
                            aria-label={summary}
                            className="rounded-xl border border-border/40 bg-card/60 px-3 py-2.5"
                        >
                            <div className="flex items-baseline justify-between gap-3">
                                <span className="text-[13px] font-black tabular-nums text-foreground">
                                    {hourLabel(b.hour)}
                                </span>
                                {/* The word, always — the bar and the tint are
                                    both secondary channels. */}
                                <span
                                    className={cn(
                                        'text-[11px] font-black uppercase tracking-wider',
                                        short ? 'text-foreground' : 'text-muted-foreground',
                                    )}
                                >
                                    {short
                                        ? `Short ${b.gap}`
                                        : b.gap < 0
                                          ? `Over ${Math.abs(b.gap)}`
                                          : 'Staffed'}
                                </span>
                            </div>

                            {/* Length is the primary channel. aria-hidden because
                                the numbers below say the same thing in words. */}
                            <div aria-hidden="true" className="mt-2 flex flex-col gap-1">
                                <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: peak > 0 ? `${(b.assigned / peak) * 100}%` : '0%',
                                            backgroundColor: gapFill(b.gap, b.required > 0, isDark),
                                        }}
                                    />
                                </div>
                                <div className="h-1 rounded-full bg-muted/30 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-muted-foreground/40"
                                        style={{ width: peak > 0 ? `${(b.required / peak) * 100}%` : '0%' }}
                                    />
                                </div>
                            </div>

                            <dl className="mt-2 grid grid-cols-3 gap-2">
                                {[
                                    ['Required', b.required],
                                    ['Assigned', b.assigned],
                                    ['Available', b.available],
                                ].map(([label, value]) => (
                                    <div key={String(label)} className="flex flex-col gap-0.5">
                                        <dt className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                                            {label}
                                        </dt>
                                        <dd className="text-[13px] font-bold tabular-nums text-foreground">
                                            {value}
                                        </dd>
                                    </div>
                                ))}
                            </dl>

                            {b.shortfall > 0 && (
                                <p className="mt-2 pt-2 border-t border-border/30 text-[11px] font-bold text-foreground">
                                    {b.shortfall} of this gap cannot be filled — nobody available
                                    has declared this hour.
                                </p>
                            )}
                        </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

export default TeamMobileCoverage;
