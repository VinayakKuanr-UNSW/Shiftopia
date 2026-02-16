// src/platform/auth/useScopeFilter.ts
// Shared hook for page-level scope state management (Phase 5)

import { useState, useMemo, useCallback, useContext, useEffect } from 'react';
import { AuthContext } from './AuthProvider';
import type { ScopeSelection, ScopeTree } from './types';

export type ScopeMode = 'personal' | 'managerial';

interface UseScopeFilterOptions {
    /** Called whenever scope changes — use to reset pagination, sorting, etc. */
    onScopeChange?: () => void;
}

interface UseScopeFilterReturn {
    /** Current scope selection */
    scope: ScopeSelection;
    /** Updates the scope selection */
    setScope: (scope: ScopeSelection) => void;
    /** Serialised key for use in React Query cache keys */
    scopeKey: string;
    /** True if managerial gamma level — filter should be hidden, scope is fully fixed */
    isGammaLocked: boolean;
    /** Whether scope data is still loading from the permission object */
    isLoading: boolean;
    /** The allowed scope tree from the permission object */
    scopeTree: ScopeTree | null;
    /** The mode this filter is operating in */
    mode: ScopeMode;
}

/**
 * Compute default "select all" from a scope tree.
 */
function defaultSelectionFromTree(tree: ScopeTree | null | undefined): ScopeSelection {
    if (!tree?.organizations?.length) {
        return { org_ids: [], dept_ids: [], subdept_ids: [] };
    }

    return {
        org_ids: tree.organizations.map(o => o.id),
        dept_ids: tree.organizations.flatMap(o => o.departments.map(d => d.id)),
        subdept_ids: tree.organizations.flatMap(o =>
            o.departments.flatMap(d => d.subdepartments.map(sd => sd.id))
        ),
    };
}

/**
 * Build a personal scope tree from Type X certificates.
 */
function buildPersonalScopeTree(typeX: Array<{
    org_id: string; org_name: string;
    dept_id: string | null; dept_name: string | null;
    subdept_id: string | null; subdept_name: string | null;
}>): ScopeTree {
    if (!typeX?.length) return { organizations: [] };

    const orgMap = new Map<string, {
        id: string; name: string;
        depts: Map<string, { id: string; name: string; subdepts: { id: string; name: string }[] }>;
    }>();

    typeX.forEach(cert => {
        if (!orgMap.has(cert.org_id)) {
            orgMap.set(cert.org_id, {
                id: cert.org_id,
                name: cert.org_name,
                depts: new Map(),
            });
        }
        const org = orgMap.get(cert.org_id)!;

        if (cert.dept_id) {
            if (!org.depts.has(cert.dept_id)) {
                org.depts.set(cert.dept_id, {
                    id: cert.dept_id,
                    name: cert.dept_name || 'Department',
                    subdepts: [],
                });
            }
            if (cert.subdept_id) {
                const dept = org.depts.get(cert.dept_id)!;
                if (!dept.subdepts.find(sd => sd.id === cert.subdept_id)) {
                    dept.subdepts.push({
                        id: cert.subdept_id,
                        name: cert.subdept_name || 'Sub-Department',
                    });
                }
            }
        }
    });

    return {
        organizations: Array.from(orgMap.values()).map(org => ({
            id: org.id,
            name: org.name,
            departments: Array.from(org.depts.values()).map(dept => ({
                id: dept.id,
                name: dept.name,
                subdepartments: dept.subdepts,
            })),
        })),
    };
}

/**
 * useScopeFilter — Page-level scope state management hook.
 *
 * @param mode - 'personal' (Type X certs) or 'managerial' (Type Y cert)
 * @param options - Optional callbacks
 */
export function useScopeFilter(
    mode: ScopeMode,
    options: UseScopeFilterOptions = {}
): UseScopeFilterReturn {
    const context = useContext(AuthContext);
    const permissionObject = context?.permissionObject ?? null;
    const isPermissionsLoading = context?.isPermissionsLoading ?? true;

    // Derive the scope tree based on mode
    const scopeTree = useMemo<ScopeTree | null>(() => {
        if (!permissionObject) return null;

        if (mode === 'personal') {
            return buildPersonalScopeTree(permissionObject.typeX);
        }

        // Managerial: use the allowed_scope_tree from the RPC
        return permissionObject.allowed_scope_tree ?? null;
    }, [permissionObject, mode]);

    // Compute default selection
    const defaultScope = useMemo(() => defaultSelectionFromTree(scopeTree), [scopeTree]);

    const [scope, setScopeInternal] = useState<ScopeSelection>(defaultScope);

    // Sync scope when defaults change (e.g. permissions loaded)
    useEffect(() => {
        if (defaultScope.org_ids.length > 0) {
            setScopeInternal(defaultScope);
        }
    }, [defaultScope]);

    // Is gamma locked? Only relevant for managerial mode
    const isGammaLocked = useMemo(() => {
        if (mode !== 'managerial') return false;
        return permissionObject?.typeY?.level === 'gamma';
    }, [mode, permissionObject]);

    // Setter with optional onScopeChange callback
    const setScope = useCallback((newScope: ScopeSelection) => {
        setScopeInternal(newScope);
        options.onScopeChange?.();
    }, [options.onScopeChange]);

    // Serialised key for React Query
    const scopeKey = useMemo(() => {
        const ids = [
            ...scope.org_ids.sort(),
            '|',
            ...scope.dept_ids.sort(),
            '|',
            ...scope.subdept_ids.sort(),
        ];
        return ids.join(',');
    }, [scope]);

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
