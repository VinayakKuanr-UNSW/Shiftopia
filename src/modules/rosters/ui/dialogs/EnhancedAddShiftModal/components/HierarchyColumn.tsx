import React from 'react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { Building2, Lock } from 'lucide-react';
import { Label } from '@/modules/core/ui/primitives/label';
import { Input } from '@/modules/core/ui/primitives/input';

interface HierarchyColumnProps {
    orgId?: string;
    deptId?: string;
    subDeptId?: string;
    orgName?: string;
    deptName?: string;
    subDeptName?: string;
}

export const HierarchyColumn: React.FC<HierarchyColumnProps> = ({
    orgId,
    deptId,
    subDeptId,
    orgName,
    deptName,
    subDeptName,
}) => {
    // Resolve names from props. Resolution from tree happens in the parent (index.tsx)
    const displayNameOrg = orgName || 'All Organizations';
    const displayNameDept = deptName || 'All Departments';
    const displayNameSubDept = subDeptName || 'All Sub-Departments';

    return (
        <div className="flex flex-col h-full rounded-2xl bg-card/30 border border-border backdrop-blur-md overflow-hidden shadow-2xl transition-all duration-300 hover:border-violet-500/20 group/card">
            <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/10 text-violet-500 shadow-[0_0_15px_rgba(139,92,246,0.2)] group-hover/card:shadow-[0_0_20px_rgba(139,92,246,0.3)] transition-all">
                    <Building2 className="h-5 w-5" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-foreground tracking-tight uppercase">Hierarchy</h3>
                    <p className="text-[10px] text-muted-foreground/60 font-medium">Global Scope Context</p>
                </div>
            </div>

            <div className="p-5 flex flex-col gap-6 flex-1">
                {/* Org */}
                <div className="min-h-[70px] flex flex-col justify-center">
                    <div className="space-y-2">
                        <Label className="text-[11px] font-bold text-muted-foreground/80 uppercase tracking-[0.1em]">Organization</Label>
                        <div className="relative">
                            <Input
                                value={displayNameOrg}
                                disabled
                                className="h-11 bg-white/[0.02] border-white/5 text-foreground/60 text-sm rounded-xl cursor-not-allowed pl-10"
                            />
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
                        </div>
                    </div>
                </div>

                {/* Dept */}
                <div className="min-h-[70px] flex flex-col justify-center">
                    <div className="space-y-2">
                        <Label className="text-[11px] font-bold text-muted-foreground/80 uppercase tracking-[0.1em]">Department</Label>
                        <div className="relative">
                            <Input
                                value={displayNameDept}
                                disabled
                                className="h-11 bg-white/[0.02] border-white/5 text-foreground/60 text-sm rounded-xl cursor-not-allowed pl-10"
                            />
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
                        </div>
                    </div>
                </div>

                {/* SubDept */}
                <div className="min-h-[70px] flex flex-col justify-center">
                    <div className="space-y-2">
                        <Label className="text-[11px] font-bold text-muted-foreground/80 uppercase tracking-[0.1em]">Sub-Department</Label>
                        <div className="relative">
                            <Input
                                value={displayNameSubDept}
                                disabled
                                className="h-11 bg-white/[0.02] border-white/5 text-foreground/60 text-sm rounded-xl cursor-not-allowed pl-10"
                            />
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
