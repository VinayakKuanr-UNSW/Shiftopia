/**
 * The toolbar's Publish button: what it tells the manager before and after.
 *
 * Fixes pinned here (2026-10-18 toolbar audit):
 *  - a failed or incomplete plan read opens no confirm dialog and says why;
 *  - drafts skipped as "too late" or "not yours to publish" are listed;
 *  - Confirm is disabled when nothing in the plan can be published (it used to
 *    run and toast "Roster published — Nothing to publish.");
 *  - the result toast names WHY shifts were skipped (reasons were collected and
 *    then dropped);
 *  - a disabled Publish button stays reachable by keyboard and says why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/modules/core/hooks/use-toast', () => ({
    useToast: () => ({ toast: h.toast }),
}));

import { PublishRosterButton } from '../PublishRosterButton';
import type { PublishRosterPlan } from '@/modules/rosters/domain/bulk-action-engine';

const plan = (over: Partial<PublishRosterPlan> = {}): PublishRosterPlan => ({
    assignedIds: [],
    unassignedIds: [],
    emergentAssignedIds: [],
    emergentUnassignedIds: [],
    deadIds: [],
    fullTimeIds: [],
    fullTimeUnassignedIds: [],
    onLeaveIds: [],
    pastIds: [],
    noPermissionIds: [],
    alreadyPublishedCount: 0,
    ...over,
});

const publishButton = () => screen.getByRole('button', { name: /publish roster/i });

async function openWith(p: PublishRosterPlan, execute = vi.fn()) {
    render(<PublishRosterButton loadPlan={async () => p} execute={execute} selectedViewType="Week" selectedViewRange="5 – 11 Oct" />);
    fireEvent.click(publishButton());
    await screen.findByRole('alertdialog');
    return execute;
}

beforeEach(() => h.toast.mockReset());

describe('PublishRosterButton — plan load failure', () => {
    it('tells the manager why the plan could not load and opens no confirm dialog', async () => {
        const loadPlan = vi.fn().mockRejectedValue(
            new Error('This view holds more than 8,000 shifts — too many to publish at once. Narrow the date range or department, then publish.'),
        );
        const execute = vi.fn();

        render(<PublishRosterButton loadPlan={loadPlan} execute={execute} selectedViewType="Month" selectedViewRange="November 2099" />);
        fireEvent.click(publishButton());

        await waitFor(() => expect(h.toast).toHaveBeenCalledTimes(1));
        expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Could not prepare publish',
            description: expect.stringMatching(/more than 8,000 shifts/),
            variant: 'destructive',
        }));
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(execute).not.toHaveBeenCalled();
        expect(publishButton()).not.toBeDisabled();
    });
});

describe('PublishRosterButton — confirm dialog', () => {
    it('lists drafts skipped as too late and as outside the manager\'s publish rights', async () => {
        await openWith(plan({ assignedIds: ['a'], pastIds: ['p1', 'p2'], noPermissionIds: ['n1'] }));

        expect(screen.getByText('2 Already started or finished')).toBeInTheDocument();
        expect(screen.getByText('1 Where you can only view')).toBeInTheDocument();
    });

    it('disables Confirm when every draft is skipped, and says so', async () => {
        const execute = await openWith(plan({ alreadyPublishedCount: 3, pastIds: ['p1'] }));

        const confirm = screen.getByRole('button', { name: /confirm publish/i });
        expect(confirm).toBeDisabled();
        expect(screen.getByText(/nothing in this view can be published/i)).toBeInTheDocument();
        fireEvent.click(confirm);
        expect(execute).not.toHaveBeenCalled();
    });

    it('shows no invented date range when none is given', async () => {
        render(<PublishRosterButton loadPlan={async () => plan({ assignedIds: ['a'] })} execute={vi.fn()} />);
        fireEvent.click(publishButton());
        await screen.findByRole('alertdialog');

        expect(screen.queryByText('6 Jul - 12 Jul')).toBeNull();
    });
});

describe('PublishRosterButton — result', () => {
    it('names why shifts were skipped, grouped, in the result toast', async () => {
        const unreachable = 'Compliance engine unreachable — this shift could not be checked, so it was not published. Try again.';
        const execute = vi.fn().mockResolvedValue({
            published: 4,
            failed: 3,
            failedReasons: [unreachable, unreachable, 'Weekly hours would exceed 48'],
        });
        await openWith(plan({ assignedIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), execute);

        fireEvent.click(screen.getByRole('button', { name: /confirm publish/i }));

        await waitFor(() => expect(h.toast).toHaveBeenCalledTimes(1));
        const { title, description } = h.toast.mock.calls[0][0];
        expect(title).toBe('Roster published — with skips');
        expect(description).toMatch(/4 published · 3 skipped/);
        expect(description).toMatch(/Compliance engine unreachable.*\(×2\)/);
        expect(description).toMatch(/Weekly hours would exceed 48/);
    });
});

describe('PublishRosterButton — disabled', () => {
    it('stays focusable and says why when it cannot be used', () => {
        const loadPlan = vi.fn();
        render(
            <PublishRosterButton
                disabled
                disabledReason="View-only access — you can see this roster but not change it"
                loadPlan={loadPlan}
                execute={vi.fn()}
            />,
        );

        const btn = publishButton();
        expect(btn).toHaveAttribute('aria-disabled', 'true');
        expect(btn).not.toBeDisabled();
        expect(btn).toHaveAccessibleDescription(/View-only access/);
        btn.focus();
        expect(btn).toHaveFocus();
        fireEvent.click(btn);
        expect(loadPlan).not.toHaveBeenCalled();
    });
});
