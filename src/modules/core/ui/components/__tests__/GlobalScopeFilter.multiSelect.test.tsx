import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { GlobalScopeFilter } from '../GlobalScopeFilter';

/**
 * Multi-select scope levels (2026-10-17), in the selector's own design: the
 * Command list with "Select All" and a square tick per option. Each option
 * also says whether it is chosen (aria-checked) — the list's aria-selected
 * marks only the highlighted row, so a screen reader heard nothing about the
 * chosen ones (WCAG 4.1.2). The Users page uses this for its scope.
 */

const TREE = {
    organizations: [{
        id: 'org-1',
        name: 'ICC Sydney',
        departments: [
            { id: 'dept-1', name: 'Event Delivery', subdepartments: [{ id: 'sub-1', name: 'Set-up' }] },
            { id: 'dept-2', name: 'Building Services', subdepartments: [{ id: 'sub-2', name: 'Cleaning' }] },
            { id: 'dept-3', name: 'Ict Services', subdepartments: [{ id: 'sub-3', name: 'Eis' }] },
        ],
    }],
};

function renderFilter() {
    const onScopeChange = vi.fn();
    render(
        <GlobalScopeFilter
            allowedScopeTree={TREE as any}
            lockConfig={{ orgLocked: true, deptLocked: false, subDeptLocked: false }}
            onScopeChange={onScopeChange}
            mode="managerial"
            multiSelect
        />,
    );
    return onScopeChange;
}

const latest = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[spy.mock.calls.length - 1]?.[0];
const optionNamed = (panel: HTMLElement, name: string) =>
    within(panel).getAllByRole('option').find((o) => o.textContent?.includes(name))!;

const openDepartments = async () => {
    fireEvent.click(screen.getAllByText('Department')[0].closest('button')!);
    return screen.findByRole('dialog', { name: 'Choose Department' });
};

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('GlobalScopeFilter — multi-select levels', () => {
    it('chooses several, each option saying whether it is chosen', async () => {
        const onScopeChange = renderFilter();
        await waitFor(() => expect(latest(onScopeChange)?.dept_ids).toHaveLength(3));
        const panel = await openDepartments();
        expect(optionNamed(panel, 'Select All').getAttribute('aria-checked')).toBe('true');
        expect(optionNamed(panel, 'Building Services').getAttribute('aria-checked')).toBe('true');

        fireEvent.click(optionNamed(panel, 'Building Services'));
        await waitFor(() => expect(latest(onScopeChange).dept_ids).toEqual(['dept-1', 'dept-3']));
        expect(optionNamed(panel, 'Building Services').getAttribute('aria-checked')).toBe('false');
        expect(optionNamed(panel, 'Select All').getAttribute('aria-checked')).toBe('mixed');
        // The panel stays open for the next pick.
        expect(screen.getByRole('dialog', { name: 'Choose Department' })).toBeTruthy();
    });

    it('says when a level is locked', () => {
        renderFilter();
        const location = screen.getAllByText('Location')[0].closest('button')!;
        expect(location.disabled).toBe(true);
        expect(location.textContent).toMatch(/\(locked\)/);
    });
});
