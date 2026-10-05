/**
 * Leave Approvals — `/management/leave`.
 *
 * Two views, toggled in the header's function row — as on My Leave:
 *
 *   Requests  a pastel card per request for everyone in the header scope
 *             (`LeaveRequestCards`, team mode), filtered by a second
 *             Pending / Approved / Rejected toggle that joins the function row.
 *             A card's Review opens the review dialog: balance before → after
 *             (negative allowed, warned), the shifts it takes off the roster,
 *             the history. Approve clears the roster in the same action; reject
 *             and revoke need a reason.
 *   Grid      Every employee in scope × every EBA leave type, capped and
 *             per-occasion included. A row opens that person's full ledger
 *             (`EmployeeLedgerDialog`).
 *
 * ONE READ FEEDS BOTH TABS. The scoped employee list, their requests and their
 * balances are fetched once and the tabs are two views of it, so the Grid and
 * the queue can never disagree about a number.
 *
 * SCOPE IS A SET. The employee list comes from the narrowest level selected in
 * the header — every selected department, not the first — and requests are
 * kept only for those people.
 */
import React from 'react';
import { format, subDays } from 'date-fns';
import { ClipboardList, Grid3X3 } from 'lucide-react';

import { PageState } from '@/modules/core/ui/components/PageState';
import { useAuth } from '@/platform/auth/useAuth';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { getSydneyNow } from '@/modules/core/lib/date.utils';
import { useRealtimeInvalidate } from '@/platform/supabase/hooks/useRealtimeInvalidate';

import { buildLedger, dailyHoursFor } from '../../domain/leave-ledger';
import { splitRequestTabs, type RequestTab } from '../../domain/leave-approval';
import type { LeaveRequest } from '../../model/leave.types';
import {
    useLeaveInvalidation, useScopedEmployees, useTeamContext, useTeamLeave, useTenureLeave,
} from '../../hooks/useLeave';
import { LeavePageShell } from '../components/LeavePageShell';
import { LeaveRequestCards } from '../components/LeaveRequestCards';
import { REQUEST_TABS, Segmented } from '../components/Segmented';
import { LeaveLedgerGrid, type LedgerGridRow } from '../components/LeaveLedgerGrid';
import { LeaveReviewDialog } from '../components/LeaveReviewDialog';
import { EmployeeLedgerDialog } from '../components/EmployeeLedgerDialog';

type View = 'requests' | 'grid';

const VIEWS: ReadonlyArray<{ key: View; label: string; Icon: typeof Grid3X3 }> = [
    { key: 'requests', label: 'Requests', Icon: ClipboardList },
    { key: 'grid', label: 'Grid', Icon: Grid3X3 },
];

const LeaveApprovalsPage: React.FC = () => {
    const { user } = useAuth();
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const invalidate = useLeaveInvalidation();
    const meId = user?.id ?? '';
    const [view, setView] = React.useState<View>('requests');
    const [tab, setTab] = React.useState<RequestTab>('pending');

    const today = React.useMemo(() => format(getSydneyNow(), 'yyyy-MM-dd'), []);
    const year = Number(today.slice(0, 4));
    /*
     * One year back. That covers everything the ledger counts — capped and
     * per-occasion leave per CALENDAR year (1 January is always within it), and
     * FDV per EMPLOYMENT year, whose start can be up to 12 months ago — and
     * leaves the Rejected tab with recent history in January.
     */
    const since = React.useMemo(() => format(subDays(getSydneyNow(), 366), 'yyyy-MM-dd'), []);

    const scopeSelected = scope.org_ids.length + scope.dept_ids.length + scope.subdept_ids.length > 0;
    const employees = useScopedEmployees(scope, scopeSelected);
    const team = useTeamLeave(since, scopeSelected);
    const employeeIds = employees.data ?? [];
    const context = useTeamContext(employeeIds, employeeIds.length > 0);
    const members = React.useMemo(() => context.data ?? new Map(), [context.data]);
    /* Gender affirmation is one allowance for the whole of employment, so its
       card needs every request ever made, not just this year's. */
    const tenure = useTenureLeave(employeeIds, employeeIds.length > 0);
    const tenureByEmployee = React.useMemo(() => {
        const m = new Map<string, LeaveRequest[]>();
        for (const r of tenure.data ?? []) {
            const list = m.get(r.employeeId);
            if (list) list.push(r); else m.set(r.employeeId, [r]);
        }
        return m;
    }, [tenure.data]);

    /** Requests for people in scope only — the same set the Grid lists. */
    const scopedRequests = React.useMemo(() => {
        const ids = new Set(employeeIds);
        return (team.data ?? []).filter(r => ids.has(r.employeeId));
    }, [team.data, employeeIds]);

    const tabs = React.useMemo(() => splitRequestTabs(scopedRequests, today), [scopedRequests, today]);

    const requestsByEmployee = React.useMemo(() => {
        const m = new Map<string, LeaveRequest[]>();
        for (const r of scopedRequests) {
            const list = m.get(r.employeeId);
            if (list) list.push(r); else m.set(r.employeeId, [r]);
        }
        return m;
    }, [scopedRequests]);

    const gridRows: LedgerGridRow[] = React.useMemo(() => employeeIds.map(id => {
        const m = members.get(id);
        return {
            employeeId: id,
            name: m?.name ?? '…',
            avatarUrl: m?.avatarUrl ?? null,
            isCasual: m?.isCasual ?? false,
            entries: buildLedger({
                balances: m?.balances ?? [],
                requests: requestsByEmployee.get(id) ?? [],
                tenureRequests: tenureByEmployee.get(id) ?? [],
                isCasual: m?.isCasual ?? false,
                dailyHours: dailyHoursFor(m?.contractedWeeklyHours),
                year,
                serviceStart: m?.serviceStart ?? null,
                today,
            }),
        };
    }), [employeeIds, members, requestsByEmployee, tenureByEmployee, year, today]);

    const nameOf = React.useCallback(
        (id: string) => (id === meId ? 'You' : members.get(id)?.name ?? '…'),
        [members, meId],
    );

    useRealtimeInvalidate(`leave-approvals-rt-${meId}`, ['leave_requests', 'leave_balances'], invalidate, Boolean(meId));

    const [reviewing, setReviewing] = React.useState<LeaveRequest | null>(null);
    const [employeeOpen, setEmployeeOpen] = React.useState<string | null>(null);
    const openRow = gridRows.find(r => r.employeeId === employeeOpen);
    const openMember = employeeOpen ? members.get(employeeOpen) : undefined;

    const loading = employees.isLoading || team.isLoading
        || (employeeIds.length > 0 && (context.isLoading || tenure.isLoading));
    const failed = employees.isError || team.isError || context.isError || tenure.isError;

    return (
        <LeavePageShell
            title="Leave Approvals"
            mode="managerial"
            scope={scope}
            setScope={setScope}
            isGammaLocked={isGammaLocked}
            functionBar={
                <div className="flex flex-wrap items-center gap-2">
                    <Segmented<View>
                        label="Leave approvals view"
                        value={view}
                        onChange={setView}
                        options={VIEWS.map(({ key, label, Icon }) => ({
                            key, label, icon: <Icon className="h-4 w-4" aria-hidden="true" />,
                            count: key === 'requests' ? tabs.pending.length : undefined,
                        }))}
                    />
                    {view === 'requests' && (
                        <Segmented<RequestTab>
                            label="Request status"
                            value={tab}
                            onChange={setTab}
                            options={REQUEST_TABS.map(({ key, label }) => ({ key, label, count: tabs[key].length }))}
                        />
                    )}
                </div>
            }
        >
            {!scopeSelected ? (
                <PageState state="empty" scope="section" title="Choose a scope"
                    description="Pick an organisation, department or sub-department in the header to see its leave." />
            ) : failed ? (
                <PageState state="error" scope="section" title="Could not load leave for this scope"
                    onRetry={() => { void employees.refetch(); void team.refetch(); void context.refetch(); void tenure.refetch(); }} />
            ) : loading ? (
                <PageState state="loading" scope="section" title="Loading leave" />
            ) : view === 'requests' ? (
                <LeaveRequestCards mode="team" tab={tab} requests={tabs[tab]} members={members} onOpen={setReviewing} />
            ) : (
                <LeaveLedgerGrid
                    rows={gridRows}
                    onOpen={setEmployeeOpen}
                    missingServiceStart={employeeIds.filter(id => !members.get(id)?.serviceStart).length}
                />
            )}

            {openRow && openMember && (
                <EmployeeLedgerDialog
                    member={openMember}
                    entries={openRow.entries}
                    requests={requestsByEmployee.get(openRow.employeeId) ?? []}
                    members={members}
                    today={today}
                    onOpenRequest={setReviewing}
                    onClose={() => setEmployeeOpen(null)}
                />
            )}

            {reviewing && (
                <LeaveReviewDialog
                    request={reviewing}
                    member={members.get(reviewing.employeeId)}
                    personRequests={[
                        ...(requestsByEmployee.get(reviewing.employeeId) ?? []),
                        ...(tenureByEmployee.get(reviewing.employeeId) ?? []),
                    ]}
                    nameOf={nameOf}
                    meId={meId}
                    today={today}
                    onClose={() => setReviewing(null)}
                />
            )}
        </LeavePageShell>
    );
};

export default LeaveApprovalsPage;
