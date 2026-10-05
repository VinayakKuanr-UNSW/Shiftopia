/**
 * The shared Copy flow — used by the Office page and, since Phase 3, by the
 * Rosters page on a full-time shift.
 *
 * The case that only arises on Rosters: an FT shift held by someone who is not
 * in the team's full-time ledger (e.g. a second, non-full-time contract). There
 * is then no cycle to check the copy against, and copying without one is how a
 * roster goes over the ceiling unreported — so the flow must refuse and say
 * why, not plan the copy with no ceiling at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import type { Shift } from '@/modules/rosters/domain/shift.entity';

const proposal = vi.hoisted(() => ({ ledgers: [] as Array<{ employeeId: string; cycles: unknown[] }> }));

vi.mock('../../hooks/useOffice', () => ({
    useOfficeWeekShifts: () => ({ data: [] }),
    useOfficeLeave: () => ({ data: new Map() }),
    useRosterCoverage: () => ({
        data: { writable: new Set(['2099-03-10', '2099-03-11', '2099-03-12']), lockedOut: new Set() },
    }),
    useOfficeWorld: () => ({ data: { employees: [] }, isLoading: false }),
}));
vi.mock('../../api/office.commands', () => ({
    computeProposal: () => ({ ledgers: proposal.ledgers }),
}));
vi.mock('../../api/copyShift', () => ({ copyShiftToDates: vi.fn() }));
vi.mock('@/modules/core/ui/primitives/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { CopyShiftFlow } = await import('../components/CopyShiftFlow');

const source = {
    employeeId: 'emp-1',
    employeeName: 'Kurry Admin',
    dateKey: '2099-03-09',
    shift: {
        id: 'shift-1', shift_date: '2099-03-09', start_time: '08:00:00', end_time: '16:36:00',
        net_length_minutes: 486, unpaid_break_minutes: 30,
    } as unknown as Shift,
    roleId: 'role-1',
    organizationId: 'org-1',
    departmentId: 'dept-1',
    subDepartmentId: 'sub-1',
};

const renderFlow = () => render(
    <CopyShiftFlow
        source={source}
        defaultEndDate="2099-03-12"
        referenceDate="2099-03-01"
        onClose={() => {}}
    />,
);

describe('CopyShiftFlow', () => {
    beforeEach(() => { proposal.ledgers = []; });
    afterEach(() => { vi.clearAllMocks(); });

    it('refuses, and says why, when the employee has no cycle in this team', () => {
        renderFlow();
        expect(screen.getByText(/is not one of this team's full-time employees/)).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('plans the copy when the employee is in the ledger', () => {
        proposal.ledgers = [{ employeeId: 'emp-1', cycles: [] }];
        renderFlow();
        expect(screen.queryByText(/is not one of this team's full-time employees/)).toBeNull();
        expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(false);
    });
});
