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
import { MemoryRouter } from 'react-router-dom';
import {
    PersonaProvider,
    PersonaRouteSync,
    usePersona,
    resolvePersonaRoute,
    personaForPath,
} from '../PersonaProvider';
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

    /**
     * The persistence bug. `hasPermission` is derived from the resolved access
     * level, which arrives from an RPC AFTER the first render — so on every
     * reload there is a window where canSwitch is false. The old downgrade
     * effect wrote 'employee' into state during that window, destroying the
     * stored choice; when permissions landed nothing put it back, and a manager
     * was dropped into the employee sidebar on every refresh.
     */
    it('restores the stored employer persona once permissions arrive', () => {
        localStorage.setItem('shiftopia.persona', 'employer');

        // First render: the permission RPC has not resolved yet.
        authMocks.user = null;
        authMocks.hasPermission = () => false;
        const { rerender } = render(
            <PersonaProvider>
                <Probe />
            </PersonaProvider>,
        );
        expect(screen.getByTestId('persona').textContent).toBe('employee');

        // Permissions land.
        act(() => {
            setUser([cert('Y', 'epsilon')], true, 'epsilon');
        });
        rerender(
            <PersonaProvider>
                <Probe />
            </PersonaProvider>,
        );

        expect(screen.getByTestId('can-switch').textContent).toBe('true');
        expect(screen.getByTestId('persona').textContent).toBe('employer');
    });

    it('does not overwrite the stored persona while permissions are still loading', () => {
        localStorage.setItem('shiftopia.persona', 'employer');
        authMocks.user = null;
        authMocks.hasPermission = () => false;

        renderProbe();

        expect(localStorage.getItem('shiftopia.persona')).toBe('employer');
    });

    it('degrades to a fixed employee persona with no provider mounted', () => {
        render(<Probe />);
        expect(screen.getByTestId('persona').textContent).toBe('employee');
        expect(screen.getByTestId('can-switch').textContent).toBe('false');
    });
});

describe('resolvePersonaRoute', () => {
    it('maps employee routes to paired employer routes', () => {
        expect(resolvePersonaRoute('/my-roster', 'employer')).toBe('/rosters');
        expect(resolvePersonaRoute('/my-availabilities', 'employer')).toBe('/team-availability');
        expect(resolvePersonaRoute('/my-bids', 'employer')).toBe('/management/bids');
        expect(resolvePersonaRoute('/my-swaps', 'employer')).toBe('/management/swaps');
        expect(resolvePersonaRoute('/my-leave', 'employer')).toBe('/management/leave');
        expect(resolvePersonaRoute('/my-broadcasts', 'employer')).toBe('/broadcast');
        expect(resolvePersonaRoute('/performance', 'employer')).toBe('/insights');
        expect(resolvePersonaRoute('/my-attendance', 'employer')).toBe('/timesheet');
    });

    it('maps employer routes to paired employee routes', () => {
        expect(resolvePersonaRoute('/rosters', 'employee')).toBe('/my-roster');
        expect(resolvePersonaRoute('/team-availability', 'employee')).toBe('/my-availabilities');
        expect(resolvePersonaRoute('/grid', 'employee')).toBe('/my-availabilities');
        expect(resolvePersonaRoute('/management/bids', 'employee')).toBe('/my-bids');
        expect(resolvePersonaRoute('/management/swaps', 'employee')).toBe('/my-swaps');
        expect(resolvePersonaRoute('/management/leave', 'employee')).toBe('/my-leave');
        expect(resolvePersonaRoute('/broadcast', 'employee')).toBe('/my-broadcasts');
        expect(resolvePersonaRoute('/insights', 'employee')).toBe('/performance');
        expect(resolvePersonaRoute('/timesheet', 'employee')).toBe('/my-attendance');
    });

    it('falls back to /my-roster for employer-only pages when switching to employee', () => {
        expect(resolvePersonaRoute('/templates', 'employee')).toBe('/my-roster');
        expect(resolvePersonaRoute('/labor-demand', 'employee')).toBe('/my-roster');
        expect(resolvePersonaRoute('/compliance/rejections', 'employee')).toBe('/my-roster');
        expect(resolvePersonaRoute('/users', 'employee')).toBe('/my-roster');
    });

    it('preserves shared workspace routes across personas', () => {
        expect(resolvePersonaRoute('/profile', 'employer')).toBe('/profile');
        expect(resolvePersonaRoute('/profile', 'employee')).toBe('/profile');
        expect(resolvePersonaRoute('/settings', 'employer')).toBe('/settings');
        expect(resolvePersonaRoute('/settings/appearance', 'employee')).toBe('/settings/appearance');
        expect(resolvePersonaRoute('/my-notifications', 'employer')).toBe('/my-notifications');
    });

    it('respects permission fallback when switching to employer persona', () => {
        const hasPermission = (p: string) => p === 'insights';
        expect(resolvePersonaRoute('/my-roster', 'employer', hasPermission)).toBe('/insights');
    });
});

describe('personaForPath', () => {
    beforeEach(() => {
        localStorage.clear();
        authMocks.activeContract = null;
    });

    it('reads the employer persona off an employer surface', () => {
        expect(personaForPath('/rosters')).toBe('employer');
        expect(personaForPath('/rosters/shift/new')).toBe('employer');
        expect(personaForPath('/templates')).toBe('employer');
        expect(personaForPath('/management/bids')).toBe('employer');
        expect(personaForPath('/insights/fill-rate')).toBe('employer');
        expect(personaForPath('/team-availability')).toBe('employer');
        expect(personaForPath('/users')).toBe('employer');
    });

    it('reads the employee persona off an employee surface', () => {
        expect(personaForPath('/my-roster')).toBe('employee');
        expect(personaForPath('/my-bids')).toBe('employee');
        expect(personaForPath('/performance')).toBe('employee');
        expect(personaForPath('/my-attendance')).toBe('employee');
    });

    it('claims nothing for shared workspace routes', () => {
        expect(personaForPath('/profile')).toBeNull();
        expect(personaForPath('/settings/notifications')).toBeNull();
        // Shared, despite the /my- prefix.
        expect(personaForPath('/my-notifications')).toBeNull();
    });

    it('claims nothing for auth and error routes', () => {
        expect(personaForPath('/login')).toBeNull();
        expect(personaForPath('/unauthorized')).toBeNull();
    });
});

describe('PersonaRouteSync', () => {
    beforeEach(() => {
        localStorage.clear();
        authMocks.activeContract = null;
    });

    function renderAt(path: string) {
        render(
            <MemoryRouter initialEntries={[path]}>
                <PersonaProvider>
                    <PersonaRouteSync />
                    <Probe />
                </PersonaProvider>
            </MemoryRouter>,
        );
    }

    /** The reported bug: on /rosters with the employee sidebar showing. */
    it('adopts the employer persona when landing on an employer page', () => {
        localStorage.setItem('shiftopia.persona', 'employee');
        setUser([cert('X', 'alpha'), cert('Y', 'epsilon')], true, 'epsilon');

        renderAt('/rosters');

        expect(screen.getByTestId('persona').textContent).toBe('employer');
        expect(localStorage.getItem('shiftopia.persona')).toBe('employer');
    });

    it('adopts the employee persona when landing on an employee page', () => {
        localStorage.setItem('shiftopia.persona', 'employer');
        setUser([cert('X', 'alpha'), cert('Y', 'epsilon')], true, 'epsilon');

        renderAt('/my-roster');

        expect(screen.getByTestId('persona').textContent).toBe('employee');
    });

    it('leaves the persona alone on a shared route', () => {
        localStorage.setItem('shiftopia.persona', 'employer');
        setUser([cert('X', 'alpha'), cert('Y', 'epsilon')], true, 'epsilon');

        renderAt('/profile');

        expect(screen.getByTestId('persona').textContent).toBe('employer');
    });

    it('never puts a pure employee into the employer persona', () => {
        setUser([cert('X', 'alpha')], false);

        renderAt('/rosters');

        expect(screen.getByTestId('persona').textContent).toBe('employee');
        expect(localStorage.getItem('shiftopia.persona')).not.toBe('employer');
    });
});
