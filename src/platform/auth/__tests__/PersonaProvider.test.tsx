/**
 * PersonaProvider — the employee / employer split.
 *
 * The two personas map onto the two certificate types the database already
 * distinguishes, and `chk_level_matches_type` guarantees the split is clean:
 * a Type X is alpha or beta, a Type Y is gamma or above. So the badge is a
 * direct read of the active persona's certificate, and these tests pin that
 * mapping rather than re-deriving a level from anywhere else.
 *
 * The case that matters most is the one production actually has: 100 of the
 * 101 certificates are Type X alpha, and the single Type Y holder has NO Type X
 * at all. Both one-sided shapes are covered below.
 */
import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaProvider, usePersona } from '../PersonaProvider';
import type { AccessCertificate, AccessLevel } from '../types';

const authMocks = vi.hoisted(() => ({
    user: null as unknown,
    hasPermission: ((_f: string) => false) as (f: string) => boolean,
    activeContract: null as unknown,
}));

vi.mock('@/platform/auth/useAuth', () => ({
    useAuth: () => ({
        user: authMocks.user,
        hasPermission: authMocks.hasPermission,
        activeContract: authMocks.activeContract,
    }),
}));

function cert(type: 'X' | 'Y', level: AccessLevel): AccessCertificate {
    return {
        id: `${type}-${level}`,
        userId: 'u1',
        certificateType: type,
        accessLevel: level,
        organizationId: 'org',
        departmentId: null,
        subDepartmentId: null,
        isActive: true,
    } as AccessCertificate;
}

function setUser(certs: AccessCertificate[], employerFeatures = false, highest: AccessLevel = 'alpha') {
    authMocks.user = { certificates: certs, highestAccessLevel: highest };
    authMocks.hasPermission = (f: string) =>
        employerFeatures && ['templates', 'rosters', 'timesheet-view', 'management', 'broadcast', 'insights'].includes(f);
}

const Probe: React.FC = () => {
    const { persona, displayLevel, canSwitch, togglePersona } = usePersona();
    return (
        <div>
            <span data-testid="persona">{persona}</span>
            <span data-testid="level">{displayLevel ?? 'none'}</span>
            <span data-testid="can-switch">{String(canSwitch)}</span>
            <button onClick={togglePersona}>toggle</button>
        </div>
    );
};

function renderProbe() {
    render(
        <PersonaProvider>
            <Probe />
        </PersonaProvider>,
    );
}

describe('PersonaProvider', () => {
    beforeEach(() => {
        localStorage.clear();
        authMocks.activeContract = null;
    });

    it('defaults a pure employee to the employee persona, with no way to switch', () => {
        setUser([cert('X', 'alpha')], false);
        renderProbe();

        expect(screen.getByTestId('persona').textContent).toBe('employee');
        expect(screen.getByTestId('can-switch').textContent).toBe('false');
        expect(screen.getByTestId('level').textContent).toBe('alpha');
    });

    // The plan's decision: seed on the certificate, not on hasPermission.
    it('seeds a Type Y holder into the employer persona', () => {
        setUser([cert('Y', 'epsilon')], true);
        renderProbe();

        expect(screen.getByTestId('persona').textContent).toBe('employer');
        expect(screen.getByTestId('level').textContent).toBe('epsilon');
    });

    it('badges the Type X level in employee mode and the Type Y level in employer mode', () => {
        setUser([cert('X', 'beta'), cert('Y', 'delta')], true);
        renderProbe();

        expect(screen.getByTestId('persona').textContent).toBe('employer');
        expect(screen.getByTestId('level').textContent).toBe('delta');

        act(() => { screen.getByText('toggle').click(); });

        expect(screen.getByTestId('persona').textContent).toBe('employee');
        expect(screen.getByTestId('level').textContent).toBe('beta');
    });

    // Production's actual shape: the only Type Y holder has no Type X.
    it('falls back to alpha in employee mode when the user holds no Type X', () => {
        setUser([cert('Y', 'epsilon')], true);
        renderProbe();

        act(() => { screen.getByText('toggle').click(); });

        expect(screen.getByTestId('persona').textContent).toBe('employee');
        expect(screen.getByTestId('level').textContent).toBe('alpha');
    });

    // canSwitch is hasPermission, NOT "holds a Type Y" — a user can hold
    // employer permissions through a contract. Gating on the certificate would
    // hide nav entries for pages the same user can still reach by URL.
    it('lets a permission-holding user switch even with no Type Y certificate', () => {
        setUser([cert('X', 'alpha')], true);
        renderProbe();

        expect(screen.getByTestId('can-switch').textContent).toBe('true');
        expect(screen.getByTestId('persona').textContent).toBe('employee');

        act(() => { screen.getByText('toggle').click(); });
        expect(screen.getByTestId('persona').textContent).toBe('employer');
    });

    it('persists the choice', () => {
        setUser([cert('X', 'alpha'), cert('Y', 'gamma')], true);
        renderProbe();

        act(() => { screen.getByText('toggle').click(); });
        expect(localStorage.getItem('shiftopia.persona')).toBe('employee');
    });

    // A stored persona can outlive the certificate that justified it.
    it('refuses to report the employer persona once the user cannot switch', () => {
        localStorage.setItem('shiftopia.persona', 'employer');
        setUser([cert('X', 'alpha')], false);
        renderProbe();

        expect(screen.getByTestId('persona').textContent).toBe('employee');
    });

    it('degrades to a fixed employee persona with no provider mounted', () => {
        render(<Probe />);
        expect(screen.getByTestId('persona').textContent).toBe('employee');
        expect(screen.getByTestId('can-switch').textContent).toBe('false');
    });
});
