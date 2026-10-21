/**
 * `UnifiedRosterNavigator` can be restricted to the views a page supports.
 *
 * Moved from the retired Office page's tests (2026-10-04), which was the first
 * page to restrict it (week-only). The navigator behaviour is what is pinned:
 * that it can be restricted at all, that a single view hides the switcher
 * rather than showing one dead pill, and that views render in canonical order.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import {
    UnifiedRosterNavigator, type ViewType,
} from '@/modules/rosters/ui/components/UnifiedRosterNavigator';

function renderNav(views?: readonly ViewType[]) {
    return render(
        <UnifiedRosterNavigator
            date={new Date(2026, 8, 28)}
            viewType="week"
            onChange={vi.fn()}
            onViewTypeChange={vi.fn()}
            views={views}
        />,
    );
}

/**
 * The compact variant renders two labels per pill — a short one for phones and
 * a long one from `sm` up, with the other hidden by a breakpoint class. So a
 * pill's `textContent` is "DDay", and the long label has to be read directly.
 */
function offeredViews(container: HTMLElement): string[] {
    return [...container.querySelectorAll('button')]
        .map(b => b.querySelector('.sm\\:inline')?.textContent ?? '')
        .filter(t => ['Day', '3D', 'Week', 'Month'].includes(t));
}

describe('UnifiedRosterNavigator `views`', () => {
    it('the navigator offers every view by default', () => {
        renderNav();

        for (const label of ['Day', '3D', 'Week', 'Month']) {
            expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        }
    });

    it('a single offered view hides the switcher rather than showing one dead pill', () => {
        // A control that is permanently on and does nothing when pressed reads
        // as broken, which is worse than no control.
        const { container } = renderNav(['week']);

        expect(offeredViews(container)).toEqual([]);
        // The whole pill box goes, not just the control inside it -- otherwise
        // the bar carries an empty bordered box where the switcher was.
        expect(container.querySelector('.rounded-xl.p-1')).toBeNull();
    });

    it('offers exactly the views it is given, in the canonical order', () => {
        const { container } = renderNav(['month', 'day']);

        // Given out of order; rendered in VIEW_OPTIONS' order, so two pages
        // passing the same set always look the same.
        expect(offeredViews(container)).toEqual(['Day', 'Month']);
    });

    it('renders a Today button in full variant when showToday is true and snaps to today', async () => {
        const handleChange = vi.fn();
        const { container } = render(
            <UnifiedRosterNavigator
                variant="full"
                date={new Date(2025, 0, 1)}
                viewType="month"
                onChange={handleChange}
                onViewTypeChange={vi.fn()}
                showToday
            />
        );

        const todayBtn = screen.getByRole('button', { name: /snap to today/i });
        expect(todayBtn).toBeDefined();
        expect(todayBtn.textContent?.trim()).toBe('Today');
        expect(todayBtn.className).toContain('uppercase');
        expect(todayBtn.className).toContain('tracking-wider');

        // Click today button
        todayBtn.click();
        expect(handleChange).toHaveBeenCalled();
        const calledDate = handleChange.mock.calls[0][0];
        const now = new Date();
        expect(calledDate.getFullYear()).toBe(now.getFullYear());
        expect(calledDate.getMonth()).toBe(now.getMonth());
        expect(calledDate.getDate()).toBe(now.getDate());
    });

    it('date trigger does not use font-mono in full variant', () => {
        const { container } = render(
            <UnifiedRosterNavigator
                variant="full"
                date={new Date(2026, 9, 19)}
                viewType="month"
                onChange={vi.fn()}
                onViewTypeChange={vi.fn()}
            />
        );

        const dateBtn = container.querySelector('button[aria-label^="Change date"]');
        expect(dateBtn).toBeDefined();
        expect(dateBtn?.className).not.toContain('font-mono');
        expect(dateBtn?.className).toContain('font-bold');
    });
});
