import type { AccessCertificate, AccessLevel } from './types';

/**
 * Choosing an organization (docs/architecture/multi-organization.md §6).
 *
 * The app's current organization — settings, branding, the pages on
 * OrgSelectionContext — follows the active certificate. A person whose
 * certificates span several organizations picks one; the active certificate is
 * then the highest they hold there. Certificates arrive oldest first
 * (auth.service orders them), so ties go to the older one, and a first visit
 * opens the organization of the oldest highest-level certificate.
 */

export interface OrganizationOption {
    id: string;
    name: string;
    jurisdiction?: string;
}

const LADDER: readonly AccessLevel[] = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

const STORAGE_PREFIX = 'shiftopia:active-organization:';

function isActive(certificate: AccessCertificate): boolean {
    return certificate.isActive !== false;
}

function highest(certificates: readonly AccessCertificate[]): AccessCertificate | null {
    let best: AccessCertificate | null = null;
    let bestRank = -1;
    for (const certificate of certificates) {
        const rank = LADDER.indexOf(certificate.accessLevel);
        if (rank > bestRank) {
            best = certificate;
            bestRank = rank;
        }
    }
    return best;
}

/** Organizations the person holds active access in, each once, in certificate order. */
export function organizationsOf(certificates: readonly AccessCertificate[] | undefined): OrganizationOption[] {
    const byId = new Map<string, OrganizationOption>();
    for (const certificate of certificates ?? []) {
        if (!isActive(certificate) || !certificate.organizationId || byId.has(certificate.organizationId)) continue;
        byId.set(certificate.organizationId, {
            id: certificate.organizationId,
            name: certificate.organizationName || 'Organization',
            ...(certificate.organizationJurisdiction ? { jurisdiction: certificate.organizationJurisdiction } : {}),
        });
    }
    return [...byId.values()];
}

/**
 * The certificate that sets the current organization: the highest level held in
 * the preferred organization, or the highest overall when none is preferred or
 * the preferred one is not held.
 */
export function pickActiveCertificate(
    certificates: readonly AccessCertificate[] | undefined,
    preferredOrganizationId?: string | null,
): AccessCertificate | null {
    const active = (certificates ?? []).filter(isActive);
    const inPreferred = preferredOrganizationId
        ? active.filter((c) => c.organizationId === preferredOrganizationId)
        : [];
    return highest(inPreferred.length > 0 ? inPreferred : active);
}

/** The organization this browser last chose for this person, or null. */
export function readPreferredOrganization(userId: string): string | null {
    try {
        return window.localStorage.getItem(STORAGE_PREFIX + userId);
    } catch {
        return null;
    }
}

/** Remember the choice in this browser; a convenience, so failures are ignored. */
export function writePreferredOrganization(userId: string, organizationId: string): void {
    try {
        window.localStorage.setItem(STORAGE_PREFIX + userId, organizationId);
    } catch {
        // Private window or blocked storage: the choice lasts for this session only.
    }
}
