/**
 * useKpiFilters — the single filter state for the KPI and Performance pages.
 *
 * QUARTER-ONLY, DELIBERATELY
 * --------------------------
 * The old page ran two incompatible period models side by side: four date-range
 * presets driving get_insights_summary / _trend / _breakdown, and a separate
 * quarter picker driving get_quarterly_performance_report, which takes
 * (p_year, p_quarter) and nothing else. Most per-employee metrics come from
 * that report, so a range preset could never drive the whole page — the tabs
 * silently showed two different periods at once.
 *
 * The quarter now drives everything. Date-range RPCs are handed the quarter's
 * own boundaries, so every number on the page covers the same window.
 *
 * SYDNEY, NOT THE DEVICE CLOCK
 * ----------------------------
 * `useDateRange` derived "today" from `new Date()`, so a manager in London got
 * a different week than the roster used. Quarter boundaries here come from
 * getCurrentQuarter(), which is already Sydney-anchored.
 */

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCurrentQuarter } from '@/modules/users/hooks/usePerformanceMetrics';
import type { ScopeSelection } from '@/platform/auth/types';

export interface QuarterRef {
    year: number;
    quarter: number;
    /** "Q3 2026" */
    label: string;
    /** 'YYYY-MM-DD', inclusive. */
    startDate: string;
    /** 'YYYY-MM-DD', inclusive. */
    endDate: string;
}

export type CompareMode = 'none' | 'previous';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Quarter boundaries as plain calendar dates.
 *
 * Built from the numbers rather than from Date arithmetic on purpose: the RPCs
 * take `date`, not `timestamptz`, and a Date built in the viewer's zone can
 * land on the wrong calendar day either side of midnight.
 */
export function quarterBounds(year: number, quarter: number): { startDate: string; endDate: string } {
    const startMonth = (quarter - 1) * 3 + 1;          // 1, 4, 7, 10
    const endMonth = startMonth + 2;                   // 3, 6, 9, 12
    const lastDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][endMonth - 1];
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const endDay = endMonth === 2 && isLeap ? 29 : lastDay;
    return {
        startDate: `${year}-${pad(startMonth)}-01`,
        endDate: `${year}-${pad(endMonth)}-${pad(endDay)}`,
    };
}

export function makeQuarter(year: number, quarter: number): QuarterRef {
    return { year, quarter, label: `Q${quarter} ${year}`, ...quarterBounds(year, quarter) };
}

/** The quarter immediately before the given one. */
export function previousQuarter(q: { year: number; quarter: number }): QuarterRef {
    return q.quarter === 1 ? makeQuarter(q.year - 1, 4) : makeQuarter(q.year, q.quarter - 1);
}

/** The current quarter plus the four before it, newest first. */
export function recentQuarters(count = 5): QuarterRef[] {
    const { year, quarter } = getCurrentQuarter();
    const out: QuarterRef[] = [];
    let cur = { year, quarter };
    for (let i = 0; i < count; i++) {
        out.push(makeQuarter(cur.year, cur.quarter));
        cur = previousQuarter(cur);
    }
    return out;
}

export interface KpiFilters {
    /** Scope arrays, ready to hand to any RPC. Undefined means "no filter". */
    orgIds?: string[];
    deptIds?: string[];
    subdeptIds?: string[];
    /** The selected quarter and its calendar boundaries. */
    period: QuarterRef;
    /** The quarter being compared against, or null when compare is off. */
    comparison: QuarterRef | null;
}

export interface UseKpiFiltersResult {
    filters: KpiFilters;
    period: QuarterRef;
    quarters: QuarterRef[];
    compare: CompareMode;
    activeTab: string;
    setPeriodByLabel: (label: string) => void;
    setCompare: (mode: CompareMode) => void;
    setActiveTab: (tab: string) => void;
}

/**
 * Tab, quarter and comparison live in the URL so a KPI view can be sent to
 * someone. Scope stays in the caller's `useScopeFilter`, which owns its own
 * persistence.
 */
export function useKpiFilters(scope: ScopeSelection, defaultTab: string): UseKpiFiltersResult {
    const quarters = useMemo(() => recentQuarters(5), []);
    const [searchParams, setSearchParams] = useSearchParams();
    // Fallback state for any host that renders this outside a router-provided
    // search param context; the URL is the source of truth when present.
    const [fallback, setFallback] = useState<Record<string, string>>({});

    const read = useCallback(
        (key: string) => searchParams.get(key) ?? fallback[key] ?? null,
        [searchParams, fallback],
    );

    const write = useCallback(
        (key: string, value: string) => {
            setFallback((prev) => ({ ...prev, [key]: value }));
            setSearchParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    next.set(key, value);
                    return next;
                },
                { replace: true },
            );
        },
        [setSearchParams],
    );

    const period = useMemo(() => {
        const label = read('period');
        return quarters.find((q) => q.label === label) ?? quarters[0];
    }, [read, quarters]);

    const compare: CompareMode = read('compare') === 'previous' ? 'previous' : 'none';
    const activeTab = read('tab') ?? defaultTab;

    const filters = useMemo<KpiFilters>(
        () => ({
            orgIds:     scope.org_ids.length     ? scope.org_ids     : undefined,
            deptIds:    scope.dept_ids.length    ? scope.dept_ids    : undefined,
            subdeptIds: scope.subdept_ids.length ? scope.subdept_ids : undefined,
            period,
            comparison: compare === 'previous' ? previousQuarter(period) : null,
        }),
        [scope, period, compare],
    );

    return {
        filters,
        period,
        quarters,
        compare,
        activeTab,
        setPeriodByLabel: (label) => write('period', label),
        setCompare: (mode) => write('compare', mode),
        setActiveTab: (tab) => write('tab', tab),
    };
}

/**
 * Absolute movement between two readings of the same metric.
 *
 * Rate metrics move in percentage POINTS — a no-show rate going 2% -> 3% is
 * +1pt, not +50%. Counts move in percent. Comparisons are suppressed when
 * either period is too small for the movement to mean anything.
 */
export function computeDelta(
    current: number | null | undefined,
    previous: number | null | undefined,
    opts: { unit: 'points' | 'percent'; label: string; currentBase?: number; previousBase?: number },
): { value: number; unit: 'points' | 'percent'; label: string; suppressedReason?: string } | null {
    if (current === null || current === undefined || previous === null || previous === undefined) return null;
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;

    const MIN_BASE = 10;
    const { currentBase, previousBase } = opts;
    if (
        (currentBase !== undefined && currentBase < MIN_BASE) ||
        (previousBase !== undefined && previousBase < MIN_BASE)
    ) {
        return {
            value: 0,
            unit: opts.unit,
            label: opts.label,
            suppressedReason: `Too few shifts to compare (needs at least ${MIN_BASE} in both periods).`,
        };
    }

    if (opts.unit === 'points') {
        return { value: current - previous, unit: 'points', label: opts.label };
    }
    if (previous === 0) {
        return {
            value: 0,
            unit: 'percent',
            label: opts.label,
            suppressedReason: 'Nothing recorded in the comparison period.',
        };
    }
    return { value: ((current - previous) / previous) * 100, unit: 'percent', label: opts.label };
}
