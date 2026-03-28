import React, { useContext, useMemo } from 'react';
import { AuthContext } from '@/platform/auth/AuthProvider';
import { GlobalScopeFilter, LockConfig } from './GlobalScopeFilter';
import { ScopeSelection } from '@/platform/auth/types';

/**
 * ManagerialScopeFilter
 *
 * For Type Y (managerial) context. Locking behavior depends on the access level:
 * - Zeta:   unlocked org, unlocked dept, unlocked sub-dept (full access)
 * - Epsilon: locked org, unlocked dept, unlocked sub-dept
 * - Delta:  locked org, locked dept, unlocked sub-dept
 * - Gamma:  locked org, locked dept, locked sub-dept (fully locked → hidden)
 */
interface ManagerialScopeFilterProps {
    onScopeChange: (scope: ScopeSelection) => void;
    multiSelect?: boolean;
    className?: string;
}

export const ManagerialScopeFilter: React.FC<ManagerialScopeFilterProps> = ({
    onScopeChange,
    multiSelect = false,
    className,
}) => {
    const context = useContext(AuthContext);
    const { permissionObject } = context || {};

    const typeY = permissionObject?.typeY;
    const scopeTree = permissionObject?.allowed_scope_tree;

    // Derive lock config from Type Y level
    const lockConfig: LockConfig = useMemo(() => {
        if (!typeY) {
            return { orgLocked: true, deptLocked: true, subDeptLocked: true };
        }

        switch (typeY.level) {
            case 'zeta':
                return { orgLocked: false, deptLocked: false, subDeptLocked: false };
            case 'epsilon':
                return { orgLocked: true, deptLocked: false, subDeptLocked: false };
            case 'delta':
                return { orgLocked: true, deptLocked: true, subDeptLocked: false };
            case 'gamma':
                return { orgLocked: true, deptLocked: true, subDeptLocked: true };
            default:
                return { orgLocked: true, deptLocked: true, subDeptLocked: true };
        }
    }, [typeY]);

    // Default selection from the scope tree
    const defaultSelection: ScopeSelection = useMemo(() => {
        if (!scopeTree?.organizations?.length) {
            return { org_ids: [], dept_ids: [], subdept_ids: [] };
        }

        return {
            org_ids: scopeTree.organizations.map(o => o.id),
            dept_ids: scopeTree.organizations.flatMap(o => o.departments.map(d => d.id)),
            subdept_ids: scopeTree.organizations.flatMap(o =>
                o.departments.flatMap(d => d.subdepartments.map(sd => sd.id))
            ),
        };
    }, [scopeTree]);

    // No Type Y: don't render
    if (!typeY || !scopeTree) return null;

    // Gamma: fully locked, hide filter (scope is already fixed)
    const isFullyLocked = typeY.level === 'gamma';

    return (
        <GlobalScopeFilter
            allowedScopeTree={scopeTree}
            lockConfig={lockConfig}
            defaultSelection={defaultSelection}
            onScopeChange={onScopeChange}
            hidden={isFullyLocked}
            mode="managerial"
            multiSelect={multiSelect}
            className={className}
        />
    );
};

export default ManagerialScopeFilter;
