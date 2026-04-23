
import React from 'react';
import { OpenBidsView } from '../views/OpenBidsView';
import { useAuth } from '@/platform/auth/useAuth';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { Gavel } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

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

    const { isDark } = useTheme();

    if (!activeContract) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 font-mono text-xs uppercase tracking-widest bg-background">
                Please select a manager certificate to view open bids.
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* ── Unified Header ────────────────────────────────────────────── */}
            <div className="sticky top-0 z-30 -mx-4 px-4 md:-mx-8 md:px-8 pt-4 pb-4 lg:pb-6">
                <div className={cn(
                    "rounded-[32px] p-4 lg:p-6 transition-all border",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    {/* Row 1: Identity & Clock + Row 2: Scope Filter */}
                    <PersonalPageHeader
                        title="Open Bids Manager"
                        Icon={Gavel}
                        scope={scope}
                        setScope={setScope}
                        isGammaLocked={isGammaLocked}
                    />

                    {/* Row 3: Function Bar / Tabs could go here if needed */}
                </div>
            </div>

            {/* ── Main Content Area ─────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden pt-2 lg:pt-4">
                <div className={cn(
                    "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    <OpenBidsView
                        organizationId={scope.org_ids[0] ?? null}
                        departmentId={scope.dept_ids[0] ?? null}
                        subDepartmentId={scope.subdept_ids[0] ?? null}
                    />
                </div>
            </div>
        </div>
    );
};

export default ManagerBidsPage;
