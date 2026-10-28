/**
 * Add Subgroup's custom range is validated where the manager can see it.
 *
 * An end date before the start, or a cleared date, used to make Submit do
 * nothing at all: `format()` threw inside the submit handler's try, before the
 * mutation, so no request and no message. There was also no length limit, and
 * the RPC creates a roster day for every date in the range.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@/modules/rosters/state/useRosterMutations', () => ({
    useAddSubGroupRange: () => ({ mutateAsync: h.mutateAsync, isPending: false }),
}));

import { CentralAddSubGroupDialog } from '../CentralAddSubGroupDialog';

function renderDialog() {
    render(
        <CentralAddSubGroupDialog
            open
            onOpenChange={() => {}}
            organizationId="org-1"
            departmentId="dept-1"
            subDepartmentId="sub-1"
            selectedDate={new Date(2026, 9, 5)}
        />,
    );
    fireEvent.change(screen.getByLabelText(/subgroup name/i), { target: { value: 'Late bar' } });
}

/** Switch the period select to Custom without driving the Radix popup. */
async function chooseCustom() {
    fireEvent.click(screen.getByRole('combobox', { name: /select roster period/i }));
    fireEvent.click(await screen.findByRole('option', { name: /custom/i }));
}

beforeEach(() => h.mutateAsync.mockReset());

describe('CentralAddSubGroupDialog — custom range', () => {
    it('says so, and will not submit, when the end is before the start', async () => {
        renderDialog();
        await chooseCustom();

        fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-20' } });
        fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-10' } });

        expect(screen.getByRole('alert')).toHaveTextContent(/end date is before the start date/i);
        expect(screen.getByRole('button', { name: /add subgroup/i })).toBeDisabled();
    });

    it('refuses a range longer than 366 days', async () => {
        renderDialog();
        await chooseCustom();

        fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-01-01' } });
        fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-06-30' } });

        expect(screen.getByRole('alert')).toHaveTextContent(/at most 366 days/i);
        expect(screen.getByRole('button', { name: /add subgroup/i })).toBeDisabled();
    });

    it('submits a valid range as calendar dates', async () => {
        renderDialog();
        await chooseCustom();

        fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-10' } });
        fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-20' } });
        fireEvent.click(screen.getByRole('button', { name: /add subgroup/i }));

        expect(screen.queryByRole('alert')).toBeNull();
        expect(h.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
            startDate: '2026-10-10',
            endDate: '2026-10-20',
            name: 'Late bar',
        }));
    });
});
