import React from 'react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { GlobalScopeFilter } from './GlobalScopeFilter';
import type { ScopeSelection } from '@/platform/auth/types';

interface PersonalScopeFilterProps {
    onScopeChange: (scope: ScopeSelection) => void;
    multiSelect?: boolean;
}

/**
 * PersonalScopeFilter
 * 
 * Specialized implementation of GlobalScopeFilter for 'personal' (Type X) mode.
 * Automatically fetches the personal scope tree and state from useScopeFilter.
 */
export const PersonalScopeFilter: React.FC<PersonalScopeFilterProps> = ({
    onScopeChange,
    multiSelect = true,
}) => {
    const { scope, scopeTree, isLoading } = useScopeFilter('personal');

    if (isLoading || !scopeTree) {
        return null; // Or a skeleton if needed
    }

    return (
        <GlobalScopeFilter
            mode="personal"
            allowedScopeTree={scopeTree}
            lockConfig={{
                orgLocked: false,
                deptLocked: false,
                subDeptLocked: false,
            }}
            defaultSelection={scope}
            onScopeChange={onScopeChange}
            multiSelect={multiSelect}
        />
    );
};
