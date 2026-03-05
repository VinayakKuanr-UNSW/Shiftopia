
import React from 'react';
import { OpenBidsView } from '../views/OpenBidsView';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useAuth } from '@/platform/auth/useAuth';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';

/**
 * ManagerBidsPage
 * 
 * Detailed view for Managers to manage Shift Bidding.
 */
export const ManagerBidsPage: React.FC = () => {
    const { activeContract } = useAuth();
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const { selectDepartment, selectSubDepartment } = useOrgSelection();

    // Sync Scope Filter → OrgSelectionContext
    React.useEffect(() => {
        if (scope.dept_ids.length > 0) {
            selectDepartment(scope.dept_ids[0]);
        } else {
            selectDepartment(null);
        }
    }, [scope.dept_ids.join(','), selectDepartment]);

    React.useEffect(() => {
        if (scope.subdept_ids.length > 0) {
            selectSubDepartment(scope.subdept_ids[0]);
        } else {
            selectSubDepartment(null);
        }
    }, [scope.subdept_ids.join(','), selectSubDepartment]);

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
            <OpenBidsView />
        </div>
    );
};

export default ManagerBidsPage;
