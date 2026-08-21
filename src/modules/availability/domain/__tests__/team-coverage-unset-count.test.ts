import { describe, expect, it } from 'vitest';
import { buildCoverageBuckets, buildTeamDayCells, summarise } from '../team-coverage';
import type { TeamAvailabilityInputs, TeamMember } from '../../model/team-availability.types';
import type { EmployeeAvailability } from '@/modules/rosters/domain/availabilityResolution.types';

/**
 * The "Not declared" tile, against the shape production actually produces.
 *
 * `summarise` counted the chase-list with `m.hasDeclared === false`. Nothing
 * populates `hasDeclared` — `getTeamMembers` does not return the field and no
 * other producer sets it — so on every real page load the predicate was false
 * for every member and the tile read a permanent ZERO.
 *
 * That is why it survived: a chase-list of zero looks like good news. An empty
 * list and a broken list render identically, and the one number a manager would
 * use to notice that nobody had declared for a job was the number that could
 * never move.
 *
 * The domain tests that existed all passed `hasDeclared` explicitly, so they
 * exercised a shape the API never emits. These fixtures deliberately OMIT it,
 * which is the whole point of the file.
 *
 * The fix reads absence from the availability map — the same signal
 * `resolveState` already used for the per-day cell, and a scoped one:
 * `getResolvedAvailabilities` omits a profile with no rules, and its rule probe
 * filters by sub-department. So "not declared" means "not declared FOR THIS
 * JOB", which is what makes the tile answer the question the page is filtered
 * to rather than a person-wide one.
 */

const DATE = '2026-08-10';

function member(over: Partial<TeamMember> & { profileId: string }): TeamMember {
    return {
        fullName: over.profileId,
        roleId: null,
        roleName: null,
        departmentId: null,
        subDepartmentId: null,
        employmentStatus: 'Casual',
        ...over,
    };
}

function avail(date: string): EmployeeAvailability {
    return {
        employeeId: 'x',
        date,
        availableWindows: [{ start: '09:00', end: '17:00' }],
        unavailableWindows: [],
        isFullyAvailable: false,
        isFullyUnavailable: false,
        hasData: true,
    } as EmployeeAvailability;
}

function inputs(over: Partial<TeamAvailabilityInputs> = {}): TeamAvailabilityInputs {
    return {
        members: [],
        dates: [DATE],
        availability: new Map(),
        shifts: [],
        leaveDays: [],
        required: null,
        requiredSource: 'shifts',
        ...over,
    };
}

function summaryOf(i: TeamAvailabilityInputs) {
    return summarise(i, buildTeamDayCells(i), buildCoverageBuckets(i), DATE);
}

describe('summarise — the "Not declared" chase-list', () => {
    // The defect, stated in the shape the API emits: no `hasDeclared` anywhere.
    it('counts a casual with no declaration even though hasDeclared is absent', () => {
        const i = inputs({ members: [member({ profileId: 'c1' })] });
        expect(summaryOf(i).unsetCount).toBe(1);
    });

    it('does not count a casual who has declared', () => {
        const i = inputs({
            members: [member({ profileId: 'c1' })],
            availability: new Map([['c1', new Map([[DATE, avail(DATE)]])]]),
        });
        expect(summaryOf(i).unsetCount).toBe(0);
    });

    // The exclusion that already worked, and must keep working: a permanent
    // cannot declare, so counting them would put the entire full-time headcount
    // on a chase-list with nothing to chase.
    it('never counts a contract-rostered permanent, declared or not', () => {
        const i = inputs({
            members: [member({ profileId: 'ft1', contractType: 'FT', employmentStatus: 'Full-Time' })],
        });
        expect(summaryOf(i).unsetCount).toBe(0);
    });

    // The multi-job employee, which is what the scoping work is for. Under a
    // Security filter their scoped contractType is FT, so they are a fact;
    // under Set-up it is Casual, so they are a chase.
    it('counts the same person under their casual job and not under their full-time one', () => {
        const asSecurity = inputs({
            members: [member({ profileId: 'multi', contractType: 'FT', employmentStatus: 'Full-Time' })],
        });
        const asSetup = inputs({
            members: [member({ profileId: 'multi', contractType: 'CASUAL' })],
        });
        expect(summaryOf(asSecurity).unsetCount).toBe(0);
        expect(summaryOf(asSetup).unsetCount).toBe(1);
    });

    it('still honours an explicit hasDeclared: false', () => {
        const i = inputs({
            members: [member({ profileId: 'c1', hasDeclared: false })],
            availability: new Map([['c1', new Map([[DATE, avail(DATE)]])]]),
        });
        expect(summaryOf(i).unsetCount).toBe(1);
    });

    it('counts each undeclared casual once, not per date', () => {
        const i = inputs({
            dates: [DATE, '2026-08-11', '2026-08-12'],
            members: [member({ profileId: 'c1' }), member({ profileId: 'c2' })],
        });
        expect(summaryOf(i).unsetCount).toBe(2);
    });
});
