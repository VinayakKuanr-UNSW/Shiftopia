/**
 * The signed-in user's contract basis — employment type, weekly hours, the
 * ordinary-hours envelope, and whether an empty availability calendar is a
 * problem for them (`availabilityMode`).
 *
 * Loading is a THIRD state, not "no contract". While `loading` is true the
 * basis is the empty one, whose mode is the strict 'OPT_IN' — so a consumer
 * that forgets to check would briefly tell a full-timer their availability is
 * mandatory. Every consumer must gate on `loading` before rendering a claim
 * about what the employee has to do.
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchScopedContractBasis, type ContractBasisRead } from '../api/contract-basis.api';
import { resolveComplianceBasis, type AvailabilityScopeRef } from '../domain/contract-basis';

export interface MyContractBasis {
    basis: ContractBasisRead;
    loading: boolean;
    refresh: () => Promise<void>;
}

const EMPTY: ContractBasisRead = { ...resolveComplianceBasis([]), roleIds: [], isError: false };

/**
 * @param scope Which JOB to resolve against. OMIT IT for the person-wide basis
 *   — hours caps, leave pricing, the ordinary-hours ledger — which is what
 *   every existing caller wants and gets unchanged. Pass a scope on the
 *   availability page, where the question is per-job: the same person can be a
 *   full-timer in one sub-department and a casual in another, and only the
 *   scoped basis decides whether THIS calendar should show an editor.
 */
export function useMyContractBasis(
    userId: string | null | undefined,
    scope?: AvailabilityScopeRef,
): MyContractBasis {
    const subDepartmentId = scope?.subDepartmentId ?? null;
    const departmentId = scope?.departmentId ?? null;
    const [basis, setBasis] = useState<ContractBasisRead>(EMPTY);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        if (!userId) {
            setBasis(EMPTY);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            setBasis(await fetchScopedContractBasis(userId, { subDepartmentId, departmentId }));
        } finally {
            setLoading(false);
        }
    }, [userId, subDepartmentId, departmentId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!userId) {
                if (!cancelled) { setBasis(EMPTY); setLoading(false); }
                return;
            }
            setLoading(true);
            const next = await fetchScopedContractBasis(userId, { subDepartmentId, departmentId });
            // The user can switch (impersonation, a fast re-auth) while this is
            // in flight; without the guard a stale response overwrites the
            // current person's basis and the page describes someone else's
            // contract.
            if (!cancelled) { setBasis(next); setLoading(false); }
        })();
        return () => { cancelled = true; };
        // Scope is a dependency: switching job must re-resolve the basis, or the
        // page keeps rendering the previous job's verdict about this one.
    }, [userId, subDepartmentId, departmentId]);

    return { basis, loading, refresh };
}
