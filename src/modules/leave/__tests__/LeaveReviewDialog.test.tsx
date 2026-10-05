/**
 * The review dialog is where every leave decision is made, so these pin the
 * guard on each button — not the layout. The API and hooks are mocked; what is
 * asserted is which calls a click makes and which clicks are refused.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import type { LeaveRequest } from '../model/leave.types';
import type { LeaveShiftConflict, TeamMemberContext } from '../api/leave.api';

const api = vi.hoisted(() => ({
    approve: vi.fn(),
    reject: vi.fn(),
    revoke: vi.fn(),
    unassign: vi.fn(),
    conflicts: [] as LeaveShiftConflict[],
    toast: vi.fn(),
}));

vi.mock('../api/leave.api', () => ({
    approveLeaveRequest: api.approve,
    rejectLeaveRequest: api.reject,
    revokeLeaveRequest: api.revoke,
    unassignConflictingShifts: api.unassign,
}));
vi.mock('../hooks/useLeave', () => ({
    useLeaveConflicts: () => ({ data: api.conflicts, isLoading: false }),
    useLeaveInvalidation: () => () => {},
    useLeaveEvents: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock('@/modules/core/ui/primitives/use-toast', () => ({ useToast: () => ({ toast: api.toast }) }));

const { LeaveReviewDialog } = await import('../ui/components/LeaveReviewDialog');

function req(over: Partial<LeaveRequest> = {}): LeaveRequest {
    return {
        id: 'r1', employeeId: 'e1', leaveType: 'annual', electionMode: null,
        startDate: '2026-10-05', endDate: '2026-10-06', requestedHours: 15.2,
        reason: null, certificateUrl: null, status: 'pending',
        approvedBy: null, approvalDate: null, rejectionReason: null,
        createdAt: '2026-09-01T00:00:00Z', updatedAt: null, ...over,
    };
}

function member(balanceHours: number): TeamMemberContext {
    return {
        employeeId: 'e1', name: 'Dana Okafor', avatarUrl: null, isCasual: false, contractedWeeklyHours: 38, serviceStart: '2020-01-01', units: [],
        balances: [{ id: 'b', employeeId: 'e1', leaveType: 'annual', balanceHours, accruedHours: 0, usedHours: 0, asOfDate: '2026-09-01' }],
    };
}

function renderSheet(request: LeaveRequest, balance = 40, meId = 'mgr') {
    return render(
        <LeaveReviewDialog
            request={request} member={member(balance)} 
            nameOf={() => 'Dana Okafor'} meId={meId} today="2026-10-01" onClose={vi.fn()}
        />,
    );
}

const conflict = (id: string, target: string | null, worked = false): LeaveShiftConflict => ({
    shiftId: id, shiftDate: '2026-10-05', startTime: '08:00', endTime: '16:06',
    lifecycleStatus: worked ? 'Completed' : 'Draft', targetEmploymentType: target, worked, started: worked,
});

beforeEach(() => {
    Object.values(api).forEach(v => typeof v === 'function' && 'mockReset' in v && (v as any).mockReset());
    api.conflicts = [];
});

describe('Approve', () => {
    it('stays ENABLED past the balance, with the deficit stated — leave in advance', () => {
        renderSheet(req(), 10);
        expect(screen.getByRole('button', { name: /approve/i })).toBeEnabled();
        expect(screen.getByRole('alert')).toHaveTextContent(/Takes annual leave to -5\.2h/);
    });

    it('is disabled on your own request', () => {
        renderSheet(req({ employeeId: 'mgr' }), 40, 'mgr');
        expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled();
    });

    it('previews the roster impact before approving', () => {
        api.conflicts = [conflict('ft', 'FT'), conflict('cas', 'Casual')];
        renderSheet(req());
        expect(screen.getByText(/Approving will remove 1 full-time shift and unassign 1 shift for re-offer/)).toBeInTheDocument();
    });

    it('previews an already-worked shift as kept, never removed', () => {
        api.conflicts = [conflict('ft', 'FT'), conflict('done', 'FT', true)];
        renderSheet(req());
        expect(screen.getByText(/remove 1 full-time shift and keep 1 already-started shift/)).toBeInTheDocument();
        expect(screen.getByText('kept — worked')).toBeInTheDocument();
    });

    it('unassigns the part-time and casual shifts in the same action, and accounts for them', async () => {
        api.approve.mockResolvedValue({
            data: { conflictingShifts: [conflict('cas', 'Casual')], removedShifts: [conflict('ft', 'FT')], removalFailures: [] },
        });
        api.unassign.mockResolvedValue({ data: { attempted: 1, succeeded: 1 } });
        renderSheet(req());

        fireEvent.click(screen.getByRole('button', { name: /approve/i }));

        await waitFor(() => expect(api.unassign).toHaveBeenCalledWith(['cas']));
        expect(api.approve).toHaveBeenCalledWith('r1', 'mgr');
        expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
            description: '1 full-time shift removed. 1 shift unassigned — re-offer from the roster.',
        }));
    });
});

describe('Reject', () => {
    it('cannot be sent without a reason, and sends the one typed', async () => {
        api.reject.mockResolvedValue({});
        renderSheet(req());

        fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));
        const send = screen.getByRole('button', { name: /reject request/i });
        expect(send).toBeDisabled();

        fireEvent.change(screen.getByLabelText(/why is this being rejected/i), { target: { value: 'Peak week' } });
        expect(send).toBeEnabled();
        fireEvent.click(send);

        await waitFor(() => expect(api.reject).toHaveBeenCalledWith('r1', 'mgr', 'Peak week'));
    });
});

describe('Revoke', () => {
    it('is offered on approved leave that has not ended', () => {
        renderSheet(req({ status: 'approved', approvedBy: 'mgr2' }));
        expect(screen.getByRole('button', { name: /revoke approval/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /approve$/i })).toBeNull();
    });

    it('is not offered once the leave is over', () => {
        renderSheet(req({ status: 'approved', approvedBy: 'mgr2', startDate: '2026-09-01', endDate: '2026-09-02' }));
        expect(screen.queryByRole('button', { name: /revoke/i })).toBeNull();
    });

    it('sends the reason and today', async () => {
        api.revoke.mockResolvedValue({});
        renderSheet(req({ status: 'approved', approvedBy: 'mgr2' }));
        fireEvent.click(screen.getByRole('button', { name: /revoke approval/i }));
        fireEvent.change(screen.getByLabelText(/why is this being revoked/i), { target: { value: 'Event moved' } });
        fireEvent.click(screen.getByRole('button', { name: /revoke leave/i }));
        await waitFor(() => expect(api.revoke).toHaveBeenCalledWith('r1', 'Event moved', '2026-10-01'));
    });
});

describe('Entitlement and evidence — the manager sees what the employee saw', () => {
    it('warns on a compassionate request longer than one occasion, without blocking Approve', () => {
        render(
            <LeaveReviewDialog
                request={req({ leaveType: 'compassionate', requestedHours: 30.4, startDate: '2026-10-05', endDate: '2026-10-08' })}
                member={member(40)} personRequests={[]}
                nameOf={() => 'Dana Okafor'} meId="mgr" today="2026-10-01" onClose={vi.fn()}
            />,
        );
        expect(screen.getByText('Entitlement')).toBeInTheDocument();
        expect(screen.getByText(/cl 48 gives 2 days \(15\.2h\) per occasion/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /approve/i })).toBeEnabled();
    });

    it('lists why evidence is needed for personal leave next to a weekend', () => {
        // Fri 9 Oct 2026 — the next day is Saturday.
        render(
            <LeaveReviewDialog
                request={req({ leaveType: 'personal', requestedHours: 7.6, startDate: '2026-10-09', endDate: '2026-10-09' })}
                member={member(40)} personRequests={[]}
                nameOf={() => 'Dana Okafor'} meId="mgr" today="2026-10-01" onClose={vi.fn()}
            />,
        );
        expect(screen.getByText('Evidence')).toBeInTheDocument();
        expect(screen.getByText('Next to a weekend')).toBeInTheDocument();
    });
});

describe('frame', () => {
    it('is a centred dialog named for the leave, in its type\'s pastel, naming the person', () => {
        renderSheet(req());
        const dialog = screen.getByRole('dialog', { name: 'Annual Leave' });
        expect(dialog).toHaveAccessibleDescription('Dana Okafor');
        expect((dialog.firstElementChild as HTMLElement).className).toContain('bg-sky-50');
    });
});
