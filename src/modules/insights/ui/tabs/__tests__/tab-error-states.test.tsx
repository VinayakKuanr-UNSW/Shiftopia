/**
 * A failed query must never render as zero.
 *
 * This is the failure mode the whole KPI surface is most exposed to: one bad
 * column name 400s an entire PostgREST select, react-query hands back its
 * default, and a dashboard of confident zeros looks exactly like a quiet
 * quarter. Three of the four original Insights tabs destructured only
 * `isLoading` and `data`, so that is precisely what they did.
 *
 * Each tab is mounted with its primary query failing and asserted to show an
 * error with a retry, and — the part that matters — to show no numeric zero.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { ScopeSelection } from '@/platform/auth/types';
import { makeQuarter } from '../../../hooks/useKpiFilters';

// ── Hook doubles ────────────────────────────────────────────────────────────
const failing = {
    data: undefined,
    isLoading: false,
    isError: true,
    error: new Error('column shifts.nope does not exist'),
    refetch: vi.fn(),
};
const idle = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };

const mockBidding = vi.fn();
const mockMarketplace = vi.fn();
const mockBehaviour = vi.fn();
const mockBehaviourTrend = vi.fn();
const mockMarketplaceTrend = vi.fn();
const mockReasonBreakdown = vi.fn();
const mockQuarterly = vi.fn();

vi.mock('../../../hooks/useBiddingKpis', () => ({ useBiddingKpis: () => mockBidding() }));
vi.mock('../../../hooks/useMarketplaceKpis', () => ({ useMarketplaceKpis: () => mockMarketplace() }));
vi.mock('../../../hooks/useBehaviourSummary', () => ({
    useBehaviourSummary: () => mockBehaviour(),
    EMPTY_BEHAVIOUR: {},
}));
vi.mock('../../../hooks/useBehaviourTrend', () => ({
    useBehaviourTrend: () => mockBehaviourTrend(),
    formatBucket: (s: string) => s,
}));
vi.mock('../../../hooks/useMarketplaceTrend', () => ({
    useMarketplaceTrend: () => mockMarketplaceTrend(),
}));
vi.mock('../../../hooks/useCancellationReasonBreakdown', () => ({
    useCancellationReasonBreakdown: () => mockReasonBreakdown(),
}));
vi.mock('@/modules/users/hooks/usePerformanceMetrics', () => ({
    useQuarterlyReport: () => mockQuarterly(),
    getCurrentQuarter: () => ({ year: 2026, quarter: 3 }),
    getReportCellStatus: () => 'good',
    usePerformanceMetrics: () => idle,
    EMPTY_METRICS: {},
}));
// Charts and the drill-down dialog are irrelevant to an error state.
vi.mock('../../components/KpiTrendChart', () => ({
    KpiTrendChart: () => <div data-testid="trend-chart" />,
    SERIES_COLORS: { primary: '#000', good: '#000', warn: '#000', bad: '#000', muted: '#000', accent: '#000' },
}));
vi.mock('../../components/EmployeeDrillDown', () => ({ EmployeeDrillDown: () => null }));

import BidsTab from '../BidsTab';
import SwapsTab from '../SwapsTab';
import AttendanceTab from '../AttendanceTab';
import CancellationsTab from '../CancellationsTab';

const scope: ScopeSelection = { org_ids: [], dept_ids: [], subdept_ids: [] };
const filters = { period: makeQuarter(2026, 3), comparison: null };

const TABS = [
    { name: 'Bids',          Comp: BidsTab,          primary: mockBidding },
    { name: 'Swaps',         Comp: SwapsTab,         primary: mockMarketplace },
    { name: 'Attendance',    Comp: AttendanceTab,    primary: mockBehaviour },
    { name: 'Cancellations', Comp: CancellationsTab, primary: mockBehaviour },
] as const;

beforeEach(() => {
    for (const m of [mockBidding, mockMarketplace, mockBehaviour, mockBehaviourTrend,
                     mockMarketplaceTrend, mockReasonBreakdown, mockQuarterly]) {
        m.mockReset();
        m.mockReturnValue(idle);
    }
    mockQuarterly.mockReturnValue({ ...idle, data: [] });
});

describe.each(TABS)('$name tab, primary query failing', ({ Comp, primary }) => {
    it('shows an error with a retry, not a page of zeros', () => {
        primary.mockReturnValue(failing);

        const { container } = render(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Comp filters={filters as any} scope={scope} />,
        );

        // The error is surfaced rather than swallowed.
        expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();

        // And nothing numeric is rendered — no "0", no "0.0%", no "0 of 0".
        expect(container.textContent ?? '').not.toMatch(/\d/);
    });

    it('calls refetch when the retry is pressed', async () => {
        const refetch = vi.fn();
        primary.mockReturnValue({ ...failing, refetch });

        render(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Comp filters={filters as any} scope={scope} />,
        );
        screen.getByRole('button', { name: /try again|retry/i }).click();
        expect(refetch).toHaveBeenCalled();
    });
});
