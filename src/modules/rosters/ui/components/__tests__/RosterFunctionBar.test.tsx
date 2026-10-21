/**
 * The Roster Planner toolbar's gated controls.
 *
 * Pinned (2026-10-18 toolbar audit):
 *  - A gated control explains itself, and the explanation is reachable by
 *    keyboard: the buttons are aria-disabled (focusable), not `disabled` (out
 *    of the tab order, so the tooltip with the reason could never open).
 *  - A gated control does nothing when activated.
 *  - Templates and Add Subgroup act on ONE roster: with several departments /
 *    sub-departments in scope they used to take the first, silently. The page
 *    now passes an id only when the scope names exactly one (soleId).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/modules/rosters/state/useRosterStructure', () => ({
    ROSTER_STRUCTURE_KEY: 'rosterStructure',
    useRosterStructure: () => ({ data: [] }),
}));

import { RosterFunctionBar } from '../RosterFunctionBar';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';

const DEPT = '33333333-3333-4333-8333-333333333333';
const SUB = '44444444-4444-4444-8444-444444444444';

function renderBar(over: Partial<React.ComponentProps<typeof RosterFunctionBar>> = {}) {
    const props: React.ComponentProps<typeof RosterFunctionBar> = {
        selectedOrganizationId: 'org-1',
        selectedDepartmentId: DEPT,
        selectedSubDepartmentId: SUB,
        selectedDate: new Date(2026, 9, 5),
        viewType: 'week',
        onDateChange: vi.fn(),
        onViewTypeChange: vi.fn(),
        onRefresh: vi.fn(),
        canEdit: true,
        isBulkMode: false,
        onBulkModeToggle: vi.fn(),
        onAutoScheduleClick: vi.fn(),
        ...over,
    };
    render(
        <QueryClientProvider client={new QueryClient()}>
            <RosterFunctionBar {...props} />
        </QueryClientProvider>,
    );
    return props;
}

beforeEach(() => {
    useRosterStore.setState({
        activeMode: 'group',
        isDnDModeActive: false,
        bulkModeActive: false,
        selectedDepartmentIds: [DEPT],
        selectedSubDepartmentIds: [SUB],
    });
});

describe('RosterFunctionBar — view-only manager', () => {
    it('keeps write controls focusable, says why they are off, and ignores activation', () => {
        const props = renderBar({ canEdit: false });

        const writes = screen.getAllByRole('button', { name: /view-only access/i });
        // Add Subgroup, Auto-Schedule, Templates, DnD, Bulk.
        expect(writes).toHaveLength(5);
        for (const b of writes) {
            expect(b).toHaveAttribute('aria-disabled', 'true');
            expect(b).not.toBeDisabled();
            b.focus();
            expect(b).toHaveFocus();
            fireEvent.click(b);
        }
        expect(props.onAutoScheduleClick).not.toHaveBeenCalled();
        expect(props.onBulkModeToggle).not.toHaveBeenCalled();
    });
});

describe('RosterFunctionBar — one roster at a time', () => {
    it('gates Templates and Add Subgroup when no single department / sub-department is in scope', () => {
        useRosterStore.setState({ selectedDepartmentIds: [DEPT, 'dept-2'], selectedSubDepartmentIds: [SUB, 'sub-2'] });
        renderBar({ selectedDepartmentId: null, selectedSubDepartmentId: null });

        const templates = screen.getByRole('button', { name: /templates — select one department first/i });
        const addSubgroup = screen.getByRole('button', { name: /add subgroup — select one sub-department first/i });
        expect(templates).toHaveAttribute('aria-disabled', 'true');
        expect(addSubgroup).toHaveAttribute('aria-disabled', 'true');

        // Auto-Schedule works over the whole scope, so several departments are fine.
        const auto = screen.getByRole('button', { name: /^auto-schedule$/i });
        expect(auto).not.toHaveAttribute('aria-disabled');
    });

    it('enables them when exactly one is in scope', () => {
        renderBar();

        expect(screen.getByRole('button', { name: /^add subgroup$/i })).not.toHaveAttribute('aria-disabled');
        expect(screen.getByRole('button', { name: /^templates — apply/i })).not.toHaveAttribute('aria-disabled');
    });

    it('runs an enabled control', () => {
        const props = renderBar();

        fireEvent.click(screen.getByRole('button', { name: /^auto-schedule$/i }));

        expect(props.onAutoScheduleClick).toHaveBeenCalledTimes(1);
    });
});
