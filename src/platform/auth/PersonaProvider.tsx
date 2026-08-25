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
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './useAuth';
import type { AccessCertificate, AccessLevel } from './types';

export type Persona = 'employee' | 'employer';

const STORAGE_KEY = 'shiftopia.persona';

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

    // A user who cannot be an employer must never be left in that persona —
    // a stored value can outlive the certificate that justified it.
    useEffect(() => {
        if (!canSwitch && persona === 'employer') setPersonaState('employee');
    }, [canSwitch, persona]);

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
