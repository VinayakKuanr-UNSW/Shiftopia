/**
 * TablePager — compact pager for the row-based team views.
 *
 * Deliberately not the shadcn `pagination` primitive: that one renders anchors
 * with `href`, which is right for URL-addressable pages and wrong here (paging
 * is view state, not a location), and it has no page-size control. It is also
 * built at a much lower density than this page's micro-typography.
 *
 * Aggregates are NEVER paginated — the summary strip and the coverage heatmap
 * always fold over every member in scope. Paging is a rendering concern for the
 * long row lists only, so the numbers never change when you turn the page.
 */

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

interface Props {
    page: number;
    pageSize: PageSize;
    totalItems: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: PageSize) => void;
    /** Plural noun for the count read-out, e.g. "members". */
    itemLabel?: string;
    className?: string;
}

export function pageCount(totalItems: number, pageSize: number): number {
    return Math.max(1, Math.ceil(totalItems / pageSize));
}

/** Slice a list for the current page, clamping a page index that ran off the end. */
export function paginate<T>(items: ReadonlyArray<T>, page: number, pageSize: number): T[] {
    const pages = pageCount(items.length, pageSize);
    const safe = Math.min(Math.max(1, page), pages);
    return items.slice((safe - 1) * pageSize, safe * pageSize) as T[];
}

export const TablePager: React.FC<Props> = ({
    page,
    pageSize,
    totalItems,
    onPageChange,
    onPageSizeChange,
    itemLabel = 'members',
    className,
}) => {
    const { isDark } = useTheme();
    const pages = pageCount(totalItems, pageSize);
    const safePage = Math.min(Math.max(1, page), pages);
    const first = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const last = Math.min(totalItems, safePage * pageSize);

    // A single page of results needs no controls — but the count still helps.
    const showControls = totalItems > PAGE_SIZES[0];

    const navButton = (dir: -1 | 1, label: string, Icon: typeof ChevronLeft) => {
        const disabled = dir === -1 ? safePage <= 1 : safePage >= pages;
        return (
            <button
                type="button"
                aria-label={label}
                disabled={disabled}
                onClick={() => onPageChange(safePage + dir)}
                className={cn(
                    'h-11 w-11 md:h-8 md:w-8 flex items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    disabled
                        ? 'opacity-30 pointer-events-none'
                        : isDark
                          ? 'bg-[#111827]/60 text-muted-foreground hover:text-foreground'
                          : 'bg-slate-100 text-slate-600 hover:text-slate-900',
                )}
            >
                <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
        );
    };

    return (
        <div
            className={cn(
                'flex flex-wrap items-center justify-between gap-3 pt-3 mt-3 border-t border-border/20',
                className,
            )}
        >
            <p
                className="text-[10px] font-bold tabular-nums text-muted-foreground"
                // Announced so a screen-reader user knows the list changed under them.
                role="status"
                aria-live="polite"
            >
                {totalItems === 0
                    ? `No ${itemLabel}`
                    : `${first}–${last} of ${totalItems} ${itemLabel}`}
            </p>

            {showControls && (
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5">
                        <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                            Rows
                        </span>
                        <select
                            value={pageSize}
                            onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
                            className={cn(
                                'h-11 md:h-8 rounded-lg px-2 text-[10px] font-bold tabular-nums border-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                isDark
                                    ? 'bg-[#111827]/60 text-foreground'
                                    : 'bg-slate-100 text-slate-900',
                            )}
                        >
                            {PAGE_SIZES.map((size) => (
                                <option key={size} value={size}>
                                    {size}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className="flex items-center gap-1.5">
                        {navButton(-1, 'Previous page', ChevronLeft)}
                        <span className="text-[10px] font-black tabular-nums text-foreground min-w-[52px] text-center">
                            {safePage} / {pages}
                        </span>
                        {navButton(1, 'Next page', ChevronRight)}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TablePager;
