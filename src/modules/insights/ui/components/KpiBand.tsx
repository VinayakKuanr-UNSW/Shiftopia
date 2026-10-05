/**
 * The band primitives every KPI tab is built from.
 *
 * Bands run in the same order on every tab — headline, trend, breakdown,
 * detail — so a manager who learns one tab can read the next without
 * relearning the page. The order answers questions in the order they get
 * asked: is it OK, is it moving, where is it concentrated, who exactly.
 */

import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';

interface KpiBandProps {
    title: string;
    description?: string;
    /** Right-aligned controls for this band only, e.g. a segmented switch. */
    actions?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}

export const KpiBand: React.FC<KpiBandProps> = ({ title, description, actions, children, className }) => (
    <section className={cn('flex flex-col gap-3', className)} aria-label={title}>
        <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
                <h2 className={cn(text.heading, 'text-foreground')}>{title}</h2>
                {description && <p className={cn(text.caption, 'mt-0.5')}>{description}</p>}
            </div>
            {actions && <div className="shrink-0">{actions}</div>}
        </div>
        {children}
    </section>
);

/**
 * Headline tile row. Two up on a phone, four on a desktop — five equal-weight
 * tiles at xl was the old Overview's mistake, since equal visual weight claims
 * equal importance.
 */
export const KpiTileGrid: React.FC<{ children: React.ReactNode; className?: string }> = ({
    children,
    className,
}) => (
    <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4', className)}>
        {children}
    </div>
);

export interface CountStripItem {
    label: string;
    value: number | string;
    /** Optional emphasis colour class for the value. */
    tone?: string;
}

/**
 * A row of plain counts. Deliberately not tiles: these carry no judgement, and
 * dressing an unjudgeable number as a KPI card implies one.
 */
export const CountStrip: React.FC<{ items: CountStripItem[]; className?: string }> = ({
    items,
    className,
}) => (
    <dl
        className={cn(
            'grid grid-cols-2 gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:grid-cols-4',
            className,
        )}
    >
        {items.map((item) => (
            <div key={item.label} className="min-w-0">
                <dd className={cn('text-xl font-bold tabular-nums leading-none', item.tone ?? 'text-foreground')}>
                    {item.value}
                </dd>
                <dt className={cn(text.overline, 'mt-1.5 block truncate')}>{item.label}</dt>
            </div>
        ))}
    </dl>
);
