import React from 'react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { GlobalScopeFilter } from './GlobalScopeFilter';
import type { ScopeSelection } from '@/platform/auth/types';

interface ManagerialScopeFilterProps {
    onScopeChange: (scope: ScopeSelection) => void;
    multiSelect?: boolean;
}

/**
 * ManagerialScopeFilter
 * 
 * Specialized implementation of GlobalScopeFilter for 'managerial' (Type Y) mode.
 * Handles locking logic based on gamma certification.
 */
export const ManagerialScopeFilter: React.FC<ManagerialScopeFilterProps> = ({
    onScopeChange,
    multiSelect = false,
}) => {
    const { scope, scopeTree, isGammaLocked, isLoading } = useScopeFilter('managerial');

    if (isLoading || !scopeTree) {
        return null;
    }

    return (
        <GlobalScopeFilter
            mode="managerial"
            allowedScopeTree={scopeTree}
            lockConfig={{
                orgLocked: true, // Managerial certs are always pinned to an organization
                deptLocked: isGammaLocked,
                subDeptLocked: isGammaLocked,
            }}
            defaultSelection={scope}
            onScopeChange={onScopeChange}
            multiSelect={multiSelect}
        />
    );
};
