import { useEffect, useState } from 'react';
import { supabase } from '@/platform/realtime/client';
import { ChevronDown } from 'lucide-react';

interface OrgDeptSelectorProps {
    selectedOrganizationId: string | null;
    selectedDepartmentId: string | null;
    selectedSubDepartmentId: string | null;
    onOrganizationChange: (id: string | null) => void;
    onDepartmentChange: (id: string | null) => void;
    onSubDepartmentChange: (id: string | null) => void;
}

export function OrgDeptSelector({
    selectedOrganizationId,
    selectedDepartmentId,
    selectedSubDepartmentId,
    onOrganizationChange,
    onDepartmentChange,
    onSubDepartmentChange,
}: OrgDeptSelectorProps) {
    const [organizations, setOrganizations] = useState<any[]>([]);
    const [departments, setDepartments] = useState<any[]>([]);
    const [subDepartments, setSubDepartments] = useState<any[]>([]);

    // Load organizations
    useEffect(() => {
        const loadOrganizations = async () => {
            const { data } = await supabase.from('organizations').select('id, name').order('name');
            setOrganizations(data || []);
            if (data && data.length > 0 && !selectedOrganizationId) {
                onOrganizationChange(data[0].id);
            }
        };
        loadOrganizations();
    }, []);

    // Load departments when org changes
    useEffect(() => {
        if (!selectedOrganizationId) {
            setDepartments([]);
            return;
        }
        const loadDepartments = async () => {
            const { data } = await supabase
                .from('departments')
                .select('id, name')
                .eq('organization_id', selectedOrganizationId)
                .order('name');
            setDepartments(data || []);
            if (data && data.length > 0) {
                onDepartmentChange(data[0].id);
            }
        };
        loadDepartments();
    }, [selectedOrganizationId]);

    // Load sub-departments when dept changes
    useEffect(() => {
        if (!selectedDepartmentId) {
            setSubDepartments([]);
            return;
        }
        const loadSubDepartments = async () => {
            const { data } = await supabase
                .from('sub_departments')
                .select('id, name')
                .eq('department_id', selectedDepartmentId)
                .order('name');
            setSubDepartments(data || []);
            if (data && data.length > 0) {
                onSubDepartmentChange(data[0].id);
            }
        };
        loadSubDepartments();
    }, [selectedDepartmentId]);

    return (
        <div className="bg-background border-b border-border/40 py-5 px-8 relative z-20">
            <div className="flex flex-wrap items-center gap-4 max-w-[1600px] mx-auto">
                <div className="relative group">
                    <select
                        value={selectedOrganizationId || ''}
                        onChange={(e) => onOrganizationChange(e.target.value || null)}
                        className="appearance-none bg-card border border-border/50 rounded-xl pl-4 pr-12 py-2.5 text-xs text-foreground font-black uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer hover:bg-muted/40 hover:border-primary/30 min-w-[220px] shadow-sm"
                    >
                        <option value="" className="bg-card text-foreground">Select Organization</option>
                        {organizations.map((org) => (
                            <option key={org.id} value={org.id} className="bg-card text-foreground">
                                {org.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary group-hover:translate-y-0.5 transition-transform pointer-events-none" />
                </div>

                <div className="relative group">
                    <select
                        value={selectedDepartmentId || ''}
                        onChange={(e) => onDepartmentChange(e.target.value || null)}
                        className="appearance-none bg-card border border-border/50 rounded-xl pl-4 pr-12 py-2.5 text-xs text-foreground font-black uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer hover:bg-muted/40 hover:border-primary/30 min-w-[220px] disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                        disabled={!selectedOrganizationId}
                    >
                        <option value="" className="bg-card text-foreground">Select Department</option>
                        {departments.map((dept) => (
                            <option key={dept.id} value={dept.id} className="bg-card text-foreground">
                                {dept.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary group-hover:translate-y-0.5 transition-transform pointer-events-none" />
                </div>

                <div className="relative group">
                    <select
                        value={selectedSubDepartmentId || ''}
                        onChange={(e) => onSubDepartmentChange(e.target.value || null)}
                        className="appearance-none bg-card border border-border/50 rounded-xl pl-4 pr-12 py-2.5 text-xs text-foreground font-black uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer hover:bg-muted/40 hover:border-primary/30 min-w-[220px] disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                        disabled={!selectedDepartmentId}
                    >
                        <option value="" className="bg-card text-foreground">Select Sub-Department</option>
                        {subDepartments.map((subDept) => (
                            <option key={subDept.id} value={subDept.id} className="bg-card text-foreground">
                                {subDept.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-primary group-hover:translate-y-0.5 transition-transform pointer-events-none" />
                </div>
            </div>
        </div>
    );
}
