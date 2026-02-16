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
        <div className="bg-gray-900/50 border-b border-gray-800 p-4">
            <div className="flex items-center gap-3">
                {/* Organization Dropdown */}
                <div className="relative">
                    <select
                        value={selectedOrganizationId || ''}
                        onChange={(e) => onOrganizationChange(e.target.value || null)}
                        className="appearance-none bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
                    >
                        <option value="">Select Organization</option>
                        {organizations.map((org) => (
                            <option key={org.id} value={org.id}>
                                {org.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>

                {/* Department Dropdown */}
                <div className="relative">
                    <select
                        value={selectedDepartmentId || ''}
                        onChange={(e) => onDepartmentChange(e.target.value || null)}
                        className="appearance-none bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
                        disabled={!selectedOrganizationId}
                    >
                        <option value="">Select Department</option>
                        {departments.map((dept) => (
                            <option key={dept.id} value={dept.id}>
                                {dept.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>

                {/* Sub-Department Dropdown */}
                <div className="relative">
                    <select
                        value={selectedSubDepartmentId || ''}
                        onChange={(e) => onSubDepartmentChange(e.target.value || null)}
                        className="appearance-none bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
                        disabled={!selectedDepartmentId}
                    >
                        <option value="">Select Sub-Department</option>
                        {subDepartments.map((subDept) => (
                            <option key={subDept.id} value={subDept.id}>
                                {subDept.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
            </div>
        </div>
    );
}
