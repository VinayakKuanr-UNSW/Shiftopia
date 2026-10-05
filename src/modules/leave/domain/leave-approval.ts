/**
 * The manager's side of leave, as pure functions: what an approval will draw
 * down, whether it may happen at all, what a request's status MEANS to a
 * reader, which requests a scope covers, and the team calendar.
 *
 * No React and no I/O, so every rule the one-page Leave screen applies can be
 * tested without rendering it.
 */
import { LEAVE_POLICIES } from './leave-policy';
import type { LeaveBalance, LeaveElectionMode, LeaveRequest, LeaveTypeCode } from '../model/leave.types';

/** Hours to one decimal — every figure the ledger shows. */
const h1 = (n: number) => Math.round(n * 10) / 10;

// ── What an approval draws down ──────────────────────────────────────────────

/**
 * The balance an approved request of this type is deducted from, or null when
 * approval deducts nothing.
 *
 * MIRRORS the LIVE `deduct_leave_balance_on_approval()` (production definition,
 * re-read 2026-09-30):
 *   - carer's leave comes out of PERSONAL — except a casual's, which is unpaid
 *     (cl 45.6(c)) and draws nothing;
 *   - cl 55.1 / cl 58.2 leave comes out of ANNUAL when the employee elected
 *     annual, and out of nothing when they elected unpaid or have not chosen;
 *   - every other type out of its own row, and only if it is balance-tracked.
 * A rule stricter or looser than the trigger would warn about a balance that
 * never moves, or stay silent about one that does.
 */
export function balanceTypeFor(
    leaveType: LeaveTypeCode,
    isCasual: boolean,
    electionMode: LeaveElectionMode | null = null,
): LeaveTypeCode | null {
    if (leaveType === 'carer') return isCasual ? null : 'personal';
    if (leaveType === 'religious_cultural' || leaveType === 'gender_affirmation') {
        return electionMode === 'annual' ? 'annual' : null;
    }
    return LEAVE_POLICIES[leaveType]?.balanceTracked ? leaveType : null;
}

// ── The ledger ───────────────────────────────────────────────────────────────

export interface LedgerLine {
    /** What the database holds. Negative is leave taken in advance. */
    balance: number;
    /** Hours reserved by PENDING requests that will draw on this balance. */
    held: number;
    /** `balance - held` — what a new request is measured against. */
    available: number;
}

/**
 * One balance as the ledger shows it.
 *
 * PENDING IS HELD, WHATEVER ITS DATE. A request reserves its hours the moment
 * it is made, so the next request is measured against what is genuinely left.
 * WITHDRAWN, REJECTED AND REVOKED ARE NOT HELD: withdrawing a pending request
 * gives its hours straight back (it was never deducted), and revoking an
 * approved one is restored by the database trigger. Approved hours are already
 * out of `balance`, so counting them here would take them twice.
 *
 * NO FLOOR — a negative balance is shown as the deficit it is (decision
 * 2026-09-30; the database constraint that forbade it was dropped).
 */
export function ledgerFor(
    balance: Pick<LeaveBalance, 'leaveType' | 'balanceHours'>,
    requests: readonly Pick<LeaveRequest, 'leaveType' | 'status' | 'requestedHours' | 'electionMode'>[],
    isCasual: boolean,
): LedgerLine {
    const held = requests
        .filter(r => r.status === 'pending'
            && balanceTypeFor(r.leaveType, isCasual, r.electionMode) === balance.leaveType)
        .reduce((sum, r) => sum + r.requestedHours, 0);
    return {
        balance: h1(balance.balanceHours),
        held: h1(held),
        available: h1(balance.balanceHours - held),
    };
}

export interface ApprovalCheck {
    /** Set only when approval is impossible — the request is no longer pending. */
    blockedReason: string | null;
    /**
     * Set when approving takes the balance below zero. A WARNING, not a block:
     * leave in advance is the manager's call (decision 2026-09-30).
     */
    warning: string | null;
    /** The balance drawn from, and its hours before and after. Null if untracked. */
    draw: { leaveType: LeaveTypeCode; before: number; after: number } | null;
}


/**
 * What approving this request would do to the balance, as it stands NOW.
 *
 * Never blocks on the balance. It names the deficit instead, so the manager
 * approves leave in advance knowingly rather than by accident. A missing
 * balance row reads as 0h — the trigger's UPDATE would match nothing — which
 * for a tracked type means the warning fires rather than staying silent.
 */
export function checkApproval(
    request: Pick<LeaveRequest, 'leaveType' | 'requestedHours' | 'status'> & Partial<Pick<LeaveRequest, 'electionMode'>>,
    balances: readonly Pick<LeaveBalance, 'leaveType' | 'balanceHours'>[],
    isCasual: boolean,
): ApprovalCheck {
    if (request.status !== 'pending') {
        return { blockedReason: `This request is ${request.status}, not pending.`, warning: null, draw: null };
    }
    const type = balanceTypeFor(request.leaveType, isCasual, request.electionMode ?? null);
    if (!type) return { blockedReason: null, warning: null, draw: null };

    const before = balances.find(b => b.leaveType === type)?.balanceHours ?? 0;
    const after = before - request.requestedHours;
    const draw = { leaveType: type, before: h1(before), after: h1(after) };
    return {
        blockedReason: null,
        warning: after < -1e-9
            ? `Takes ${labelOf(type)} to ${h1(after)}h — ${h1(request.requestedHours)}h requested, `
                + `${h1(before)}h available. Approving grants leave in advance.`
            : null,
        draw,
    };
}

function labelOf(type: LeaveTypeCode): string {
    return type === 'personal' ? 'personal leave' : type === 'annual' ? 'annual leave' : type.replace(/_/g, ' ');
}

// ── What a status means to a reader ──────────────────────────────────────────

export type LeaveDisplayStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'revoked';

/**
 * `cancelled` covers two different events: an employee withdrawing a request
 * nobody had decided, and a manager revoking one they had approved. Only the
 * second carries an approver, which is what tells them apart.
 */
export function displayStatus(req: Pick<LeaveRequest, 'status' | 'approvedBy'>): LeaveDisplayStatus {
    if (req.status === 'cancelled' && req.approvedBy) return 'revoked';
    return req.status;
}

/**
 * Approved leave can be revoked until it has fully passed. Revoking leave
 * already taken would restore hours the employee has spent.
 */
export function canRevoke(req: Pick<LeaveRequest, 'status' | 'endDate'>, today: string): boolean {
    return req.status === 'approved' && req.endDate >= today;
}

// ── The three tabs ───────────────────────────────────────────────────────────

export type RequestTab = 'pending' | 'approved' | 'rejected';

export type RequestTabs = Record<RequestTab, LeaveRequest[]>;

/**
 * Pending / Approved / Rejected — the same three tabs on My Leave and on Leave
 * Approvals.
 *
 * REJECTED HOLDS EVERYTHING THAT DID NOT HAPPEN: rejected, withdrawn (cancelled
 * while pending) and revoked (cancelled after approval). Each keeps its own
 * badge (`displayStatus`), so the tab never claims a withdrawal was a refusal.
 *
 * Order is what each tab is for: Pending oldest first (the one waiting longest
 * on top); Approved by start date, upcoming before past; Rejected most recent
 * decision first.
 */
export function splitRequestTabs(requests: readonly LeaveRequest[], today: string): RequestTabs {
    const tabs: RequestTabs = { pending: [], approved: [], rejected: [] };
    for (const r of requests) {
        if (r.status === 'pending') tabs.pending.push(r);
        else if (r.status === 'approved') tabs.approved.push(r);
        else tabs.rejected.push(r);
    }
    tabs.pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    tabs.approved.sort((a, b) => {
        const aPast = a.endDate < today;
        const bPast = b.endDate < today;
        if (aPast !== bPast) return aPast ? 1 : -1;
        return aPast ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate);
    });
    const decidedAt = (r: LeaveRequest) => r.updatedAt ?? r.approvalDate ?? r.createdAt;
    tabs.rejected.sort((a, b) => decidedAt(b).localeCompare(decidedAt(a)));
    return tabs;
}

// ── Scope ────────────────────────────────────────────────────────────────────

export interface EmployeeUnit {
    departmentId: string | null;
    subDepartmentId: string | null;
}

/**
 * Does the header scope cover this employee?
 *
 * Read as SETS, never as the first entry — reading `[0]` is the defect class
 * that showed managers one department of eleven. The narrowest level selected
 * wins: sub-departments if any are chosen, else departments, else everything
 * RLS already let through. An employee with several contracts is in scope if
 * ANY of them is.
 */
export function inScope(
    units: readonly EmployeeUnit[],
    deptIds: readonly string[],
    subDeptIds: readonly string[],
): boolean {
    if (subDeptIds.length > 0) {
        const s = new Set(subDeptIds);
        return units.some(u => u.subDepartmentId != null && s.has(u.subDepartmentId));
    }
    if (deptIds.length > 0) {
        const d = new Set(deptIds);
        return units.some(u => u.departmentId != null && d.has(u.departmentId));
    }
    return true;
}

// ── What an approval did ─────────────────────────────────────────────────────

export interface ApprovalOutcome {
    /** Full-time shifts the approval deleted. */
    removed: number;
    /** Full-time shifts it could not delete — still rostered under the leave. */
    removalFailed: number;
    /** Part-time / casual shifts sent to unassign, and how many actually were. */
    unassignAttempted: number;
    unassignSucceeded: number;
    /** Shifts inside the leave dates that had already started — deliberately left alone. */
    keptWorked?: number;
}

/**
 * The one message an approval ends with. Every shift is accounted for, and a
 * failure is named as needing action — the approval itself cannot be rolled
 * back, so a shift left under approved leave would mark the employee No-Show.
 */
export function summarizeApproval(o: ApprovalOutcome): { description: string; needsAction: boolean } {
    const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
    const parts: string[] = [];
    if (o.removed > 0) parts.push(`${n(o.removed, 'full-time shift')} removed`);
    if (o.unassignSucceeded > 0) parts.push(`${n(o.unassignSucceeded, 'shift')} unassigned — re-offer from the roster`);
    const unassignFailed = o.unassignAttempted - o.unassignSucceeded;
    const failed = o.removalFailed + unassignFailed;
    if (failed > 0) parts.push(`${n(failed, 'shift')} still rostered — clear ${failed === 1 ? 'it' : 'them'} on the roster`);
    const kept = o.keptWorked ?? 0;
    if (kept > 0) {
        parts.push(`${n(kept, 'shift')} inside the leave dates had already started, so ${kept === 1 ? 'it was' : 'they were'} kept `
            + `— check whether the leave or the roster is right`);
    }
    return {
        description: parts.length === 0 ? 'Nothing was rostered on those dates.' : `${parts.join('. ')}.`,
        needsAction: failed > 0 || kept > 0,
    };
}
