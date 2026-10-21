// src/platform/auth/useScopeFilter.ts
// Shared hook for page-level scope state management (Phase 5)

import { useMemo, useCallback, useContext, useEffect } from 'react';
import { AuthContext } from './AuthProvider';
import { useGlobalScopeContext } from './ScopeFilterContext';
import {
    offersOnePlace,
    reconcileScope,
    scopeKeyOf,
    scopeTreeFor,
    type ScopeMode,
} from './scope-selection';
import type { ScopeSelection, ScopeTree } from './types';

export type { ScopeMode } from './scope-selection';

interface UseScopeFilterOptions {
    /** Called whenever scope changes — use to reset pagination, sorting, etc. */
    onScopeChange?: () => void;
}

interface UseScopeFilterReturn {
    /** Current scope selection, always inside `scopeTree` */
    scope: ScopeSelection;
    /** Updates the scope selection */
    setScope: (scope: ScopeSelection) => void;
    /** Serialised key for use in React Query cache keys */
    scopeKey: string;
    /**
     * True when a managerial or Timesheets tree holds a single place (e.g. a gamma
     * in one sub-department): there is nothing to choose, so the filter is hidden.
     */
    isGammaLocked: boolean;
    /** Whether scope data is still loading from the permission object */
    isLoading: boolean;
    /** The places this mode may choose from, built from the user's contracts */
    scopeTree: ScopeTree | null;
    /** The mode this filter is operating in */
    mode: ScopeMode;
}

/**
 * useScopeFilter — Page-level scope state management hook.
 *
 * @param mode - 'personal' (the contracted sub-departments), 'managerial' (what
 *   gamma-and-above contracts reach) or 'timesheet' (that, plus Team Lead
 *   contracts). Timesheets shares the managerial selection, so a place picked
 *   on the Roster opens there too.
 * @param options - Optional callbacks
 */
export function useScopeFilter(
    mode: ScopeMode,
    options: UseScopeFilterOptions = {}
): UseScopeFilterReturn {
    const context = useContext(AuthContext);
    const { personalScope, setPersonalScope, managerialScope, setManagerialScope } = useGlobalScopeContext();

    const permissionObject = context?.permissionObject ?? null;
    const isPermissionsLoading = context?.isPermissionsLoading ?? true;

    const savedScope = mode === 'personal' ? personalScope : managerialScope;
    const setSavedScope = mode === 'personal' ? setPersonalScope : setManagerialScope;

    const scopeTree = useMemo(() => scopeTreeFor(permissionObject, mode), [permissionObject, mode]);

    // The saved choice, kept to what this person's contracts reach now.
    const scope = useMemo(() => reconcileScope(savedScope, scopeTree), [savedScope, scopeTree]);

    // First visit: save "everything" so pages in this mode share one choice.
    useEffect(() => {
        if (!savedScope && scope.org_ids.length > 0) {
            setSavedScope(scope);
        }
    }, [savedScope, scope, setSavedScope]);

    const isGammaLocked = useMemo(
        () => mode !== 'personal' && offersOnePlace(scopeTree),
        [mode, scopeTree],
    );

    const setScope = useCallback((newScope: ScopeSelection) => {
        setSavedScope(newScope);
        options.onScopeChange?.();
    }, [options.onScopeChange, setSavedScope]);

    const scopeKey = useMemo(() => scopeKeyOf(scope), [scope]);

    return {
        scope,
        setScope,
        scopeKey,
        isGammaLocked,
        isLoading: isPermissionsLoading,
        scopeTree,
        mode,
    };
}
