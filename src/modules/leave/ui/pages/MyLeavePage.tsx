/**
 * My Leave — `/my-leave`.
 *
 * Two views, toggled in the header's function row (as on Leave Approvals):
 *
 *   Ledger     a card per EBA leave type I am entitled to (`buildLedger`).
 *              Balances may be negative — leave in advance, no floor.
 *   My Leaves  a card per request (`LeaveRequestCards`), filtered by a second
 *              Pending / Approved / Rejected toggle that joins the function
 *              row. Withdrawing a pending request releases its held hours
 *              straight back to the ledger.
 *
 * A card's "Request" pill opens the request dialog for that type (there is no
 * generic request button — every request starts from the leave it draws on), which warns — but
 * never stops — a request that takes a balance below zero; the manager decides.
 * Who else is on leave is deliberately not shown here.
 */
import React from 'react';
import { format } from 'date-fns';
import { ClipboardList, WalletCards } from 'lucide-react';

import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { PageState } from '@/modules/core/ui/components/PageState';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { getSydneyNow } from '@/modules/core/lib/date.utils';
import { useRealtimeInvalidate } from '@/platform/supabase/hooks/useRealtimeInvalidate';
import { useMyContractBasis } from '@/modules/availability/state/useMyContractBasis';

import type { LeaveTypeCode } from '../../model/leave.types';
import { getLeavePolicies } from '../../domain/leave-policy';
import { buildLedger, dailyHoursFor } from '../../domain/leave-ledger';
import { splitRequestTabs, type RequestTab } from '../../domain/leave-approval';
import { cancelLeaveRequest } from '../../api/leave.api';
import { useLeaveInvalidation, useMyLeave } from '../../hooks/useLeave';
import { LeavePageShell } from '../components/LeavePageShell';
import { LedgerCards } from '../components/LedgerCards';
import { LeaveRequestCards } from '../components/LeaveRequestCards';
import { REQUEST_TABS, Segmented } from '../components/Segmented';
import { RequestLeaveDialog } from '../components/RequestLeaveDialog';

type View = 'ledger' | 'requests';
const VIEWS: ReadonlyArray<{ key: View; label: string; Icon: typeof ClipboardList }> = [
    { key: 'ledger', label: 'Ledger', Icon: WalletCards },
    { key: 'requests', label: 'My Leaves', Icon: ClipboardList },
];

const MyLeavePage: React.FC = () => {
    const { user } = useAuth();
    const { scope, setScope, isGammaLocked } = useScopeFilter('personal');
    const { toast } = useToast();
    const invalidate = useLeaveInvalidation();
    const meId = user?.id ?? '';

    // Sydney, like every roster date. Fixed for the page's lifetime.
    const today = React.useMemo(() => format(getSydneyNow(), 'yyyy-MM-dd'), []);

    const mine = useMyLeave(meId || undefined);
    const contractBasis = useMyContractBasis(meId || undefined);
    const isCasual = contractBasis.basis.contractType === 'CASUAL';
    const policies = React.useMemo(() => getLeavePolicies(mine.data?.isFtSecurity ?? false), [mine.data?.isFtSecurity]);

    const entries = React.useMemo(() => buildLedger({
        balances: mine.data?.balances ?? [],
        requests: mine.data?.requests ?? [],
        isCasual,
        dailyHours: dailyHoursFor(contractBasis.basis.contractedWeeklyHours),
        year: Number(today.slice(0, 4)),
        serviceStart: mine.data?.serviceStart ?? null,
        today,
    }), [mine.data, isCasual, contractBasis.basis.contractedWeeklyHours, today]);

    // Live: a manager's decision lands without a reload.
    useRealtimeInvalidate(`my-leave-rt-${meId}`, ['leave_requests', 'leave_balances'], invalidate, Boolean(meId));

    const [view, setView] = React.useState<View>('ledger');
    const [tab, setTab] = React.useState<RequestTab>('pending');
    const tabs = React.useMemo(() => splitRequestTabs(mine.data?.requests ?? [], today), [mine.data?.requests, today]);
    const [requestOpen, setRequestOpen] = React.useState(false);
    const [requestType, setRequestType] = React.useState<LeaveTypeCode>('annual');
    const openRequest = (type: LeaveTypeCode) => { setRequestType(type); setRequestOpen(true); };
    const [withdrawingId, setWithdrawingId] = React.useState<string | null>(null);

    const withdraw = async (id: string) => {
        setWithdrawingId(id);
        const res = await cancelLeaveRequest(id);
        setWithdrawingId(null);
        if (res.error) {
            toast({ variant: 'destructive', title: 'Could not withdraw', description: res.error });
            return;
        }
        toast({ title: 'Request withdrawn', description: 'Its hours are back in your available balance.' });
        invalidate();
    };

    return (
        <LeavePageShell
            title="My Leave"
            mode="personal"
            scope={scope}
            setScope={setScope}
            isGammaLocked={isGammaLocked}
            functionBar={
                <div className="flex flex-wrap items-center gap-2">
                    <Segmented<View>
                        label="My Leave view"
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
            {mine.isError ? (
                <PageState state="error" scope="section" title="Could not load your leave" onRetry={() => void mine.refetch()} />
            ) : mine.isLoading ? (
                <PageState state="loading" scope="section" title="Loading your leave" />
            ) : (
                view === 'ledger' ? (
                    <section aria-labelledby="ledger-h" className="space-y-3">
                        <div className="flex items-baseline justify-between gap-2">
                            <h2 id="ledger-h" className={text.heading}>Ledger</h2>
                            <p className={cn(text.caption, 'hidden sm:block')}>ICC Sydney EBA 2025 · hover a card for how it's counted</p>
                        </div>
                        <LedgerCards entries={entries} onRequest={meId ? openRequest : undefined} />
                    </section>
                ) : (
                    <section aria-labelledby="my-leaves-h" className="space-y-3">
                        <h2 id="my-leaves-h" className={text.heading}>
                            {REQUEST_TABS.find(t => t.key === tab)!.label}
                        </h2>
                        <LeaveRequestCards
                            mode="mine"
                            tab={tab}
                            requests={tabs[tab]}
                            onWithdraw={(id) => void withdraw(id)}
                            withdrawingId={withdrawingId}
                        />
                    </section>
                )
            )}

            {meId && (
                <RequestLeaveDialog
                    open={requestOpen}
                    onOpenChange={setRequestOpen}
                    employeeId={meId}
                    balances={mine.data?.balances ?? []}
                    requests={mine.data?.requests ?? []}
                    policies={policies}
                    isCasual={isCasual}
                    contractedWeeklyHours={contractBasis.basis.contractedWeeklyHours}
                    ordinaryDays={contractBasis.basis.envelope.days}
                    serviceStart={mine.data?.serviceStart ?? null}
                    leaveType={requestType}
                    entries={entries}
                />
            )}
        </LeavePageShell>
    );
};

export default MyLeavePage;
