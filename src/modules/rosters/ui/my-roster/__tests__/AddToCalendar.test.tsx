import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Shift } from '@/modules/rosters/domain/shift.entity';

const isNative = vi.hoisted(() => ({ value: false }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNative.value } }));

import { AddToCalendar } from '../AddToCalendar';

const shift = {
    id: 's1', shift_date: '2026-08-03', start_time: '09:00', end_time: '17:00',
    tz_identifier: 'Australia/Sydney', timezone: 'Australia/Sydney', is_overnight: false,
    is_cancelled: false, lifecycle_status: 'Published', version: 1,
    roles: { id: 'r1', name: 'Team Member' },
} as unknown as Shift;

afterEach(() => { isNative.value = false; });

describe('AddToCalendar', () => {
    it('offers a calendar file plus Google and Outlook links on the web', () => {
        render(<AddToCalendar shift={shift} groupName="Convention" />);

        expect(screen.getByRole('button', { name: 'Calendar file' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Google' }).getAttribute('href')).toContain('calendar.google.com');
        expect(screen.getByRole('link', { name: 'Outlook' }).getAttribute('href')).toContain('outlook.office.com');
    });

    it('drops the file download in the native app, where a Blob download does nothing', () => {
        isNative.value = true;
        render(<AddToCalendar shift={shift} />);

        expect(screen.queryByRole('button', { name: 'Calendar file' })).toBeNull();
        expect(screen.getByRole('link', { name: 'Google' })).toBeTruthy();
    });

    it('renders nothing for a shift that cannot form an event', () => {
        const broken = { ...shift, start_at: '2026-08-03T09:00:00Z', end_at: '2026-08-03T08:00:00Z' } as Shift;
        const { container } = render(<AddToCalendar shift={broken} />);

        expect(container.innerHTML).toBe('');
    });
});
