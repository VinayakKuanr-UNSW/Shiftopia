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
import { fetchContractBasis, type ContractBasisRead } from '../api/contract-basis.api';
import { resolveComplianceBasis } from '../domain/contract-basis';

export interface MyContractBasis {
    basis: ContractBasisRead;
    loading: boolean;
    refresh: () => Promise<void>;
}

const EMPTY: ContractBasisRead = { ...resolveComplianceBasis([]), roleIds: [], isError: false };

export function useMyContractBasis(userId: string | null | undefined): MyContractBasis {
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
            setBasis(await fetchContractBasis(userId));
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!userId) {
                if (!cancelled) { setBasis(EMPTY); setLoading(false); }
                return;
            }
            setLoading(true);
            const next = await fetchContractBasis(userId);
            // The user can switch (impersonation, a fast re-auth) while this is
            // in flight; without the guard a stale response overwrites the
            // current person's basis and the page describes someone else's
            // contract.
            if (!cancelled) { setBasis(next); setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [userId]);

    return { basis, loading, refresh };
}
