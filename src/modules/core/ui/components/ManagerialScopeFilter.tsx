import React from 'react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { GlobalScopeFilter } from './GlobalScopeFilter';
import type { ScopeSelection } from '@/platform/auth/types';

interface ManagerialScopeFilterProps {
    onScopeChange: (scope: ScopeSelection) => void;
    /** 'timesheet' adds the Team Lead contracts' sub-departments (Timesheets page). */
    mode?: 'managerial' | 'timesheet';
    multiSelect?: boolean;
    compactOnMobile?: boolean;
}

/**
 * ManagerialScopeFilter
 *
 * Specialized implementation of GlobalScopeFilter for the managerial and
 * Timesheets trees, both built from the user's contracts.
 */
export const ManagerialScopeFilter: React.FC<ManagerialScopeFilterProps> = ({
    onScopeChange,
    mode = 'managerial',
    multiSelect = false,
    compactOnMobile = false,
}) => {
    const { scope, scopeTree, isGammaLocked, isLoading } = useScopeFilter(mode);

    if (isLoading || !scopeTree) {
        return null;
    }

    return (
        <GlobalScopeFilter
            allowedScopeTree={scopeTree}
            lockConfig={{
                // Nothing to choose with one organization (ICC Sydney). A zeta, or
                // someone with contracts in two organizations, may pick.
                orgLocked: scopeTree.organizations.length <= 1,
                deptLocked: isGammaLocked,
                subDeptLocked: isGammaLocked,
            }}
            defaultSelection={scope}
            onScopeChange={onScopeChange}
            multiSelect={multiSelect}
            compactOnMobile={compactOnMobile}
        />
    );
};
