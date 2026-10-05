/**
 * The three pieces the leave pages are built from. Each test pins something a
 * person reads or acts on: the three tabs, a negative balance, a type that
 * does not apply, and the Grid's "who is in advance" sort.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import * as React from 'react';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
import type { LeaveRequest } from '../model/leave.types';
import { buildLedger } from '../domain/leave-ledger';
import { splitRequestTabs } from '../domain/leave-approval';

vi.mock('../hooks/useLeave', () => ({
    useLeaveEvents: () => ({ data: [], isLoading: false, isError: false }),
    useLeaveConflicts: () => ({ data: [], isLoading: false, isError: false }),
    useLeaveInvalidation: () => vi.fn(),
}));

const { LeaveRequestCards } = await import('../ui/components/LeaveRequestCards');
const { LedgerCards } = await import('../ui/components/LedgerCards');
const { LeaveLedgerGrid } = await import('../ui/components/LeaveLedgerGrid');
const { RequestLeaveDialog } = await import('../ui/components/RequestLeaveDialog');
const { getLeavePolicies } = await import('../domain/leave-policy');

function req(over: Partial<LeaveRequest> = {}): LeaveRequest {
    return {
        id: 'r1', employeeId: 'e1', leaveType: 'annual', electionMode: null,
        startDate: '2026-10-05', endDate: '2026-10-05', requestedHours: 7.6,
        reason: null, certificateUrl: null, status: 'pending',
        approvedBy: null, approvalDate: null, rejectionReason: null,
        createdAt: '2026-09-01T00:00:00Z', updatedAt: null, ...over,
    };
}

const wrap = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('LeaveRequestCards (mine)', () => {
    const rejected = [
        req({ id: 'w', status: 'cancelled', leaveType: 'personal' }),
        req({ id: 'v', status: 'cancelled', approvedBy: 'mgr', rejectionReason: 'Event moved', leaveType: 'long_service' }),
    ];

    it('splits into Pending, Approved and Rejected, withdrawn and revoked under Rejected', () => {
        const tabs = splitRequestTabs([req({ id: 'p' }), req({ id: 'a', status: 'approved' }), ...rejected], '2026-10-01');
        expect([tabs.pending.length, tabs.approved.length, tabs.rejected.length]).toEqual([1, 1, 2]);
    });

    it('a card shows its status, the revocation reason, in its leave type\'s pastel', () => {
        wrap(<LeaveRequestCards mode="mine" tab="rejected" requests={rejected} onWithdraw={vi.fn()} withdrawingId={null} />);
        expect(screen.getByText('Withdrawn')).toBeInTheDocument();
        expect(screen.getByText('Revoked')).toBeInTheDocument();
        expect(screen.getByText(/Revoked: .Event moved./)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Withdraw/ })).toBeNull();
        const lsl = screen.getAllByRole('article').find(a => a.textContent?.includes('Long Service Leave'))!;
        expect(lsl.className).toContain('bg-sky-50');
    });

    it('Withdraw asks once more, says the hours come back, then withdraws', () => {
        const onWithdraw = vi.fn();
        wrap(<LeaveRequestCards mode="mine" tab="pending" requests={[req({ id: 'p' })]} onWithdraw={onWithdraw} withdrawingId={null} />);
        expect(screen.getByText('Pending')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
        expect(onWithdraw).not.toHaveBeenCalled();
        expect(screen.getByText(/7.6h goes back to your available balance/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Withdraw 7.6h' }));
        expect(onWithdraw).toHaveBeenCalledWith('p');
    });

    it('an empty tab says so', () => {
        wrap(<LeaveRequestCards mode="mine" tab="approved" requests={[]} onWithdraw={vi.fn()} withdrawingId={null} />);
        expect(screen.getByText('No approved leave.')).toBeInTheDocument();
    });
});

describe('LeaveRequestCards (team)', () => {
    const dana = {
        employeeId: 'e1', name: 'Dana Okafor', avatarUrl: null, isCasual: false, contractedWeeklyHours: 38,
        serviceStart: '2020-01-01', units: [],
        balances: [{ id: 'b', employeeId: 'e1', leaveType: 'annual' as const, balanceHours: 4, accruedHours: 0, usedHours: 0, asOfDate: '2026-09-01' }],
    };
    const members = new Map([['e1', dana]]);

    it('names the person, warns of a negative balance, and Review opens that request — nothing decided on the card', () => {
        const onOpen = vi.fn();
        const r = req({ id: 'p', employeeId: 'e1' });
        wrap(<LeaveRequestCards mode="team" tab="pending" requests={[r]} members={members} onOpen={onOpen} />);
        const card = within(screen.getByRole('article', { name: /Dana Okafor, Annual Leave/ }));
        expect(card.getByText(/Balance goes to -3.6h/)).toBeInTheDocument();
        expect(card.queryByRole('button', { name: /approve|reject|withdraw/i })).toBeNull();
        fireEvent.click(card.getByRole('button', { name: "Review Dana Okafor's Annual Leave" }));
        expect(onOpen).toHaveBeenCalledWith(r);
    });

    it('a decided request is opened, not reviewed', () => {
        wrap(<LeaveRequestCards mode="team" tab="approved" requests={[req({ status: 'approved' })]} members={members} onOpen={vi.fn()} />);
        expect(screen.getByRole('button', { name: /^Open Dana Okafor/ })).toBeInTheDocument();
        expect(screen.getByText('Approved')).toBeInTheDocument();
    });
});

describe('LedgerCards', () => {
    it('shows a negative balance in advance, and hides types a casual has no right to', () => {
        const perm = buildLedger({
            balances: [{ leaveType: 'annual', balanceHours: -12.8 }], requests: [],
            isCasual: false, dailyHours: 7.6, year: 2026,
        });
        const { unmount } = wrap(<LedgerCards entries={perm} />);
        const annual = screen.getByRole('article', { name: 'Annual Leave' });
        expect(within(annual).getByText('-12.8h')).toBeInTheDocument();
        expect(within(annual).getByText('In advance')).toBeInTheDocument();
        unmount();

        const casual = buildLedger({ balances: [], requests: [], isCasual: true, dailyHours: 7.6, year: 2026 });
        wrap(<LedgerCards entries={casual} />);
        expect(screen.queryByRole('article', { name: 'Annual Leave' })).toBeNull();
        expect(screen.getByRole('article', { name: "Unpaid Carer's Leave" })).toBeInTheDocument();
    });
});

describe('LedgerCards — request pill', () => {
    const entries = buildLedger({ balances: [], requests: [], isCasual: false, dailyHours: 7.6, year: 2026 });

    it('a card asks for its OWN type when onRequest is given', () => {
        const onRequest = vi.fn();
        wrap(<LedgerCards entries={entries} onRequest={onRequest} />);
        fireEvent.click(screen.getByRole('button', { name: 'Request Jury Service' }));
        expect(onRequest).toHaveBeenCalledWith('jury_duty');
    });

    it('has no Request pill in a manager\'s read-only view', () => {
        wrap(<LedgerCards entries={entries} />);
        expect(screen.queryByRole('button', { name: /^Request / })).toBeNull();
    });
});

describe('RequestLeaveDialog', () => {
    it('is ONE card in the type\'s pastel, with the card\'s figure', () => {
        const entries = buildLedger({
            balances: [{ leaveType: 'annual', balanceHours: 40 }], requests: [],
            isCasual: false, dailyHours: 7.6, year: 2026,
        });
        wrap(<RequestLeaveDialog
            open onOpenChange={vi.fn()} employeeId="e1" balances={[]} requests={[]}
            policies={getLeavePolicies(false)} isCasual={false} contractedWeeklyHours={38} ordinaryDays={null}
            leaveType="annual" entries={entries}
        />);
        const dialog = screen.getByRole('dialog', { name: 'Annual Leave' });
        expect(within(dialog).getByText('40h')).toBeInTheDocument();
        expect(dialog.className).toContain('bg-background'); // solid — the dark tint is translucent
        expect((dialog.firstElementChild as HTMLElement).className).toContain('bg-sky-50');
    });

    const base = {
        open: true, onOpenChange: vi.fn(), employeeId: 'e1', balances: [], requests: [],
        policies: getLeavePolicies(false), isCasual: false, contractedWeeklyHours: 38, ordinaryDays: null,
    };

    it('the type is fixed — no picker — and hours cannot be typed', () => {
        wrap(<RequestLeaveDialog {...base} leaveType="compassionate" />);
        const dialog = within(screen.getByRole('dialog', { name: 'Compassionate Leave' }));
        expect(dialog.queryByRole('combobox')).toBeNull();
        expect(dialog.queryByRole('spinbutton')).toBeNull();
    });
});

describe('LeaveLedgerGrid', () => {
    const row = (id: string, name: string, annual: number | null, isCasual = false) => ({
        employeeId: id, name, avatarUrl: null, isCasual,
        entries: buildLedger({
            balances: annual == null ? [] : [{ leaveType: 'annual' as const, balanceHours: annual }],
            requests: [], isCasual, dailyHours: 7.6, year: 2026,
        }),
    });
    const rows = [row('a', 'Ada', 50), row('b', 'Ben', -8), row('c', 'Cy', null, true)];

    it('has a column for every EBA leave type, capped and per-occasion included', () => {
        wrap(<LeaveLedgerGrid rows={rows} onOpen={vi.fn()} />);
        const headers = screen.getAllByRole('columnheader').map(h => h.textContent);
        expect(headers).toEqual(expect.arrayContaining([
            expect.stringContaining('Religious, Cultural & Ceremonial'),
            expect.stringContaining('Compassionate Leave'),
            expect.stringContaining('Jury Service'),
        ]));
        expect(headers).toHaveLength(14); // Employee + 13 types
    });

    it('sorts the lowest annual balance first, casuals last', () => {
        wrap(<LeaveLedgerGrid rows={rows} onOpen={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /lowest annual balance/i }));
        const names = screen.getAllByRole('rowheader').map(h => h.textContent);
        expect(names[0]).toContain('Ben');
        expect(names[2]).toContain('Cy');
    });

    it('opens a person from their row, in either layout', () => {
        const onOpen = vi.fn();
        wrap(<LeaveLedgerGrid rows={rows} onOpen={onOpen} />);
        const [phone, desktop] = screen.getAllByRole('button', { name: "Open Ben's leave" });
        fireEvent.click(desktop);
        fireEvent.click(phone);
        expect(onOpen).toHaveBeenNthCalledWith(1, 'b');
        expect(onOpen).toHaveBeenNthCalledWith(2, 'b');
    });

});

describe('phone layouts', () => {
    const row = (id: string, name: string, annual: number) => ({
        employeeId: id, name, avatarUrl: null, isCasual: false,
        entries: buildLedger({
            balances: [{ leaveType: 'annual' as const, balanceHours: annual }, { leaveType: 'fdv' as const, balanceHours: 76 }],
            requests: [{ leaveType: 'compassionate', status: 'approved', requestedHours: 15.2, electionMode: null, startDate: '2026-03-02' }],
            isCasual: false, dailyHours: 7.6, year: 2026,
        }),
    });

    it('the Grid has BOTH compositions — a card list below md, the matrix from md up', () => {
        const { container } = wrap(<LeaveLedgerGrid rows={[row('b', 'Ben', -8)]} onOpen={vi.fn()} />);
        const list = screen.getByRole('list', { name: 'Leave ledger by employee' });
        const matrix = screen.getByRole('table', { name: 'Leave ledger by employee' });
        expect(list.className).toContain('md:hidden');
        expect(matrix.parentElement!.className).toContain('hidden md:block');
        expect(container).toBeTruthy();
    });

    it('a phone card shows the four balances, the negative one red, and counts the rest', () => {
        wrap(<LeaveLedgerGrid rows={[row('b', 'Ben', -8)]} onOpen={vi.fn()} />);
        const card = within(screen.getByRole('list', { name: 'Leave ledger by employee' }));
        for (const label of ['Annual', 'Personal', 'LSL', 'FDV']) expect(card.getByText(label)).toBeInTheDocument();
        expect(card.getByText('-8h').className).toContain('text-red-600');
        expect(card.getByText(/1 other leave type taken or pending/)).toBeInTheDocument();
    });

    it('a ledger card explains itself on tap — a phone has no hover', () => {
        const entries = buildLedger({ balances: [], requests: [], isCasual: false, dailyHours: 7.6, year: 2026 });
        wrap(<LedgerCards entries={entries} />);
        const card = within(screen.getByRole('article', { name: 'Gender Affirmation Leave' }));
        const toggle = card.getByRole('button', { name: 'How this works' });
        expect(toggle.className).toContain('sm:hidden');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(card.getByText(/whole time with ICC Sydney — one allowance, never reset/)).toBeInTheDocument();
        expect(card.getByText('Whole of employment')).toBeInTheDocument();
    });
});


describe('missing service start is stated, not left as n/r', () => {
    const row = { employeeId: 'a', name: 'Ada', avatarUrl: null, isCasual: false,
        entries: buildLedger({ balances: [], requests: [], isCasual: false, dailyHours: 7.6, year: 2026, today: '2026-10-01' }) };

    it('says what is switched off, and how many people it affects', () => {
        wrap(<LeaveLedgerGrid rows={[row, { ...row, employeeId: 'b', name: 'Ben' }]} onOpen={vi.fn()} missingServiceStart={2} />);
        expect(screen.getByRole('status')).toHaveTextContent(/No one here has a continuous service start recorded/);
        expect(screen.getAllByLabelText('Service start not recorded').length).toBeGreaterThan(0);
    });

    it('shows nothing when everyone has one', () => {
        wrap(<LeaveLedgerGrid rows={[row]} onOpen={vi.fn()} missingServiceStart={0} />);
        expect(screen.queryByRole('status')).toBeNull();
    });
});
