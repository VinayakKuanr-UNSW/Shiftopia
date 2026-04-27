
import React from 'react';
import { OpenBidsView } from '../views/OpenBidsView';
import { useAuth } from '@/platform/auth/useAuth';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { Gavel } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { UnifiedModuleFunctionBar } from '@/modules/core/ui/components/UnifiedModuleFunctionBar';
import { useState } from 'react';

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
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [searchQuery, setSearchQuery] = useState('');

    const { isDark } = useTheme();

    if (!activeContract) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 font-mono text-xs uppercase tracking-widest bg-background">
                Please select a manager certificate to view open bids.
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            {/* ── ROW 1: HEADER ────────────────────────────────────────────── */}
            <div className="flex-shrink-0 p-4 lg:p-6 pb-0">
                <PersonalPageHeader
                    title="Open Bids Manager"
                    Icon={Gavel}
                    mode="managerial"
                    scope={scope}
                    setScope={setScope}
                    isGammaLocked={isGammaLocked}
                />
            </div>

            {/* ── ROW 2: FUNCTION BAR ───────────────────────────────────────── */}
            <div className="flex-shrink-0 px-4 lg:px-6 py-2">
                <UnifiedModuleFunctionBar
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                />
            </div>

            {/* ── ROW 3: CONTENT AREA ───────────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6">
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
                        externalSearchQuery={searchQuery}
                        viewMode={viewMode}
                    />
                </div>
            </div>
        </div>
    );
};

export default ManagerBidsPage;
