import React, { useContext, useMemo } from 'react';
import { AuthContext } from '@/platform/auth/AuthProvider';
import { GlobalScopeFilter, LockConfig } from './GlobalScopeFilter';
import { ScopeSelection, ScopeTree } from '@/platform/auth/types';

/**
 * PersonalScopeFilter
 *
 * For Type X (personal) context. This filter is typically much simpler
 * since personal certificates are scoped to a specific sub-department.
 * All three dropdowns are locked — the user only views only their own scope.
 */
interface PersonalScopeFilterProps {
    onScopeChange: (scope: ScopeSelection) => void;
    className?: string;
}

export const PersonalScopeFilter: React.FC<PersonalScopeFilterProps> = ({
    onScopeChange,
    className,
}) => {
    const context = useContext(AuthContext);
    const { permissionObject } = context || {};

    // Build a minimal scope tree from Type X certificates
    const scopeTree: ScopeTree = useMemo(() => {
        if (!permissionObject?.typeX?.length) return { organizations: [] };

        // Group certificates by org → dept → subdept
        const orgMap = new Map<string, { id: string; name: string; depts: Map<string, { id: string; name: string; subdepts: { id: string; name: string }[] }> }>();

        permissionObject.typeX.forEach(cert => {
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
    }, [permissionObject]);

    // Personal scope: Alpha/Beta users can multi-select from their certificate scope
    const lockConfig: LockConfig = {
        orgLocked: false,
        deptLocked: false,
        subDeptLocked: false,
    };

    // Default selection: all personal scopes
    const defaultSelection: ScopeSelection = useMemo(() => ({
        org_ids: scopeTree.organizations.map(o => o.id),
        dept_ids: scopeTree.organizations.flatMap(o => o.departments.map(d => d.id)),
        subdept_ids: scopeTree.organizations.flatMap(o =>
            o.departments.flatMap(d => d.subdepartments.map(sd => sd.id))
        ),
    }), [scopeTree]);

    if (!permissionObject || permissionObject.typeX.length === 0) return null;

    return (
        <GlobalScopeFilter
            allowedScopeTree={scopeTree}
            lockConfig={lockConfig}
            defaultSelection={defaultSelection}
            onScopeChange={onScopeChange}
            mode="personal"
            multiSelect={true}
            className={className}
        />
    );
};

export default PersonalScopeFilter;
