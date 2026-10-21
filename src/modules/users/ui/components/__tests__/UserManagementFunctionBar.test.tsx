/**
 * The Users page function line (2026-10-17): a search, the Columns picker
 * (the scope selector's multi-select design), Export (Excel / PDF) and New
 * User; no person picker. Menus are opened for real — a dead Radix trigger once
 * left a menu unreachable while its tests stayed green.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/core/contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: false }) }));
vi.mock('../InviteUserDialog', () => ({ InviteUserDialog: () => <button type="button">New user</button> }));

const { UserManagementFunctionBar } = await import('../UserManagementFunctionBar');
import type { ColumnVisibility } from '../../usersTableColumns';

type Props = React.ComponentProps<typeof UserManagementFunctionBar>;
const renderBar = (over: Partial<Props> = {}) => {
    const props: Props = {
        isAdmin: true, onExport: vi.fn(), search: '', onSearchChange: vi.fn(), columns: {}, onColumnsChange: vi.fn(), ...over,
    };
    return { props, ...render(<UserManagementFunctionBar {...props} />) };
};

describe('UserManagementFunctionBar', () => {
    it('has a labelled search, in a search landmark', async () => {
        const user = userEvent.setup();
        const { props } = renderBar();
        const box = within(screen.getByRole('search')).getByRole('searchbox', { name: 'Search users' });
        await user.type(box, 'k');
        expect(props.onSearchChange).toHaveBeenLastCalledWith('k');
    });

    it('clears the search with its button or Escape, and keeps focus in the box', async () => {
        const user = userEvent.setup();
        const { props } = renderBar({ search: 'kurry' });
        await user.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(props.onSearchChange).toHaveBeenLastCalledWith('');
        expect(document.activeElement).toBe(screen.getByRole('searchbox'));
        (props.onSearchChange as ReturnType<typeof vi.fn>).mockClear();
        await user.keyboard('{Escape}');
        expect(props.onSearchChange).toHaveBeenCalledWith('');
    });

    it('shows or hides columns from a picker that stays open, each row saying whether it shows', async () => {
        const user = userEvent.setup();
        const onColumnsChange = vi.fn();
        renderBar({ columns: { organization: false } as ColumnVisibility, onColumnsChange });
        // Just "Columns": no count on the button.
        await user.click(screen.getByRole('button', { name: 'Columns' }));
        const panel = await screen.findByRole('dialog', { name: 'Choose columns' });
        const row = (name: string) => within(panel).getAllByRole('option').find((o) => o.textContent?.replace(/[↵⌘A]+$/, '') === name);
        // Name always shows, so it isn't offered; Email starts hidden.
        expect(row('Name')).toBeUndefined();
        expect(row('Email')!.getAttribute('aria-checked')).toBe('false');
        expect(row('Organization')!.getAttribute('aria-checked')).toBe('false');
        expect(row('Role')!.getAttribute('aria-checked')).toBe('true');
        expect(within(panel).getByRole('combobox', { name: 'Search columns' })).toBeTruthy();
        await user.click(row('Role')!);
        expect(onColumnsChange).toHaveBeenLastCalledWith({ organization: false, role: false });
        expect(screen.getByRole('dialog', { name: 'Choose columns' })).toBeTruthy();
    });

    it('exports to Excel or PDF from the menu', async () => {
        const user = userEvent.setup();
        const onExport = vi.fn();
        renderBar({ onExport });
        await user.click(screen.getByRole('button', { name: 'Export users' }));
        await user.click(await screen.findByRole('menuitem', { name: 'Excel (.xlsx)' }));
        expect(onExport).toHaveBeenCalledWith('xlsx');
        await user.click(screen.getByRole('button', { name: 'Export users' }));
        await user.click(await screen.findByRole('menuitem', { name: 'PDF' }));
        expect(onExport).toHaveBeenLastCalledWith('pdf');
    });

    it('has no person picker, and New User only for the Admin suite', () => {
        const { rerender, props } = renderBar();
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(screen.getByRole('button', { name: 'New user' })).toBeTruthy();
        rerender(<UserManagementFunctionBar {...props} isAdmin={false} />);
        expect(screen.queryByRole('button', { name: 'New user' })).toBeNull();
    });

    it('holds Export while there is nothing to export', () => {
        renderBar({ exportDisabled: true });
        expect((screen.getByRole('button', { name: 'Export users' }) as HTMLButtonElement).disabled).toBe(true);
    });
});
