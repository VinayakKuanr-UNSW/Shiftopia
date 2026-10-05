/**
 * One employee's leave, opened from a Grid row — a centred dialog showing the
 * same ledger cards they see on My Leave, and their requests as the same
 * pastel request cards, filtered Pending / Approved / Rejected. A card's
 * Review opens the review dialog over this one, so a decision can be made
 * from here too.
 */
import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { DialogDescription, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import type { LeaveRequest } from '../../model/leave.types';
import type { TeamMemberContext } from '../../api/leave.api';
import type { LedgerEntry } from '../../domain/leave-ledger';
import { splitRequestTabs, type RequestTab } from '../../domain/leave-approval';
import { LedgerCards } from './LedgerCards';
import { LeaveRequestCards } from './LeaveRequestCards';
import { CardDialogClose, LeaveCardDialog, cardDivide, cardSection } from './LeaveCardDialog';
import { REQUEST_TABS, Segmented } from './Segmented';
import { initials } from '../format';

export const EmployeeLedgerDialog: React.FC<{
    member: TeamMemberContext;
    entries: readonly LedgerEntry[];
    requests: readonly LeaveRequest[];
    members: ReadonlyMap<string, TeamMemberContext>;
    today: string;
    onOpenRequest: (r: LeaveRequest) => void;
    onClose: () => void;
}> = ({ member, entries, requests, members, today, onOpenRequest, onClose }) => {
    const [tab, setTab] = React.useState<RequestTab>('pending');
    const tabs = React.useMemo(() => splitRequestTabs(requests, today), [requests, today]);

    return (
        <LeaveCardDialog open onOpenChange={(o) => { if (!o) onClose(); }} className="max-w-5xl">
            <div className={cn('flex-1 overflow-y-auto', cardDivide)}>
                <div className={cn(cardSection, 'flex items-center gap-3 pt-6')}>
                    <Avatar className="h-10 w-10">
                        <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
                        <AvatarFallback className="bg-primary/10 text-primary text-sm">{initials(member.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        <DialogTitle className="truncate text-xl font-bold tracking-tight">{member.name}</DialogTitle>
                        <DialogDescription className={text.caption}>
                            {member.isCasual ? 'Casual' : 'Permanent'}
                            {member.contractedWeeklyHours ? ` · ${member.contractedWeeklyHours}h a week` : ''}
                        </DialogDescription>
                    </div>
                    <div className="self-start"><CardDialogClose /></div>
                </div>

                <section aria-labelledby="emp-ledger-h" className={cn(cardSection, 'space-y-3')}>
                    <h3 id="emp-ledger-h" className={text.heading}>Ledger</h3>
                    <LedgerCards entries={entries} className="sm:grid-cols-2 xl:grid-cols-3" />
                </section>

                <section aria-labelledby="emp-requests-h" className={cn(cardSection, 'space-y-3')}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 id="emp-requests-h" className={text.heading}>Requests</h3>
                        <Segmented<RequestTab>
                            label="Request status"
                            value={tab}
                            onChange={setTab}
                            options={REQUEST_TABS.map(({ key, label }) => ({ key, label, count: tabs[key].length }))}
                        />
                    </div>
                    <LeaveRequestCards
                        mode="team"
                        tab={tab}
                        requests={tabs[tab]}
                        members={members}
                        onOpen={onOpenRequest}
                        className="xl:grid-cols-3"
                    />
                </section>
            </div>
        </LeaveCardDialog>
    );
};
