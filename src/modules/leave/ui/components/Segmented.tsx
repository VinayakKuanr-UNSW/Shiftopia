/** A row of mutually exclusive choices — the leave pages' function-bar toggles. */
import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { touch } from '@/modules/core/ui/typography';

export function Segmented<K extends string>({ label, value, onChange, options }: {
    label: string;
    value: K;
    onChange: (k: K) => void;
    options: ReadonlyArray<{ key: K; label: string; icon?: React.ReactNode; count?: number }>;
}) {
    return (
        <div role="tablist" aria-label={label} className="flex w-fit gap-1 rounded-xl bg-muted/50 p-1">
            {options.map(o => (
                <button
                    key={o.key}
                    role="tab"
                    type="button"
                    aria-selected={value === o.key}
                    onClick={() => onChange(o.key)}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition',
                        touch.targetY,
                        value === o.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    {o.icon} {o.label}
                    {o.count !== undefined && o.count > 0 && (
                        <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                            {o.count}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
}

/** The three request tabs, in the order `splitRequestTabs` fills them. */
export const REQUEST_TABS = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
] as const;
