import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

/**
 * The planner owns the shifts query and passes the result down. RolesModeView
 * used to run its own useShiftsByDateRange whenever the worker projection was
 * not ready yet. Its cache key differed from the planner's, so it fired a
 * second request whose data was never read, and held a competing spinner.
 */
const { useShiftsByDateRange, noopMutation } = vi.hoisted(() => ({
    useShiftsByDateRange: vi.fn(() => ({ data: [], isLoading: true })),
    noopMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/modules/rosters/state/useRosterShifts', () => ({
    useShiftsByDateRange: (...args: unknown[]) => useShiftsByDateRange(...(args as [])),
    useRemunerationLevels: () => ({ data: [], isLoading: false }),
    useRoles: () => ({ data: [], isLoading: false }),
    useUnpublishShift: noopMutation,
    useCreateShift: noopMutation,
    useDeleteShift: noopMutation,
}));

vi.mock('@/modules/rosters/hooks/useShiftFormNav', () => ({
    useShiftFormNav: () => vi.fn(),
}));

import { RolesModeView } from '../RolesModeView';

function renderView(props: Partial<React.ComponentProps<typeof RolesModeView>> = {}) {
    return render(
        <DndProvider backend={HTML5Backend}>
            <RolesModeView
                selectedDate={new Date('2026-10-26T00:00:00')}
                viewType="week"
                canEdit
                organizationId="org-1"
                departmentIds={[]}
                subDepartmentIds={[]}
                shifts={[]}
                {...props}
            />
        </DndProvider>,
    );
}

describe('RolesModeView — planner is the single shifts source', () => {
    it('does not run its own shifts query before the projection is ready', () => {
        renderView({ projection: undefined });

        expect(useShiftsByDateRange).not.toHaveBeenCalled();
    });

    it('does not show a competing "Loading roles" spinner while the planner already has shifts', () => {
        renderView({ projection: undefined });

        expect(screen.queryByText(/loading roles/i)).not.toBeInTheDocument();
    });
});
