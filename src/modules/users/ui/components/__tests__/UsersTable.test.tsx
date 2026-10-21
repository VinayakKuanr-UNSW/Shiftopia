/**
 * The Users page table (2026-10-17): a row per contract on one line, every
 * column sortable (aria-sort on the sorted header), columns the viewer hid left
 * out, dates edited in place with the shared picker, and each row's ⋯ menu —
 * Edit, Add contract, Revoke (ends the contract today; deletes one that hasn't
 * started). Read-only without the Admin suite.
 */
import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns';

const mocks = vi.hoisted(() => ({
    update: vi.fn(),
    remove: vi.fn(),
    result: { error: null as unknown, count: 1 as number | null },
    toast: vi.fn(),
    pickers: [] as Record<string, unknown>[],
}));

vi.mock('@/platform/supabase/client', () => ({
    supabase: {
        schema: () => ({
            from: () => ({
                update: (patch: unknown, opts: unknown) => ({
                    eq: async (col: string, val: string) => { mocks.update(patch, opts, col, val); return mocks.result; },
                }),
                delete: (opts: unknown) => ({
                    eq: async (col: string, val: string) => { mocks.remove(opts, col, val); return mocks.result; },
                }),
            }),
        }),
    },
}));
vi.mock('@/modules/core/ui/primitives/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/modules/core/lib/date.utils', async (orig) => ({
    ...(await orig<typeof import('@/modules/core/lib/date.utils')>()),
    todayISO: () => '2026-10-16',
}));
// The real picker is a popover calendar, tested on its own; here a pick is a click on 24 Dec 2026.
vi.mock('@/modules/core/ui/calendar/DatePicker', () => ({
    DatePicker: (p: { label: string; value?: Date; onChange: (d: Date) => void; disabled?: boolean }) => {
        mocks.pickers.push(p as never);
        return (
            <button type="button" aria-label={p.label} disabled={p.disabled} onClick={() => p.onChange(new Date(2026, 11, 24))}>
                {p.value ? format(p.value, 'd MMM yyyy') : 'Ongoing'}
            </button>
        );
    },
}));
vi.mock('../UserEditDialog', () => ({
    UserEditDialog: (p: { open: boolean; person: { name: string } | null; contract: { id: string } | null; initialTab?: string }) =>
        p.open ? <div role="dialog" aria-label="Edit panel">{`${p.person?.name} · ${p.contract?.id ?? 'new contract'} · ${p.initialTab}`}</div> : null,
}));

const { UsersTable } = await import('../UsersTable');
import type { PersonGroup } from '../../../domain/usersTable';
import type { ContractRow } from '../../../domain/contractRows';

const contract = (over: Partial<ContractRow>): ContractRow => ({
    id: 'k', status: 'Active', organizations: { name: 'ICC Sydney' }, departments: { name: 'ICT Services' },
    sub_departments: { name: 'Event Information Systems' }, roles: { name: 'EIS Specialist' },
    employment_status: 'Full-Time', pay_basis: 'salary', access_level: 'zeta', start_date: '2026-10-09', end_date: null,
    ...over,
});

const kurry: PersonGroup = {
    person: { id: 'kurry', name: 'Kurry Admin', email: 'kurry@example.test' },
    contracts: [
        contract({ id: 'k-eis' }),
        contract({ id: 'k-setup', departments: { name: 'Events' }, sub_departments: { name: 'Event Setup' },
                   roles: { name: 'Event Setup Team Leader' }, employment_status: 'Casual', pay_basis: 'eba_level',
                   remuneration_level: 4, access_level: 'beta', start_date: '2023-01-09', end_date: '2026-12-01' }),
        contract({ id: 'k-next', status: 'Upcoming', roles: { name: 'Ushering Lead' }, start_date: '2026-11-02',
                   employment_status: 'Part-Time', contracted_weekly_hours: 20, pay_basis: 'eba_level', remuneration_level: 3, access_level: 'gamma' }),
        contract({ id: 'k-old', status: 'Expired', roles: { name: 'EIS Coordinator' }, start_date: '2025-01-01', end_date: '2026-02-15', access_level: 'beta' }),
    ],
    skills: [{ employee_id: 'kurry', name: 'Forklift' }],
    licences: [{ employee_id: 'kurry', name: 'RSA', expiration_date: '2026-11-02' }],
    workRights: [{ employee_id: 'kurry', name: 'Australian Citizen', verification_status: 'Verified' }],
};
const ann: PersonGroup = {
    person: { id: 'ann', name: 'Ann New', email: null }, contracts: [], skills: [], licences: [], workRights: [],
};

const refresh = vi.fn();
const renderTable = (over: Partial<React.ComponentProps<typeof UsersTable>> = {}) => render(
    <UsersTable
        groups={[ann, kurry]}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
        contractsOf={(id) => (id === 'kurry' ? kurry.contracts : [])}
        refresh={refresh}
        canManage
        {...over}
    />,
);
const table = () => screen.getByRole('table');
const bodyRows = () => within(table()).getAllByRole('row').slice(1);
const roleOrder = () => bodyRows().map((r) => r.querySelectorAll('td')[3]?.textContent ?? '');
/** A menu row's name: its words, without the ↵ hint (hidden from screen readers). */
const itemNames = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((i) => i.textContent!.replace('↵', '').trim());
const openActions = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(within(table()).getByRole('button', { name: `Actions for ${name}` }));
    return screen.findByRole('menu');
};

beforeEach(() => {
    mocks.update.mockReset();
    mocks.remove.mockReset();
    mocks.toast.mockReset();
    mocks.result = { error: null, count: 1 };
    mocks.pickers.length = 0;
    refresh.mockReset();
});

describe('UsersTable', () => {
    it('gives every contract its own one-line row, named by the person', () => {
        renderTable();
        const t = within(table());
        expect(bodyRows()).toHaveLength(5);
        expect(t.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Ann New', 'Kurry Admin', 'Kurry Admin', 'Kurry Admin', 'Kurry Admin']);
        expect(t.getByText('Event Setup Team Leader')).toBeTruthy();
        expect(t.getAllByText('Level 4')).toHaveLength(1);
        expect(screen.getByText('2 people · 4 contracts').getAttribute('role')).toBe('status');
    });

    it('keeps a warning off the line: an icon that names it, opening a popover with the way to fix it', async () => {
        const user = userEvent.setup();
        renderTable();
        const t = within(table());
        expect(t.queryByText('RSA expires 2 Nov 2026')).toBeNull();
        const icons = t.getAllByRole('button', { name: 'Licences warning for Kurry Admin: RSA expires 2 Nov 2026' });
        expect(icons).toHaveLength(4); // one per Kurry row
        await user.click(icons[0]);
        const pop = await screen.findByRole('dialog', { name: 'Licences · Kurry Admin' });
        expect(within(pop).getByText('RSA expires 2 Nov 2026')).toBeTruthy();
        await user.click(within(pop).getByRole('button', { name: 'Open licences' }));
        expect(screen.getByRole('dialog', { name: 'Edit panel' }).textContent).toBe('Kurry Admin · new contract · licences');
    });

    it('drops the second lines: no conversion note, no reach under the access, no dates repeated there', () => {
        renderTable();
        const t = within(table());
        // k-setup is a casual of over 3 years: once noted "Can ask to convert to permanent".
        expect(t.queryByText(/convert to permanent/)).toBeNull();
        expect(t.queryByText('Everywhere')).toBeNull();
        expect(t.queryByText(/^From /)).toBeNull();
        expect(t.queryByText(/^Revoked /)).toBeNull();
        // An ended contract's access is struck through, and says so.
        expect(t.getByText('(ended)')).toBeTruthy();
    });

    it('sorts by any column, marking the sorted header with aria-sort', async () => {
        const user = userEvent.setup();
        renderTable();
        const header = () => screen.getByRole('columnheader', { name: /^Role/ });
        expect(screen.getByRole('columnheader', { name: /^Name/ }).getAttribute('aria-sort')).toBe('ascending');
        expect(header().getAttribute('aria-sort')).toBeNull();

        await user.click(within(header()).getByRole('button', { name: 'Role' }));
        expect(header().getAttribute('aria-sort')).toBe('ascending');
        expect(screen.getByRole('columnheader', { name: /^Name/ }).getAttribute('aria-sort')).toBeNull();
        expect(roleOrder()).toEqual(['EIS Coordinator', 'EIS Specialist', 'Event Setup Team Leader', 'Ushering Lead', 'No contract yet']);
        expect(screen.getByText('Sorted by Role, ascending.')).toBeTruthy();

        await user.click(within(header()).getByRole('button', { name: 'Role' }));
        expect(header().getAttribute('aria-sort')).toBe('descending');
        expect(roleOrder()).toEqual(['Ushering Lead', 'Event Setup Team Leader', 'EIS Specialist', 'EIS Coordinator', 'No contract yet']);
    });

    it('leaves out the columns the viewer hid, and shows Email only when asked', () => {
        const { rerender } = renderTable({ columns: { organization: false, skills: false } });
        const headers = () => within(table()).getAllByRole('columnheader').map((h) => h.textContent);
        expect(headers()).not.toContain('Organization');
        expect(headers()).not.toContain('Skills');
        expect(headers()).not.toContain('Email');
        rerender(
            <UsersTable groups={[ann, kurry]} isLoading={false} isError={false} onRetry={() => {}} contractsOf={() => []}
                refresh={refresh} canManage columns={{ email: true }} />,
        );
        expect(headers()).toContain('Email');
        expect(within(table()).getAllByText('kurry@example.test')).toHaveLength(4);
    });

    it('edits a contract, or adds another, from the row’s ⋯ menu', async () => {
        const user = userEvent.setup();
        renderTable();
        const menu = await openActions(user, 'Kurry Admin, Event Setup Team Leader');
        expect(itemNames(menu)).toEqual(['Edit', 'Add contract', 'Revoke']);
        await user.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
        expect(screen.getByRole('dialog', { name: 'Edit panel' }).textContent).toBe('Kurry Admin · k-setup · contract');
    });

    it('offers a contract to someone without one, and no Revoke', async () => {
        const user = userEvent.setup();
        renderTable();
        expect(within(table()).getByText('No contract yet')).toBeTruthy();
        const menu = await openActions(user, 'Ann New');
        expect(itemNames(menu)).toEqual(['Edit', 'Add contract']);
        await user.click(within(menu).getByRole('menuitem', { name: 'Add contract' }));
        expect(screen.getByRole('dialog', { name: 'Edit panel' }).textContent).toBe('Ann New · new contract · contract');
    });

    it('revokes an active contract by ending it today, after a confirmation that says so', async () => {
        const user = userEvent.setup();
        renderTable();
        const menu = await openActions(user, 'Kurry Admin, Event Setup Team Leader');
        await user.click(within(menu).getByRole('menuitem', { name: 'Revoke' }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText(/ends today \(16 Oct 2026\)\. Its Team Lead access ends with it\. From tomorrow it shows as Expired/)).toBeTruthy();
        await user.click(within(dialog).getByRole('button', { name: 'Revoke contract' }));
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ end_date: '2026-10-16' }, { count: 'exact' }, 'id', 'k-setup'));
        expect(mocks.remove).not.toHaveBeenCalled();
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Contract revoked' })));
        expect(refresh).toHaveBeenCalled();
    });

    it('revokes a contract that hasn’t started by deleting it', async () => {
        const user = userEvent.setup();
        renderTable();
        const menu = await openActions(user, 'Kurry Admin, Ushering Lead');
        await user.click(within(menu).getByRole('menuitem', { name: 'Revoke' }));
        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText(/hasn't started \(it starts 2 Nov 2026\), so revoking deletes it, with the Manager access it would give\./)).toBeTruthy();
        await user.click(within(dialog).getByRole('button', { name: 'Revoke contract' }));
        await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ count: 'exact' }, 'id', 'k-next'));
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('offers no Revoke once a contract has ended, or ends today', async () => {
        const user = userEvent.setup();
        const endsToday = contract({ id: 'k-today', roles: { name: 'Last Day Role' }, end_date: '2026-10-16' });
        renderTable({ groups: [{ ...kurry, contracts: [...kurry.contracts, endsToday] }] });
        for (const name of ['Kurry Admin, EIS Coordinator', 'Kurry Admin, Last Day Role']) {
            const menu = await openActions(user, name);
            expect(within(menu).queryByRole('menuitem', { name: 'Revoke' })).toBeNull();
            await user.keyboard('{Escape}');
        }
    });

    it('says why the database refused a revoke (shifts rostered after today)', async () => {
        const user = userEvent.setup();
        mocks.result = { error: { message: '1 shift assigned under this contract falls outside these dates (the first on 3 Jan 2027). Reassign or unassign it first.' }, count: null };
        renderTable();
        const menu = await openActions(user, 'Kurry Admin, EIS Specialist');
        await user.click(within(menu).getByRole('menuitem', { name: 'Revoke' }));
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke contract' }));
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
            variant: 'destructive', title: 'Contract not revoked',
            description: expect.stringMatching(/^1 shift assigned under this contract falls outside these dates/),
        })));
    });

    it('returns focus to the row’s ⋯ button when the confirmation closes', async () => {
        const user = userEvent.setup();
        renderTable();
        const trigger = within(table()).getByRole('button', { name: 'Actions for Kurry Admin, EIS Specialist' });
        await user.click(trigger);
        await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Revoke' }));
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    });

    it('changes dates in place with the shared picker, as the rest of the app does', async () => {
        renderTable();
        fireEvent.click(within(table()).getByRole('button', { name: "End date of Kurry Admin's EIS Specialist" }));
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ end_date: '2026-12-24' }, { count: 'exact' }, 'id', 'k-eis'));
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'End date: 24 Dec 2026' })));
        // No month/year dropdowns: the default caption, like every other picker.
        expect(mocks.pickers.every((p) => p.captionLayout === undefined && p.fromYear === undefined)).toBe(true);
    });

    it('clears an end date: the contract runs on', async () => {
        renderTable();
        fireEvent.click(within(table()).getByRole('button', { name: "Clear the end date of Kurry Admin's Event Setup Team Leader (ongoing)" }));
        await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ end_date: null }, { count: 'exact' }, 'id', 'k-setup'));
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'No end date: ongoing' })));
    });

    it('is read-only without the Admin suite: sorting, and warnings to read', () => {
        renderTable({ canManage: false });
        const t = within(table());
        expect(t.queryAllByRole('button', { name: /^Actions for / })).toHaveLength(0);
        expect(t.queryAllByRole('button', { name: /date of/ })).toHaveLength(0);
        expect(t.getAllByRole('button').every((b) => b.closest('th[scope="col"]') || /warning for/.test(b.getAttribute('aria-label') ?? ''))).toBe(true);
        expect(t.getAllByText('Ongoing').length).toBeGreaterThan(0);
        expect(t.getByText('1 Dec 2026')).toBeTruthy();
    });

    it('counts what a search shows, and offers to clear one that finds nobody', () => {
        const onClearSearch = vi.fn();
        const { rerender } = renderTable({ groups: [kurry], search: 'kurry', totals: { people: 2, contracts: 4 } });
        expect(screen.getByText('Showing 1 of 2 people · 4 of 4 contracts')).toBeTruthy();
        rerender(
            <UsersTable groups={[]} search="zz" onClearSearch={onClearSearch} totals={{ people: 2, contracts: 4 }}
                isLoading={false} isError={false} onRetry={() => {}} contractsOf={() => []} refresh={refresh} canManage />,
        );
        expect(screen.getByText('No one matches “zz”')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(onClearSearch).toHaveBeenCalled();
    });

    it('says when nobody is in scope, and when loading failed', () => {
        const { rerender } = renderTable({ groups: [] });
        expect(screen.getByText('Nobody here yet')).toBeTruthy();
        const retry = vi.fn();
        rerender(<UsersTable groups={[]} isLoading={false} isError onRetry={retry} contractsOf={() => []} refresh={refresh} canManage />);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(retry).toHaveBeenCalled();
    });

    it('paginates contracts, updates controls, and navigates across pages', async () => {
        const manyContracts: ContractRow[] = Array.from({ length: 25 }, (_, i) =>
            contract({ id: `c-${i + 1}`, roles: { name: `Role ${i + 1}` } }),
        );
        const personWithMany: PersonGroup = {
            person: { id: 'p-many', name: 'Many Contracts', email: 'many@example.com' },
            contracts: manyContracts,
            skills: [],
            licences: [],
            workRights: [],
        };

        renderTable({ groups: [personWithMany] });

        // Shows 1-15 of 25 contracts initially (default pageSize = 15)
        expect(screen.getByText(/1–15 of 25 contracts/)).toBeTruthy();
        expect(screen.getByText('1 / 2')).toBeTruthy();

        // Check that page 1 has Role 1 but not Role 16 (rendered in both desktop table and mobile cards)
        expect(screen.getAllByText('Role 1').length).toBeGreaterThan(0);
        expect(screen.queryAllByText('Role 16')).toHaveLength(0);

        // Click next page
        const nextButton = screen.getByRole('button', { name: 'Next page' });
        fireEvent.click(nextButton);

        // Shows 16-25 of 25 contracts on page 2
        expect(screen.getByText(/16–25 of 25 contracts/)).toBeTruthy();
        expect(screen.getByText('2 / 2')).toBeTruthy();
        expect(screen.getAllByText('Role 16').length).toBeGreaterThan(0);
        expect(screen.queryAllByText('Role 1')).toHaveLength(0);

        // Previous button works
        const prevButton = screen.getByRole('button', { name: 'Previous page' });
        fireEvent.click(prevButton);
        expect(screen.getByText(/1–15 of 25 contracts/)).toBeTruthy();
        expect(screen.getByText('1 / 2')).toBeTruthy();

        // Change page size to 50
        const pageSizeSelect = screen.getByRole('combobox', { name: 'Rows per page' });
        fireEvent.change(pageSizeSelect, { target: { value: '50' } });
        expect(screen.getByText(/1–25 of 25 contracts/)).toBeTruthy();
        expect(screen.getByText('1 / 1')).toBeTruthy();
        expect(screen.getAllByText('Role 1').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Role 25').length).toBeGreaterThan(0);
    });
});
