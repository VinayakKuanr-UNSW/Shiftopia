/**
 * Choosing an organization (docs/architecture/multi-organization.md §6).
 *
 * A person whose certificates span several organizations picks one; the app's
 * current organization (settings, branding, the pages on OrgSelectionContext)
 * follows the highest certificate they hold there. Certificates arrive oldest
 * first, so ties go to the older one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    organizationsOf,
    pickActiveCertificate,
    readPreferredOrganization,
    writePreferredOrganization,
} from '../organizationChoice';
import type { AccessCertificate, AccessLevel } from '../types';

const ICC = 'org-icc';
const BCEC = 'org-bcec';

function cert(id: string, level: AccessLevel, organizationId: string | null, extra: Partial<AccessCertificate> = {}): AccessCertificate {
    return {
        id,
        userId: 'u',
        certificateType: level === 'alpha' || level === 'beta' ? 'X' : 'Y',
        accessLevel: level,
        organizationId,
        departmentId: null,
        subDepartmentId: null,
        isActive: true,
        organizationName: organizationId === ICC ? 'ICC Sydney' : organizationId === BCEC ? 'BCEC' : undefined,
        ...extra,
    };
}

describe('organizationsOf', () => {
    it('lists each organization once, in certificate order', () => {
        const certs = [cert('1', 'beta', ICC), cert('2', 'zeta', ICC), cert('3', 'zeta', BCEC)];
        expect(organizationsOf(certs)).toEqual([
            { id: ICC, name: 'ICC Sydney' },
            { id: BCEC, name: 'BCEC' },
        ]);
    });

    it('skips inactive certificates and certificates without an organization', () => {
        const certs = [cert('1', 'gamma', BCEC, { isActive: false }), cert('2', 'gamma', null), cert('3', 'gamma', ICC)];
        expect(organizationsOf(certs).map((o) => o.id)).toEqual([ICC]);
    });

    it('names an organization whose name did not load', () => {
        expect(organizationsOf([cert('1', 'gamma', 'org-x')])).toEqual([{ id: 'org-x', name: 'Organization' }]);
    });

    it('is empty without certificates', () => {
        expect(organizationsOf(undefined)).toEqual([]);
    });
});

describe('pickActiveCertificate', () => {
    it('takes the highest level when nothing is preferred', () => {
        const certs = [cert('beta-icc', 'beta', ICC), cert('gamma-bcec', 'gamma', BCEC)];
        expect(pickActiveCertificate(certs)?.id).toBe('gamma-bcec');
    });

    it('takes the highest level inside the preferred organization, even if higher access exists elsewhere', () => {
        const certs = [cert('zeta-icc', 'zeta', ICC), cert('beta-bcec', 'beta', BCEC), cert('gamma-bcec', 'gamma', BCEC)];
        expect(pickActiveCertificate(certs, BCEC)?.id).toBe('gamma-bcec');
    });

    it('falls back to the highest overall when the preferred organization is not held', () => {
        const certs = [cert('gamma-icc', 'gamma', ICC)];
        expect(pickActiveCertificate(certs, BCEC)?.id).toBe('gamma-icc');
    });

    it('breaks a tie in favour of the older certificate', () => {
        const certs = [cert('zeta-icc', 'zeta', ICC), cert('zeta-bcec', 'zeta', BCEC)];
        expect(pickActiveCertificate(certs)?.id).toBe('zeta-icc');
    });

    it('ignores inactive certificates', () => {
        const certs = [cert('zeta-old', 'zeta', ICC, { isActive: false }), cert('gamma', 'gamma', ICC)];
        expect(pickActiveCertificate(certs)?.id).toBe('gamma');
    });

    it('returns null without certificates', () => {
        expect(pickActiveCertificate([])).toBeNull();
    });
});

describe('remembered organization', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('round-trips per person', () => {
        writePreferredOrganization('user-a', BCEC);
        expect(readPreferredOrganization('user-a')).toBe(BCEC);
        expect(readPreferredOrganization('user-b')).toBeNull();
    });

    it('reads null and writes nothing when storage is unavailable', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(() => writePreferredOrganization('user-a', BCEC)).not.toThrow();
        expect(readPreferredOrganization('user-a')).toBeNull();
    });
});
