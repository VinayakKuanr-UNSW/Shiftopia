/**
 * The access-suites sheet (2026-10-14), level by level. If a row here changes,
 * the database matrix (rbac_permissions, supabase/tests/access_matrix/) must
 * change with it — the UI only decides what to show.
 */
import { describe, expect, it } from 'vitest';
import {
    FEATURE_RULES,
    allows,
    hasAdminSuite,
    hasPersonalSuite,
    holdingFrom,
    managerialMode,
    type AccessHolding,
} from '../accessSuites';
import type { AccessCertificate, AccessLevel } from '../types';

function cert(level: AccessLevel, isActive = true): AccessCertificate {
    return {
        id: `c-${level}`,
        userId: 'u',
        certificateType: level === 'alpha' || level === 'beta' ? 'X' : 'Y',
        accessLevel: level,
        organizationId: 'org',
        departmentId: null,
        subDepartmentId: null,
        isActive,
    };
}

/** A person as the sheet describes them: an X for Personal, a Y for the rest. */
function person(level: AccessLevel): AccessHolding {
    const certs = level === 'alpha' || level === 'beta' ? [cert(level)] : [cert('alpha'), cert(level)];
    return holdingFrom(certs, []);
}

describe('the access-suites sheet', () => {
    it.each([
        // level      personal managerial        admin
        ['alpha',   true,    'none',            false],
        ['beta',    true,    'timesheets-view', false],
        ['gamma',   true,    'full',            false],
        ['delta',   true,    'view',            false],
        ['epsilon', true,    'view',            false],
        ['zeta',    true,    'full',            true],
    ] as const)('%s → personal %s, managerial %s, admin %s', (level, personal, managerial, admin) => {
        const h = person(level);
        expect(hasPersonalSuite(h)).toBe(personal);
        expect(managerialMode(h)).toBe(managerial);
        expect(hasAdminSuite(h)).toBe(admin);
    });

    it('beta sees the Timesheets page and nothing else managerial', () => {
        const h = person('beta');
        expect(allows(h, 'timesheet-view')).toBe(true);
        for (const f of ['rosters', 'templates', 'management', 'broadcast', 'insights', 'timesheet-edit', 'update']) {
            expect(allows(h, f), f).toBe(false);
        }
    });

    it.each(['delta', 'epsilon'] as const)('%s opens every managerial page and changes nothing', (level) => {
        const h = person(level);
        for (const f of ['rosters', 'templates', 'management', 'broadcast', 'insights', 'timesheet-view']) {
            expect(allows(h, f), f).toBe(true);
        }
        for (const f of ['create', 'update', 'delete', 'timesheet-edit', 'managerial-write']) {
            expect(allows(h, f), f).toBe(false);
        }
    });

    it.each(['gamma', 'zeta'] as const)('%s changes things', (level) => {
        expect(allows(person(level), 'managerial-write')).toBe(true);
        expect(allows(person(level), 'timesheet-edit')).toBe(true);
    });

    it.each(['users', 'labor-demand', 'compliance', 'configurations', 'admin'])(
        'the Admin suite page %s is zeta only',
        (f) => {
            for (const level of ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] as const) {
                expect(allows(person(level), f), `${level} ${f}`).toBe(false);
            }
            expect(allows(person('zeta'), f)).toBe(true);
        },
    );

    it('Notifications, Settings and Profile are open to everyone signed in', () => {
        expect(allows(holdingFrom([], []), 'profile')).toBe(true);
    });
});

describe('several contracts (contracts carry access, 2026-10-15)', () => {
    it('gamma in one place and delta in another is still full somewhere: the database decides per place', () => {
        const h = holdingFrom([cert('gamma'), cert('delta')], [{}, {}]);
        expect(h.yLevels).toEqual(['delta', 'gamma']);
        expect(managerialMode(h)).toBe('full');
        expect(allows(h, 'create')).toBe(true);
        expect(hasAdminSuite(h)).toBe(false);
    });

    it('two view-only contracts are view-only', () => {
        expect(managerialMode(holdingFrom([cert('delta'), cert('epsilon')], [{}]))).toBe('view');
    });

    it('a team lead who also manages elsewhere is a manager, not a timesheet viewer', () => {
        const h = holdingFrom([cert('beta'), cert('gamma')], [{}, {}]);
        expect(managerialMode(h)).toBe('full');
        expect(h.xLevel).toBe('beta');
    });

    it('zeta on any contract is the Admin suite', () => {
        expect(hasAdminSuite(holdingFrom([cert('gamma'), cert('zeta')], [{}, {}]))).toBe(true);
    });
});

describe('holding', () => {
    it('a contract alone gives the Personal suite (decision #7: no X and no contract ⇒ no employee hat)', () => {
        expect(hasPersonalSuite(holdingFrom([], [{}]))).toBe(true);
        expect(hasPersonalSuite(holdingFrom([cert('zeta')], []))).toBe(false);
    });

    it('ignores revoked certificates', () => {
        const h = holdingFrom([cert('alpha'), cert('zeta', false)], []);
        expect(h.yLevel).toBeNull();
        expect(hasAdminSuite(h)).toBe(false);
    });

    it('reads the level, not the type column, so an untyped row still lands on the right side', () => {
        const untyped = { ...cert('gamma'), certificateType: undefined } as unknown as AccessCertificate;
        expect(holdingFrom([untyped], []).yLevel).toBe('gamma');
    });

    it('refuses a feature key nobody declared', () => {
        expect('no-such-feature' in FEATURE_RULES).toBe(false);
        expect(allows(person('zeta'), 'no-such-feature')).toBe(false);
    });
});
