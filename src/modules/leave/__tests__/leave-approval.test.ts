/**
 * The manager's rules on the one-page Leave screen. Each of these decides
 * something a manager acts on: whether Approve is allowed, whether Revoke is
 * offered, whose requests they see, and what the calendar says.
 */
import { describe, expect, it } from 'vitest';
import {
    balanceTypeFor, canRevoke, checkApproval,
    displayStatus, inScope, ledgerFor, splitRequestTabs, summarizeApproval,
} from '../domain/leave-approval';
import type { LeaveRequest } from '../model/leave.types';

function req(over: Partial<LeaveRequest> = {}): LeaveRequest {
    return {
        id: 'r1', employeeId: 'e1', leaveType: 'annual', electionMode: null,
        startDate: '2026-10-05', endDate: '2026-10-07', requestedHours: 22.8,
        reason: null, certificateUrl: null, status: 'pending',
        approvedBy: null, approvalDate: null, rejectionReason: null,
        createdAt: '2026-09-01T00:00:00Z', updatedAt: null,
        ...over,
    };
}

describe('balanceTypeFor — mirrors the deduction trigger', () => {
    it("draws carer's leave from personal", () => {
        expect(balanceTypeFor('carer', false)).toBe('personal');
    });
    it("draws nothing for a casual's carer's leave (cl 45.6)", () => {
        expect(balanceTypeFor('carer', true)).toBeNull();
    });
    it('draws annual from annual', () => {
        expect(balanceTypeFor('annual', false)).toBe('annual');
    });
    it('draws nothing for an untracked type', () => {
        expect(balanceTypeFor('compassionate', false)).toBeNull();
        expect(balanceTypeFor('unpaid', false)).toBeNull();
    });
});

describe('checkApproval — warns on an overdraw, never blocks it', () => {
    it('states before/after, with no warning when the balance covers it', () => {
        const c = checkApproval(req(), [{ leaveType: 'annual', balanceHours: 30 }], false);
        expect(c).toEqual({ blockedReason: null, warning: null, draw: { leaveType: 'annual', before: 30, after: 7.2 } });
    });

    it('does not warn at exactly zero', () => {
        expect(checkApproval(req({ requestedHours: 30 }), [{ leaveType: 'annual', balanceHours: 30 }], false).warning)
            .toBeNull();
    });

    it('warns — but does not block — when approval takes the balance negative', () => {
        const c = checkApproval(req(), [{ leaveType: 'annual', balanceHours: 10 }], false);
        expect(c.blockedReason).toBeNull();
        expect(c.warning).toMatch(/Takes annual leave to -12\.8h — 22\.8h requested, 10h available/);
        expect(c.draw?.after).toBe(-12.8);
    });

    it('treats a missing balance row as zero, so the warning fires', () => {
        expect(checkApproval(req(), [], false).warning).toMatch(/0h available/);
    });

    it("checks carer's leave against PERSONAL", () => {
        const c = checkApproval(
            req({ leaveType: 'carer', requestedHours: 8 }),
            [{ leaveType: 'annual', balanceHours: 100 }, { leaveType: 'personal', balanceHours: 4 }],
            false,
        );
        expect(c.draw).toEqual({ leaveType: 'personal', before: 4, after: -4 });
    });

    it('routes cl 55/58 leave elected as annual to ANNUAL, as the live trigger does', () => {
        const c = checkApproval(
            req({ leaveType: 'religious_cultural', electionMode: 'annual', requestedHours: 7.6 }),
            [{ leaveType: 'annual', balanceHours: 5 }], false);
        expect(c.draw?.leaveType).toBe('annual');
        expect(c.warning).not.toBeNull();
    });

    it('draws nothing for cl 55/58 leave elected unpaid, or not yet chosen', () => {
        for (const electionMode of ['unpaid', null] as const) {
            expect(checkApproval(req({ leaveType: 'gender_affirmation', electionMode }), [], false))
                .toEqual({ blockedReason: null, warning: null, draw: null });
        }
    });

    it('never warns on an untracked type', () => {
        expect(checkApproval(req({ leaveType: 'compassionate' }), [], false))
            .toEqual({ blockedReason: null, warning: null, draw: null });
    });

    it('blocks only what is no longer pending', () => {
        expect(checkApproval(req({ status: 'approved' }), [], false).blockedReason).toMatch(/approved, not pending/);
    });
});

describe('ledgerFor — pending is held, withdrawn gives it back', () => {
    const bal = { leaveType: 'annual' as const, balanceHours: 30 };

    it('holds EVERY pending request against the balance, whatever its date', () => {
        // The old projection only held pending leave starting on or before today,
        // so future leave — most leave — was never held at all.
        const line = ledgerFor(bal, [
            req({ id: 'a', startDate: '2027-06-01', endDate: '2027-06-01', requestedHours: 7.6 }),
            req({ id: 'b', startDate: '2026-01-01', endDate: '2026-01-01', requestedHours: 7.6 }),
        ], false);
        expect(line).toEqual({ balance: 30, held: 15.2, available: 14.8 });
    });

    it('releases a request the moment it is withdrawn', () => {
        const pending = req({ requestedHours: 20 });
        expect(ledgerFor(bal, [pending], false).available).toBe(10);
        expect(ledgerFor(bal, [{ ...pending, status: 'cancelled' }], false).available).toBe(30);
    });

    it('does not count approved leave twice — the trigger already took it out', () => {
        expect(ledgerFor(bal, [req({ status: 'approved', requestedHours: 20 })], false).held).toBe(0);
    });

    it('holds carer\'s leave against PERSONAL, not against annual', () => {
        const carer = req({ leaveType: 'carer', requestedHours: 8 });
        expect(ledgerFor(bal, [carer], false).held).toBe(0);
        expect(ledgerFor({ leaveType: 'personal', balanceHours: 10 }, [carer], false).held).toBe(8);
    });

    it('shows a negative balance as it is — no floor', () => {
        expect(ledgerFor({ leaveType: 'annual', balanceHours: -12.8 }, [req({ requestedHours: 7.6 })], false))
            .toEqual({ balance: -12.8, held: 7.6, available: -20.4 });
    });
});

describe('displayStatus', () => {
    it('reads a cancelled request with an approver as REVOKED', () => {
        expect(displayStatus({ status: 'cancelled', approvedBy: 'mgr' })).toBe('revoked');
    });
    it('reads an employee withdrawal as cancelled', () => {
        expect(displayStatus({ status: 'cancelled', approvedBy: null })).toBe('cancelled');
    });
});

describe('canRevoke', () => {
    it('offers revoke on approved leave that has not ended', () => {
        expect(canRevoke({ status: 'approved', endDate: '2026-10-07' }, '2026-10-07')).toBe(true);
    });
    it('does not offer it once the leave is over — the hours were spent', () => {
        expect(canRevoke({ status: 'approved', endDate: '2026-10-06' }, '2026-10-07')).toBe(false);
    });
    it('does not offer it on pending leave', () => {
        expect(canRevoke({ status: 'pending', endDate: '2026-12-01' }, '2026-10-07')).toBe(false);
    });
});

describe('inScope — reads the scope as sets', () => {
    const units = [
        { departmentId: 'd1', subDepartmentId: 's1' },
        { departmentId: 'd2', subDepartmentId: 's9' },
    ];
    it('matches ANY of several contracts', () => {
        expect(inScope(units, ['d2'], [])).toBe(true);
    });
    it('uses sub-departments when any are selected', () => {
        expect(inScope(units, ['d1'], ['s2'])).toBe(false);
        expect(inScope(units, [], ['s9'])).toBe(true);
    });
    it('matches a SECOND selected department, not only the first', () => {
        // The `[0]` defect class: d1 first, the employee is in d3.
        expect(inScope([{ departmentId: 'd3', subDepartmentId: null }], ['d1', 'd3'], [])).toBe(true);
    });
    it('leaves everything in when nothing is selected', () => {
        expect(inScope([], [], [])).toBe(true);
    });
});

describe('summarizeApproval', () => {
    it('accounts for every shift', () => {
        const s = summarizeApproval({ removed: 2, removalFailed: 0, unassignAttempted: 1, unassignSucceeded: 1 });
        expect(s).toEqual({
            description: '2 full-time shifts removed. 1 shift unassigned — re-offer from the roster.',
            needsAction: false,
        });
    });

    it('names a shift left under approved leave as needing action', () => {
        const s = summarizeApproval({ removed: 0, removalFailed: 1, unassignAttempted: 2, unassignSucceeded: 1 });
        expect(s.needsAction).toBe(true);
        expect(s.description).toMatch(/2 shifts still rostered — clear them on the roster/);
    });

    it('says so when nothing was rostered', () => {
        expect(summarizeApproval({ removed: 0, removalFailed: 0, unassignAttempted: 0, unassignSucceeded: 0 }).description)
            .toBe('Nothing was rostered on those dates.');
    });
});

describe('splitRequestTabs — Pending / Approved / Rejected', () => {
    const tabs = splitRequestTabs([
        req({ id: 'p-new', createdAt: '2026-09-10T00:00:00Z' }),
        req({ id: 'p-old', createdAt: '2026-09-02T00:00:00Z' }),
        req({ id: 'a-later', status: 'approved', startDate: '2026-11-01', endDate: '2026-11-02' }),
        req({ id: 'a-soon', status: 'approved', startDate: '2026-10-03', endDate: '2026-10-09' }),
        req({ id: 'a-past', status: 'approved', startDate: '2026-09-01', endDate: '2026-09-02' }),
        req({ id: 'rejected', status: 'rejected', updatedAt: '2026-09-15T00:00:00Z' }),
        req({ id: 'withdrawn', status: 'cancelled', updatedAt: '2026-09-20T00:00:00Z' }),
        req({ id: 'revoked', status: 'cancelled', approvedBy: 'mgr', updatedAt: '2026-09-25T00:00:00Z' }),
    ], '2026-10-01');

    it('puts the longest-waiting request first', () => {
        expect(tabs.pending.map(r => r.id)).toEqual(['p-old', 'p-new']);
    });

    it('lists upcoming approved leave soonest first, then past leave', () => {
        expect(tabs.approved.map(r => r.id)).toEqual(['a-soon', 'a-later', 'a-past']);
    });

    it('keeps rejected, withdrawn and revoked under Rejected, latest decision first', () => {
        expect(tabs.rejected.map(r => r.id)).toEqual(['revoked', 'withdrawn', 'rejected']);
    });

    it('names started shifts kept inside the leave as needing a look', () => {
        const s = summarizeApproval({ removed: 1, removalFailed: 0, unassignAttempted: 0, unassignSucceeded: 0, keptWorked: 2 });
        expect(s.needsAction).toBe(true);
        expect(s.description).toMatch(/2 shifts inside the leave dates had already started, so they were kept/);
    });
});
