import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// jsdom ships no ResizeObserver, and the sidebar's Radix ScrollArea throws
// without one the moment its scrollbar mounts.
class ResizeObserverStub {
    observe() { }
    unobserve() { }
    disconnect() { }
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

import TemplatesSidebar from '../TemplatesSidebar';

type SidebarTemplate = Parameters<typeof TemplatesSidebar>[0]['templates'][number];

/** The card's accessible name is its whole text, which begins with the org
 *  scope line — matching on the template name alone also hits "Actions for …". */
function selectButton(name = 'Event Setups Baseline') {
    return screen.getByRole('button', { name: new RegExp(`^ICC Sydney ${name}\\b`) });
}

function template(overrides: Partial<SidebarTemplate> = {}): SidebarTemplate {
    return {
        id: 't1',
        name: 'Event Setups Baseline',
        description: 'Baseline setups',
        status: 'draft',
        version: 1,
        groupCount: 4,
        subgroupCount: 1,
        shiftCount: 0,
        updatedAt: '2026-08-16T05:00:00Z',
        organizationName: 'ICC Sydney',
        ...overrides,
    } as SidebarTemplate;
}

function renderSidebar(props: Partial<Parameters<typeof TemplatesSidebar>[0]> = {}) {
    const handlers = {
        onSelectTemplate: vi.fn(),
        onCreateTemplate: vi.fn(),
        onDeleteTemplate: vi.fn(),
        onArchiveTemplate: vi.fn(),
        onSwitchToDraft: vi.fn(),
    };
    render(
        <TemplatesSidebar
            templates={[template()]}
            selectedTemplateId={null}
            statusFilter="draft"
            searchQuery=""
            {...handlers}
            {...props}
        />,
    );
    return handlers;
}

describe('TemplatesSidebar', () => {
    /**
     * Selecting a template was a bare `<div onClick>`: no role, no tab stop, no
     * name. Keyboard and switch-control users could not open a template at all.
     */
    it('exposes each template as a keyboard-reachable button named after it', async () => {
        const { onSelectTemplate } = renderSidebar();

        const card = selectButton();

        await userEvent.tab();
        expect(card).toHaveFocus();

        await userEvent.keyboard('{Enter}');
        expect(onSelectTemplate).toHaveBeenCalledWith('t1');
    });

    it('activates on Space as well as Enter', async () => {
        const { onSelectTemplate } = renderSidebar();

        selectButton().focus();
        await userEvent.keyboard(' ');

        expect(onSelectTemplate).toHaveBeenCalledWith('t1');
    });

    it('marks the open template with aria-current, not colour alone', () => {
        renderSidebar({ selectedTemplateId: 't1' });

        expect(selectButton()).toHaveAttribute('aria-current', 'true');
    });

    it('renders the templates as a named list', () => {
        renderSidebar({
            templates: [template(), template({ id: 't2', name: 'PM Base' })],
        });

        expect(screen.getByRole('list', { name: 'Draft templates' })).toBeInTheDocument();
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('names the row action menu instead of leaving it an unlabelled button', () => {
        renderSidebar();

        expect(
            screen.getByRole('button', { name: 'Actions for Event Setups Baseline' }),
        ).toBeInTheDocument();
    });

    /** This button was wired to `() => {}` — the one offered way out of an empty
     *  Ready tab did nothing when pressed. */
    it('switches to drafts from the empty Ready state', async () => {
        const { onSwitchToDraft } = renderSidebar({ templates: [], statusFilter: 'published' });

        await userEvent.click(screen.getByRole('button', { name: 'View Drafts' }));

        expect(onSwitchToDraft).toHaveBeenCalledOnce();
    });

    it('does not nest the row menu inside the select button', () => {
        renderSidebar();

        const select = selectButton();
        const menu = screen.getByRole('button', { name: /^Actions for/ });

        expect(select.contains(menu)).toBe(false);
    });
});
