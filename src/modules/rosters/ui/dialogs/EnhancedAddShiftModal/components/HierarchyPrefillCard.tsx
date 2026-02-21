import React, { useMemo } from 'react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { Button } from '@/modules/core/ui/primitives/button';
import { Building2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Roster } from '../types';

interface HierarchyPrefillCardProps {
    onApply: (scope: { orgId?: string; deptId?: string; subDeptId?: string }) => void;
    currentOrgId?: string;
    currentDeptId?: string;
    currentSubDeptId?: string;
}

export const HierarchyPrefillCard: React.FC<HierarchyPrefillCardProps> = ({
    onApply,
    currentOrgId,
    currentDeptId,
    currentSubDeptId
}) => {
    // Mode is usually managerial for Add Shift context
    const { scope, scopeTree } = useScopeFilter('managerial');

    // Get primary selection (first ID)
    const selectedOrgId = scope?.org_ids?.[0];
    const selectedDeptId = scope?.dept_ids?.[0];
    const selectedSubDeptId = scope?.subdept_ids?.[0];

    // Helper to find names
    const names = useMemo(() => {
        if (!scopeTree?.organizations) return { org: '', dept: '', subDept: '' };

        const org = scopeTree.organizations.find(o => o.id === selectedOrgId);
        const dept = org?.departments.find(d => d.id === selectedDeptId);
        const subDept = dept?.subdepartments.find(sd => sd.id === selectedSubDeptId);

        return {
            org: org?.name || 'All Organizations',
            dept: dept?.name,
            subDept: subDept?.name
        };
    }, [scopeTree, selectedOrgId, selectedDeptId, selectedSubDeptId]);

    const hasScope = !!selectedOrgId || !!selectedDeptId;

    // Check if already applied (approximate check based on Department as Roster maps to Department)
    // We check Dept and SubDept
    const isApplied = (
        (!selectedDeptId || currentDeptId === selectedDeptId) &&
        (!selectedSubDeptId || currentSubDeptId === selectedSubDeptId)
    );

    if (!hasScope) return null;

    return (
        <div className="mb-6 p-1 rounded-2xl bg-gradient-to-r from-violet-500/10 via-purple-500/10 to-blue-500/10 border border-white/5">
            <div className="bg-[#0f172a]/80 backdrop-blur-xl rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-violet-400" />
                    </div>
                    <div>
                        <h4 className="text-xs font-bold text-violet-300 uppercase tracking-wider mb-1">
                            Global Filter Context
                        </h4>
                        <div className="flex items-center gap-2 text-sm text-white font-medium">
                            <span>{names.org}</span>
                            {(names.dept) && (
                                <>
                                    <ArrowRight className="h-3 w-3 text-white/20" />
                                    <span>{names.dept}</span>
                                </>
                            )}
                            {(names.subDept) && (
                                <>
                                    <ArrowRight className="h-3 w-3 text-white/20" />
                                    <span>{names.subDept}</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <Button
                    onClick={() => onApply({
                        orgId: selectedOrgId,
                        deptId: selectedDeptId,
                        subDeptId: selectedSubDeptId
                    })}
                    disabled={isApplied}
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "h-9 px-4 rounded-lg font-medium transition-all",
                        isApplied
                            ? "bg-emerald-500/10 text-emerald-400 cursor-default hover:bg-emerald-500/10"
                            : "bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 hover:text-violet-200"
                    )}
                >
                    {isApplied ? (
                        <>
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            Applied
                        </>
                    ) : (
                        "Apply to Context"
                    )}
                </Button>
            </div>
        </div>
    );
};
