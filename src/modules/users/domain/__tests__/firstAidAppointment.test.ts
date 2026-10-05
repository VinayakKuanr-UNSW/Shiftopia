import { describe, it, expect } from 'vitest';
import {
    allowedActions,
    appointmentStatus,
    currentQualifications,
    describeAppointmentError,
    previousDay,
    validateEndDate,
    validateNewAppointment,
} from '../firstAidAppointment';

/**
 * These rules mirror the database (exclusion constraint, range CHECK and the
 * history-guard trigger, 20261005064116). The cases below are the same ones
 * the rollback dry-run proved against prod on 2026-10-05, with today =
 * 2026-10-05: if the UI and the DB ever disagree, one of these breaks.
 */
const TODAY = '2026-10-05';
const ORG = 'org-1';
const appt = (effective_from: string, effective_to: string | null = null) =>
    ({ organization_id: ORG, effective_from, effective_to });

describe('appointmentStatus', () => {
    it('classifies by Sydney calendar date, inclusive of both ends', () => {
        expect(appointmentStatus(appt('2026-12-01'), TODAY)).toBe('scheduled');
        expect(appointmentStatus(appt('2026-10-05'), TODAY)).toBe('current');
        expect(appointmentStatus(appt('2026-10-01', '2026-10-05'), TODAY)).toBe('current');
        expect(appointmentStatus(appt('2026-09-01', '2026-10-04'), TODAY)).toBe('ended');
    });
});

describe('previousDay', () => {
    it('crosses month and year boundaries', () => {
        expect(previousDay('2026-10-01')).toBe('2026-09-30');
        expect(previousDay('2027-01-01')).toBe('2026-12-31');
        expect(previousDay('2028-03-01')).toBe('2028-02-29');
    });
});

describe('allowedActions — mirrors the history guard', () => {
    it('a scheduled appointment can be deleted, not ended', () => {
        expect(allowedActions(appt('2026-12-01'), TODAY)).toEqual({ canEnd: false, canDelete: true, earliestEnd: null });
    });

    it('a current appointment can only be ended, no earlier than yesterday', () => {
        expect(allowedActions(appt('2026-10-01'), TODAY)).toEqual({ canEnd: true, canDelete: false, earliestEnd: '2026-10-04' });
    });

    it('one that started today cannot end before its own start (the range CHECK)', () => {
        expect(allowedActions(appt('2026-10-05'), TODAY).earliestEnd).toBe('2026-10-05');
    });

    it('an ended appointment is frozen', () => {
        expect(allowedActions(appt('2026-09-01', '2026-09-10'), TODAY)).toEqual({ canEnd: false, canDelete: false, earliestEnd: null });
    });
});

describe('validateEndDate', () => {
    const current = appt('2026-10-01');
    it('accepts yesterday and later', () => {
        expect(validateEndDate(current, '2026-10-04', TODAY)).toBeNull();
        expect(validateEndDate(current, '2027-01-31', TODAY)).toBeNull();
    });
    it('refuses three days back — the DB refused the same in the dry-run', () => {
        expect(validateEndDate(current, '2026-10-02', TODAY)).toMatch(/earliest end date is 2026-10-04/);
    });
    it('refuses any change to an ended appointment', () => {
        expect(validateEndDate(appt('2026-09-01', '2026-09-10'), '2026-09-20', TODAY)).toMatch(/can no longer be changed/);
    });
});

describe('validateNewAppointment', () => {
    const input = (from: string, to: string | null = null, organizationId = ORG) => ({ organizationId, from, to });

    it('accepts a clean open-ended or single-day appointment', () => {
        expect(validateNewAppointment(input('2026-10-05'), [])).toBeNull();
        expect(validateNewAppointment(input('2026-11-20', '2026-11-20'), [])).toBeNull();
    });

    it('refuses an inverted range', () => {
        expect(validateNewAppointment(input('2026-12-10', '2026-12-01'), [])).toMatch(/before the start/);
    });

    it('refuses an overlap — including with an open-ended appointment', () => {
        expect(validateNewAppointment(input('2027-03-01'), [appt('2026-10-01')])).toMatch(/still in force/);
        expect(validateNewAppointment(input('2026-10-03', '2026-10-03'), [appt('2026-10-01', '2026-10-05')])).toMatch(/overlaps/);
    });

    it('allows back-to-back ranges and the same dates in a different organisation', () => {
        expect(validateNewAppointment(input('2026-10-06'), [appt('2026-10-01', '2026-10-05')])).toBeNull();
        expect(validateNewAppointment(input('2026-10-03', null, 'org-2'), [appt('2026-10-01')])).toBeNull();
    });
});

describe('currentQualifications — warning only, never a gate', () => {
    it('finds first-aid licences and skills current on the date, under either spelling', () => {
        const found = currentQualifications(
            [
                { name: 'First Aid Certificate', status: 'Active', expiration_date: '2027-03-01' },
                { name: 'CPR Certificate', status: 'Active', expiration_date: '2027-03-01' },
            ],
            [{ name: 'FirstAid Lv2', status: 'Verified', expiration_date: null }],
            TODAY,
        );
        expect(found).toEqual([
            { source: 'licence', name: 'First Aid Certificate', expires: '2027-03-01' },
            { source: 'skill', name: 'FirstAid Lv2', expires: null },
        ]);
    });

    it('ignores expired and suspended records', () => {
        expect(currentQualifications(
            [
                { name: 'First Aid Certificate', status: 'Active', expiration_date: '2026-10-04' },
                { name: 'First Aid Level 2', status: 'Suspended', expiration_date: '2027-01-01' },
            ],
            [],
            TODAY,
        )).toEqual([]);
    });
});

describe('describeAppointmentError', () => {
    it('maps the database refusals to sentences', () => {
        expect(describeAppointmentError({ code: '23P01' })).toMatch(/overlaps/);
        expect(describeAppointmentError({ code: '42501' })).toMatch(/permission|appoint yourself/);
        expect(describeAppointmentError({ code: 'P0001', message: 'This first-aid appointment has already ended; its dates can no longer change.' }))
            .toMatch(/already ended/);
    });
});
