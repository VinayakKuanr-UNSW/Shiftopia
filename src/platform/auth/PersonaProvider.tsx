/**
 * Employee / employer persona.
 *
 * One person can be both. Kurry Admin holds an Epsilon certificate AND works
 * shifts; the sidebar previously showed them every employer surface and every
 * "My …" surface at once, in one undifferentiated list. The persona splits that
 * list in two and lets them say which hat they are wearing.
 *
 * WHAT DECIDES THE LEVEL SHOWN. The two personas map onto the two certificate
 * types the database already distinguishes, so nothing new has to be invented:
 *
 *   employee → the Type X certificate  (alpha / beta)
 *   employer → the Type Y certificate  (gamma / delta / epsilon / zeta)
 *
 * `chk_level_matches_type` enforces exactly that split, so a Type X can never
 * be gamma+ and a Type Y can never be alpha/beta. The badge is therefore a
 * direct read of the active persona's certificate rather than a second opinion
 * about what the user's level is.
 *
 * A holder of one type but not the other is the common case: 100 of the 101
 * certificates in production are Type X alpha, and the single Type Y holder has
 * no Type X at all. So each side falls back to the contract's level, and
 * finally to 'alpha' — every employee is at least alpha, which is why the
 * employee side can always render something and the employer side cannot.
 *
 * WHY `canSwitch` IS NOT "HOLDS A TYPE Y". Seeding the default on typeY is
 * right (a manager should land in the employer view), but GATING on it is not:
 * `hasPermission` is what the sidebar entries and FeatureGate actually check,
 * and a user can hold employer permissions through a contract rather than a
 * certificate. Gating the toggle on the certificate would hide a page from the
 * nav that the same user can still reach by typing the URL — the toggle would
 * be lying about what they can do.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import type { AccessCertificate, AccessLevel } from './types';

export type Persona = 'employee' | 'employer';

const STORAGE_KEY = 'shiftopia.persona';

/**
 * 1-to-1 route pairings across Employee and Employer personas.
 */
export const PAIRED_ROUTES: Array<{
    employee: string;
    employer: string;
    employerPermission?: string;
}> = [
    { employee: '/my-roster', employer: '/rosters', employerPermission: 'rosters' },
    { employee: '/my-availabilities', employer: '/team-availability', employerPermission: 'management' },
    { employee: '/my-bids', employer: '/management/bids', employerPermission: 'management' },
    { employee: '/my-swaps', employer: '/management/swaps', employerPermission: 'management' },
    { employee: '/my-leave', employer: '/management/leave', employerPermission: 'management' },
    { employee: '/my-broadcasts', employer: '/broadcast', employerPermission: 'broadcast' },
    { employee: '/performance', employer: '/insights', employerPermission: 'insights' },
    { employee: '/my-attendance', employer: '/timesheet', employerPermission: 'timesheet-view' },
];

/**
 * Shared workspace pages that belong to the user/session, valid in both personas.
 */
export const SHARED_ROUTES = [
    '/profile',
    '/settings',
    '/my-notifications',
];

/**
 * Prioritized employer route fallback list when user lacks permission for the primary paired route.
 */
export const EMPLOYER_FALLBACK_ORDER: Array<{ path: string; permission: string }> = [
    { path: '/rosters', permission: 'rosters' },
    { path: '/team-availability', permission: 'management' },
    { path: '/management/bids', permission: 'management' },
    { path: '/insights', permission: 'insights' },
    { path: '/management/swaps', permission: 'management' },
    { path: '/management/leave', permission: 'management' },
    { path: '/templates', permission: 'templates' },
    { path: '/timesheet', permission: 'timesheet-view' },
    { path: '/broadcast', permission: 'broadcast' },
    { path: '/compliance/rejections', permission: 'management' },
    { path: '/users', permission: 'users' },
];

/**
 * Employer surfaces with no employee counterpart, so they cannot be derived
 * from PAIRED_ROUTES. `/management` covers the paired /management/* routes and
 * /management/payroll alike; the three availability aliases all redirect to
 * /team-availability but are classified anyway so the persona is right on the
 * first frame rather than after the redirect.
 */
const EMPLOYER_ONLY_ROUTES = [
    '/templates',
    '/users',
    '/labor-demand',
    '/compliance',
    '/management',
    '/grid',
    '/availability-manager',
    '/availibility-manger',
];

function matchesRoute(pathname: string, base: string): boolean {
    return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Which hat a route implies, or null when it implies neither.
 *
 * The persona is a claim about what the user is currently doing, so the route
 * they are actually on is better evidence than a value stored on their last
 * visit. Shared workspace pages, auth and error routes deliberately claim
 * nothing — landing on /profile must not silently flip anyone's hat, and
 * /my-notifications is shared despite reading like a "My …" page.
 */
export function personaForPath(pathname: string): Persona | null {
    if (SHARED_ROUTES.some((shared) => matchesRoute(pathname, shared))) return null;
    if (PAIRED_ROUTES.some((pair) => matchesRoute(pathname, pair.employee))) return 'employee';
    if (PAIRED_ROUTES.some((pair) => matchesRoute(pathname, pair.employer))) return 'employer';
    if (EMPLOYER_ONLY_ROUTES.some((route) => matchesRoute(pathname, route))) return 'employer';
    return null;
}

/**
 * Resolves the destination route when switching personas.
 */
export function resolvePersonaRoute(
    currentPath: string,
    targetPersona: Persona,
    hasPermission?: (permission: string) => boolean,
): string {
    // 1. Preserve shared workspace pages
    if (SHARED_ROUTES.some((shared) => currentPath === shared || currentPath.startsWith(`${shared}/`))) {
        return currentPath;
    }

    if (targetPersona === 'employer') {
        const pair = PAIRED_ROUTES.find((p) => currentPath === p.employee || currentPath.startsWith(`${p.employee}/`));
        if (pair) {
            if (!pair.employerPermission || !hasPermission || hasPermission(pair.employerPermission)) {
                return pair.employer;
            }
        }
        if (hasPermission) {
            const accessible = EMPLOYER_FALLBACK_ORDER.find((item) => hasPermission(item.permission));
            if (accessible) return accessible.path;
        }
        return '/rosters';
    } else {
        const pair = PAIRED_ROUTES.find((p) => currentPath === p.employer || currentPath.startsWith(`${p.employer}/`));
        if (pair) {
            return pair.employee;
        }
        // Aliases / legacy routes
        if (currentPath === '/grid' || currentPath.startsWith('/grid/')) {
            return '/my-availabilities';
        }
        // Fallback for employer-only pages (/templates, /labor-demand, /compliance/rejections, /users, etc.)
        return '/my-roster';
    }
}

/**
 * The employer surfaces, as the sidebar gates them. Anyone who can reach ANY of
 * these can switch personas — see the header note on why this is `hasPermission`
 * and not "holds a Type Y certificate".
 */
export const EMPLOYER_FEATURES = [
    'templates',
    'rosters',
    'timesheet-view',
    'management',
    'broadcast',
    'insights',
] as const;

interface PersonaContextValue {
    persona: Persona;
    setPersona: (next: Persona) => void;
    togglePersona: () => void;
    /** False for a pure employee — there is no second hat to put on. */
    canSwitch: boolean;
    /** The certificate backing each persona, when one exists. */
    employeeCertificate: AccessCertificate | null;
    employerCertificate: AccessCertificate | null;
    /**
     * The level to badge for the CURRENT persona. Null only when the employer
     * persona is active and nothing grants a level — which `canSwitch` prevents
     * from being reachable through the UI.
     */
    displayLevel: AccessLevel | null;
}

const PersonaContext = createContext<PersonaContextValue | undefined>(undefined);

function readStored(): Persona | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw === 'employee' || raw === 'employer' ? raw : null;
    } catch {
        // Private windows and blocked site-data both throw on access rather
        // than returning null. A persona is a convenience, never a gate.
        return null;
    }
}

export const PersonaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, hasPermission, activeContract } = useAuth();

    const employeeCertificate = useMemo(
        () => user?.certificates.find((c) => c.certificateType === 'X' && c.isActive !== false) ?? null,
        [user],
    );
    const employerCertificate = useMemo(
        () => user?.certificates.find((c) => c.certificateType === 'Y' && c.isActive !== false) ?? null,
        [user],
    );

    const canSwitch = useMemo(
        () => EMPLOYER_FEATURES.some((f) => hasPermission(f)),
        // hasPermission closes over the resolved level, which changes with the
        // user and the active contract/certificate.
        [hasPermission, user, activeContract],
    );

    // Seeded from the certificate, not from `canSwitch`: a manager should land
    // in the employer view, but someone who merely *can* switch should not be
    // dropped into a persona they did not ask for.
    const [persona, setPersonaState] = useState<Persona>(
        () => readStored() ?? (employerCertificate ? 'employer' : 'employee'),
    );

    // NO downgrade effect here, deliberately. `hasPermission` is derived from the
    // resolved access level, which arrives from an RPC after the first render, so
    // `canSwitch` is false for a moment on EVERY reload. An effect that wrote
    // 'employee' into state during that window destroyed the stored choice, and
    // nothing put it back once permissions landed — a manager was dropped into the
    // employee sidebar on every refresh. The exposed `persona` below is derived
    // through `canSwitch` instead, which serves the same purpose (a stored value
    // that outlives its certificate is never REPORTED) without discarding it.

    const setPersona = useCallback((next: Persona) => {
        setPersonaState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Non-fatal: the persona simply will not survive a reload.
        }
    }, []);

    const togglePersona = useCallback(
        () => setPersona(persona === 'employee' ? 'employer' : 'employee'),
        [persona, setPersona],
    );

    const displayLevel = useMemo<AccessLevel | null>(() => {
        if (persona === 'employee') {
            return employeeCertificate?.accessLevel
                ?? activeContract?.accessLevel
                ?? 'alpha';
        }
        return employerCertificate?.accessLevel
            ?? (user?.highestAccessLevel && user.highestAccessLevel !== 'alpha' && user.highestAccessLevel !== 'beta'
                ? user.highestAccessLevel
                : null);
    }, [persona, employeeCertificate, employerCertificate, activeContract, user]);

    const value = useMemo(
        () => ({
            persona: canSwitch ? persona : 'employee',
            setPersona,
            togglePersona,
            canSwitch,
            employeeCertificate,
            employerCertificate,
            displayLevel,
        }),
        [persona, canSwitch, setPersona, togglePersona, employeeCertificate, employerCertificate, displayLevel],
    );

    return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
};

/**
 * Keeps the persona honest about where the user actually is.
 *
 * Mounted inside the Router (the provider itself is not, because it only needs
 * auth). Landing on /rosters from a bookmark, a reload, a notification deep link
 * or a redirect used to leave the employee sidebar showing over a manager page;
 * now the route decides, and the choice is written through so it survives the
 * next reload. One component covers both navs — the sidebar and the mobile
 * bottom bar both read `persona` from this context.
 */
export const PersonaRouteSync: React.FC = () => {
    const { pathname } = useLocation();
    const { persona, setPersona, canSwitch } = usePersona();
    const syncedPath = useRef<string | null>(null);

    useEffect(() => {
        const implied = personaForPath(pathname);
        if (!implied) return;
        // Bail WITHOUT recording the path: permissions land after the first
        // render, so this must stay armed and re-run when `canSwitch` flips.
        if (implied === 'employer' && !canSwitch) return;
        // Once per navigation. Guarding on the path rather than on the persona
        // keeps a toggle made ON a shared route from being immediately undone.
        if (syncedPath.current === pathname) return;
        syncedPath.current = pathname;
        if (implied !== persona) setPersona(implied);
    }, [pathname, persona, canSwitch, setPersona]);

    return null;
};

/**
 * Falls back to a fixed employee persona rather than throwing when no provider
 * is mounted, so a component rendered in isolation (a test, a storybook-style
 * harness) degrades to the safest view instead of crashing.
 */
export function usePersona(): PersonaContextValue {
    const ctx = useContext(PersonaContext);
    if (ctx) return ctx;
    return {
        persona: 'employee',
        setPersona: () => {},
        togglePersona: () => {},
        canSwitch: false,
        employeeCertificate: null,
        employerCertificate: null,
        displayLevel: 'alpha',
    };
}
