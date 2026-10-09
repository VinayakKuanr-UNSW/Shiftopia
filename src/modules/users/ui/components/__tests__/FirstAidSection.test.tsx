/**
 * FirstAidSection — the screen managers use to appoint first aiders (cl 28.2).
 *
 * Assertions target what the user actually gets (the dialog's content, the
 * payload sent), not just that a button rendered: a dead trigger keeps every
 * type-check and shallow test green (see the dead-Radix-trigger bug class).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({
    appointments: [] as Array<Record<string, unknown>>,
    canManage: false,
    qualifications: [] as Array<Record<string, unknown>>,
    create: vi.fn(),
    end: vi.fn(),
    remove: vi.fn(),
}));

vi.mock('@/modules/users/hooks/useFirstAidAppointments', () => ({
    useFirstAidAppointments: () => ({ data: mocks.appointments, isLoading: false }),
    useEmployeeOrganisations: () => ({ data: [{ id: 'org-1', name: 'ICC Sydney' }] }),
    useFirstAidQualifications: () => ({ data: mocks.qualifications }),
    useCanManageFirstAid: () => ({ data: mocks.canManage }),
    useCreateFirstAidAppointment: () => ({ mutateAsync: mocks.create, isPending: false }),
    useEndFirstAidAppointment: () => ({ mutateAsync: mocks.end, isPending: false }),
    useDeleteFirstAidAppointment: () => ({ mutate: mocks.remove, isPending: false }),
}));

vi.mock('@/modules/core/lib/date.utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/modules/core/lib/date.utils')>()),
    todayISO: () => '2026-10-05',
}));

import FirstAidSection from '../FirstAidSection';

const row = (id: string, effective_from: string, effective_to: string | null = null) => ({
    id, organization_id: 'org-1', employee_id: 'emp-1', effective_from, effective_to,
    appointed_by: null, notes: null, created_at: '2026-10-01T00:00:00Z',
});

beforeEach(() => {
    mocks.appointments = [];
    mocks.canManage = false;
    mocks.qualifications = [];
    mocks.create.mockReset().mockResolvedValue(undefined);
    mocks.end.mockReset().mockResolvedValue(undefined);
    mocks.remove.mockReset();
});

describe('FirstAidSection', () => {
    it('shows no rate (money is shown in Gross Pay alone) and warns when no qualification is on record', () => {
        const { container } = render(<FirstAidSection employeeId="emp-1" employeeName="James" />);
        expect(screen.getByText(/allowance per ordinary hour · cl 28\.2/)).toBeTruthy();
        expect(container.textContent).not.toMatch(/\$/);
        expect(screen.getByRole('note').textContent).toMatch(/No current first-aid licence or skill/);
    });

    it('offers no actions to someone who cannot manage the appointment', () => {
        mocks.appointments = [row('cur', '2026-10-01'), row('fut', '2026-12-01')];
        render(<FirstAidSection employeeId="emp-1" employeeName="James" />);
        expect(screen.queryByRole('button', { name: /Appoint James/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /End the first-aid appointment/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Remove the scheduled/ })).toBeNull();
    });

    it('offers End on a current appointment, Remove on a scheduled one, nothing on an ended one', () => {
        mocks.canManage = true;
        mocks.appointments = [row('fut', '2026-12-01'), row('cur', '2026-10-01'), row('old', '2026-09-01', '2026-09-10')];
        render(<FirstAidSection employeeId="emp-1" employeeName="James" />);
        expect(screen.getAllByRole('button', { name: /End the first-aid appointment/ })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: /Remove the scheduled/ })).toHaveLength(1);
        expect(screen.getByText('Ended')).toBeTruthy();
    });

    it('Appoint opens the dialog and sends an open-ended appointment from today', async () => {
        mocks.canManage = true;
        render(<FirstAidSection employeeId="emp-1" employeeName="James" />);
        fireEvent.click(screen.getByRole('button', { name: /Appoint James as a first aider/ }));

        expect(await screen.findByText('Appoint first aider')).toBeTruthy();
        fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'certificate sighted' } });
        fireEvent.click(screen.getByRole('button', { name: /^Appoint$/ }));

        await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
            organization_id: 'org-1',
            employee_id: 'emp-1',
            effective_from: '2026-10-05',
            effective_to: null,
            notes: 'certificate sighted',
        }));
    });

    it('refuses an overlapping appointment before sending anything', async () => {
        mocks.canManage = true;
        mocks.appointments = [row('cur', '2026-10-01')];
        render(<FirstAidSection employeeId="emp-1" employeeName="James" />);
        fireEvent.click(screen.getByRole('button', { name: /Appoint James as a first aider/ }));

        expect((await screen.findByRole('alert')).textContent).toMatch(/still in force/);
        expect((screen.getByRole('button', { name: /^Appoint$/ }) as HTMLButtonElement).disabled).toBe(true);
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('End refuses a date before yesterday, then sends yesterday', async () => {
        mocks.canManage = true;
        mocks.appointments = [row('cur', '2026-10-01')];
        render(<FirstAidSection employeeId="emp-1" employeeName="James" />);
        fireEvent.click(screen.getByRole('button', { name: /End the first-aid appointment/ }));

        const lastDay = await screen.findByLabelText('Last day');
        fireEvent.change(lastDay, { target: { value: '2026-10-02' } });
        expect(screen.getByRole('alert').textContent).toMatch(/earliest end date is 2026-10-04/);

        fireEvent.change(lastDay, { target: { value: '2026-10-04' } });
        fireEvent.click(screen.getByRole('button', { name: /^End appointment$/ }));
        await waitFor(() => expect(mocks.end).toHaveBeenCalledWith({ id: 'cur', employeeId: 'emp-1', effectiveTo: '2026-10-04' }));
    });
});
