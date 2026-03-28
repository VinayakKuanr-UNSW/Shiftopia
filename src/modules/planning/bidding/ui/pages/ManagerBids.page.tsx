
import React from 'react';
import { OpenBidsView } from '../views/OpenBidsView';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useAuth } from '@/platform/auth/useAuth';

/**
 * ManagerBidsPage
 *
 * Passes scope IDs directly to OpenBidsView as props.
 * Previously routed through OrgSelectionContext, but that context is gated by
 * employee access levels (epsilon/delta) and silently ignores calls from
 * top-level manager roles (ZETA/alpha/beta/gamma), causing dept/subdept
 * filters to be completely ignored.
 */
export const ManagerBidsPage: React.FC = () => {
    const { activeContract } = useAuth();
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');

    if (!activeContract) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 font-mono text-xs uppercase tracking-widest bg-background">
                Please select a manager certificate to view open bids.
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col">
            <ScopeFilterBanner
                mode="managerial"
                onScopeChange={setScope}
                hidden={isGammaLocked}
                multiSelect={false}
            />
            <OpenBidsView
                organizationId={scope.org_ids[0] ?? null}
                departmentId={scope.dept_ids[0] ?? null}
                subDepartmentId={scope.subdept_ids[0] ?? null}
            />
        </div>
    );
};

export default ManagerBidsPage;
