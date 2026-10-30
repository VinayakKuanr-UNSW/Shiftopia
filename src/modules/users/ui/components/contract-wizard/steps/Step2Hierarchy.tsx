import React, { useMemo } from 'react';
import { Building2, Users, ChevronRight, Briefcase } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { CommandSelector } from '../../CommandSelector';
import { formatBand } from '../../../../domain/contractPayTerms';
import { text } from '@/modules/core/ui/typography';
import type { AccessLevel } from '@/platform/auth/types';
import { AccessLevelPicker, roleLeadsTeam } from '../AccessLevelPicker';
import { ContractDateFields } from '../ContractDateFields';

interface RefRow {
    id: string;
    name: string;
    [key: string]: any;
}

interface Step2HierarchyProps {
    organizations: RefRow[];
    departments: RefRow[];
    subDepartments: RefRow[];
    roles: any[];
    organization_id: string;
    department_id: string;
    sub_department_id: string;
    role_id: string;
    onOrgChange: (id: string) => void;
    onDeptChange: (id: string) => void;
    onSubDeptChange: (id: string) => void;
    onRoleChange: (id: string) => void;
    access_level: AccessLevel | null;
    onAccessChange: (level: AccessLevel) => void;
    start_date: string;
    end_date: string;
    onDatesChange: (patch: { start_date?: string; end_date?: string }) => void;
    /** The saved start date when editing a contract. */
    savedStartDate?: string;
}

const cleanRoleName = (name: string) => name.replace(/\s*\(L\d+\)$/i, '').trim();

/** "EA L6–L7 · usually salaried" — the role's EA band is guidance; the level is picked in Step 3. */
const roleSubtitle = (r: any): string => [
    formatBand(r) ? `EA ${formatBand(r)}` : 'No EA range',
    r.typically_salaried ? 'usually salaried' : null,
].filter(Boolean).join(' · ');

/** Step 2 — the position: where (organization → department → sub-department), which role, and the access it gives. */
export const Step2Hierarchy: React.FC<Step2HierarchyProps> = ({
    organizations, departments, subDepartments, roles,
    organization_id, department_id, sub_department_id, role_id,
    onOrgChange, onDeptChange, onSubDeptChange, onRoleChange,
    access_level, onAccessChange,
    start_date, end_date, onDatesChange, savedStartDate,
}) => {
    const isOrgSelected = !!organization_id;
    const isDeptSelected = !!department_id;
    const isSubDeptSelected = !!sub_department_id;

    const filteredDepartments = departments.filter(d => d.organization_id === organization_id);
    const filteredSubDepartments = subDepartments.filter(sd => sd.department_id === department_id);

    // Remuneration level is chosen independently in Step 3, so roles are
    // listed by name — no level badge, no level ordering — with their EA band
    // shown as guidance.
    const roleOptions = useMemo(() => roles
        .filter(r => r.sub_department_id === sub_department_id)
        .map(r => ({
            id: r.id as string,
            name: cleanRoleName(r.name),
            subtitle: roleSubtitle(r),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [roles, sub_department_id]);

    const place = {
        organization: organizations.find(o => o.id === organization_id)?.name ?? null,
        department: departments.find(d => d.id === department_id)?.name ?? null,
        subDepartment: subDepartments.find(sd => sd.id === sub_department_id)?.name ?? null,
    };
    const roleName = roles.find(r => r.id === role_id)?.name ?? null;

    return (
        <div className="max-w-md mx-auto w-full space-y-4">
            <div>
                <h3 className={text.heading}>Position</h3>
                <p className={text.bodyMuted}>Where they work, in which role, when, and the access it gives.</p>
            </div>

            <div className="relative z-40">
                <CommandSelector
                    label="Organization"
                    placeholder="Select organization"
                    value={organization_id}
                    options={organizations.map(o => ({ id: o.id, name: o.name }))}
                    onValueChange={onOrgChange}
                    icon={<Building2 className="w-5 h-5 text-muted-foreground" />}
                />
            </div>
            <div className={cn("relative z-30", !isOrgSelected && "opacity-50 pointer-events-none")}>
                <CommandSelector
                    label="Department"
                    placeholder={isOrgSelected ? "Select department" : "Select organization first"}
                    value={department_id}
                    disabled={!isOrgSelected}
                    options={filteredDepartments.map(d => ({ id: d.id, name: d.name }))}
                    onValueChange={onDeptChange}
                    icon={<Users className="w-5 h-5 text-muted-foreground" />}
                />
            </div>
            <div className={cn("relative z-20", !isDeptSelected && "opacity-50 pointer-events-none")}>
                <CommandSelector
                    label="Sub-department"
                    placeholder={isDeptSelected ? "Select sub-department" : "Select department first"}
                    value={sub_department_id}
                    disabled={!isDeptSelected}
                    options={filteredSubDepartments.map(sd => ({ id: sd.id, name: sd.name }))}
                    onValueChange={onSubDeptChange}
                    icon={<ChevronRight className="w-5 h-5 text-muted-foreground" />}
                />
            </div>
            <div className={cn("relative z-10", !isSubDeptSelected && "opacity-50 pointer-events-none")}>
                <CommandSelector
                    label="Role"
                    placeholder={isSubDeptSelected
                        ? (roleOptions.length === 0 ? 'No roles catalogued here' : 'Select role')
                        : 'Select sub-department first'}
                    value={role_id}
                    disabled={!isSubDeptSelected || roleOptions.length === 0}
                    options={roleOptions}
                    onValueChange={onRoleChange}
                    icon={<Briefcase className="w-5 h-5 text-muted-foreground" />}
                />
            </div>

            <ContractDateFields start_date={start_date} end_date={end_date} onChange={onDatesChange} savedStart={savedStartDate} />

            <AccessLevelPicker
                value={access_level}
                onChange={onAccessChange}
                place={place}
                roleLeadsTeam={roleLeadsTeam(roleName)}
            />
        </div>
    );
};

