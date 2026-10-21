/**
 * Edit, from a row of the Users table (2026-10-16): one panel for the person,
 * with tabs for the contract (the contract wizard — this row's contract, or a
 * new one) and the person's skills, licences, work rights and first-aid
 * appointment, which the table shows only as summaries.
 */
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import { cn } from '@/modules/core/lib/utils';
import { touch } from '@/modules/core/ui/typography';
import { ContractWizard } from './contract-wizard/ContractWizard';
import SkillsSection from './SkillsSection';
import LicensesSection from './LicensesSection';
import WorkRightsSection from './WorkRightsSection';
import FirstAidSection from './FirstAidSection';
import type { PersonRef } from '../../domain/usersTable';
import type { ContractRow } from '../../domain/contractRows';

export type UserEditTab = 'contract' | 'skills' | 'licences' | 'work-rights' | 'first-aid';

const TABS: { id: UserEditTab; label: string }[] = [
    { id: 'contract', label: 'Contract' },
    { id: 'skills', label: 'Skills' },
    { id: 'licences', label: 'Licences' },
    { id: 'work-rights', label: 'Work rights' },
    { id: 'first-aid', label: 'First aid' },
];

export interface UserEditDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    person: PersonRef | null;
    /** The row's contract; null to add one. */
    contract: ContractRow | null;
    /** All of the person's contracts, for the wizard's 38-hour and Full-Time checks. */
    personContracts: readonly ContractRow[];
    initialTab?: UserEditTab;
    /** Something was saved: reload the table. */
    onChanged: () => void;
    /** Where focus goes when the dialog closes (default: what had it before). */
    onCloseAutoFocus?: (event: Event) => void;
}

export const UserEditDialog: React.FC<UserEditDialogProps> = ({
    open, onOpenChange, person, contract, personContracts, initialTab = 'contract', onChanged, onCloseAutoFocus,
}) => {
    const [tab, setTab] = useState<UserEditTab>(initialTab);
    useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);

    // Skills, licences and the rest save as they go; the table catches up on close.
    const close = (next: boolean) => {
        if (!next) onChanged();
        onOpenChange(next);
    };

    if (!person) return null;
    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent onCloseAutoFocus={onCloseAutoFocus} className="w-[96vw] max-w-4xl max-h-[90dvh] flex flex-col gap-0 p-0 overflow-hidden rounded-2xl border border-border bg-background text-foreground">
                <div className="shrink-0 border-b border-border px-6 pt-5">
                    <DialogTitle className="text-lg font-semibold tracking-tight">{person.name}</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground">{person.email ?? 'No email'}</DialogDescription>
                    <Tabs value={tab} onValueChange={(v) => setTab(v as UserEditTab)} className="mt-3">
                        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
                            {TABS.map((t) => (
                                <TabsTrigger
                                    key={t.id}
                                    value={t.id}
                                    className={cn(
                                        touch.targetY,
                                        'rounded-none border-b-2 border-transparent px-3 text-sm',
                                        'data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none',
                                    )}
                                >
                                    {t.id === 'contract' ? (contract ? 'Contract' : 'New contract') : t.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </div>

                {/* Grows with its content; past the dialog's 90% cap, the step body scrolls. */}
                <div className="flex flex-1 min-h-0 flex-col">
                    {tab === 'contract' ? (
                        <ContractWizard
                            employeeId={person.id}
                            employeeName={person.name}
                            existingContracts={personContracts as any[]}
                            contract={contract as Record<string, any> | null}
                            active={open && tab === 'contract'}
                            onDone={() => close(false)}
                            onCancel={() => close(false)}
                        />
                    ) : (
                        <div className="flex-1 min-h-0 overflow-y-auto p-6">
                            {tab === 'skills' && <SkillsSection employeeId={person.id} />}
                            {tab === 'licences' && <LicensesSection employeeId={person.id} />}
                            {tab === 'work-rights' && <WorkRightsSection employeeId={person.id} />}
                            {tab === 'first-aid' && <FirstAidSection employeeId={person.id} employeeName={person.name} />}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default UserEditDialog;
