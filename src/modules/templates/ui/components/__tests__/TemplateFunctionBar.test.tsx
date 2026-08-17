import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
    useTheme: () => ({ isDark: false }),
}));

import { TemplateFunctionBar } from '../TemplateFunctionBar';

function renderBar(statusFilter: 'published' | 'draft' | 'archived' = 'draft') {
    const onStatusFilterChange = vi.fn();
    render(
        <TemplateFunctionBar
            statusFilter={statusFilter}
            onStatusFilterChange={onStatusFilterChange}
            searchQuery=""
            onSearchQueryChange={vi.fn()}
            onCreateTemplate={vi.fn()}
            counts={{ published: 0, draft: 1, archived: 0 }}
        />,
    );
    return onStatusFilterChange;
}

describe('TemplateFunctionBar status filter', () => {
    /**
     * These were role="tab" with no tabpanel and no aria-controls — an invalid
     * tab pattern, and an unfixable one here: the "panel" is the template list,
     * which on a phone lives in a drawer that is usually unmounted. Picking one
     * of three filters is a radiogroup.
     */
    it('is a radiogroup of three options, not a tablist', () => {
        renderBar();

        expect(screen.getByRole('radiogroup', { name: 'Filter templates by status' })).toBeInTheDocument();
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
        expect(screen.getAllByRole('radio')).toHaveLength(3);
    });

    it('reports the selected filter and folds the count into each option name', () => {
        renderBar('draft');

        // The count is part of the option's name, not loose text beside it — JSX
        // drops the newline between label and count, hence the optional space.
        expect(screen.getByRole('radio', { name: /Draft\s*\(1\)/ })).toBeChecked();
        expect(screen.getByRole('radio', { name: /Ready\s*\(0\)/ })).not.toBeChecked();
    });

    it('keeps one tab stop and moves selection with the arrow keys', async () => {
        const onStatusFilterChange = renderBar('draft');

        // Roving tabindex: only the checked option is tabbable.
        expect(screen.getByRole('radio', { name: /Draft/ })).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('radio', { name: /Ready/ })).toHaveAttribute('tabindex', '-1');

        screen.getByRole('radio', { name: /Draft/ }).focus();
        await userEvent.keyboard('{ArrowRight}');
        expect(onStatusFilterChange).toHaveBeenLastCalledWith('archived');

        await userEvent.keyboard('{ArrowLeft}');
        expect(onStatusFilterChange).toHaveBeenLastCalledWith('published');
    });

    it('wraps around at both ends', async () => {
        const onStatusFilterChange = renderBar('archived');

        screen.getByRole('radio', { name: /Archive/ }).focus();
        await userEvent.keyboard('{ArrowRight}');

        expect(onStatusFilterChange).toHaveBeenLastCalledWith('published');
    });

    it('still selects on click', async () => {
        const onStatusFilterChange = renderBar('draft');

        await userEvent.click(screen.getByRole('radio', { name: /Ready/ }));

        expect(onStatusFilterChange).toHaveBeenCalledWith('published');
    });

    /** These were h-9 (36px) below the sm breakpoint — i.e. on every phone, the
     *  only place the size mattered. */
    it('gives every filter a 44px tap target at phone widths', () => {
        renderBar();

        for (const option of screen.getAllByRole('radio')) {
            expect(option.className).toContain('min-h-[44px]');
            expect(option.className).not.toContain('h-9');
        }
    });

    /** iOS Safari zooms the page when a focused input's font-size is under 16px. */
    it('keeps the search field at 16px on phones', () => {
        renderBar();

        const search = screen.getByRole('searchbox', { name: /Search templates/ });
        expect(search.className).toContain('text-base');
        expect(search.className).toContain('min-h-[44px]');
    });
});
