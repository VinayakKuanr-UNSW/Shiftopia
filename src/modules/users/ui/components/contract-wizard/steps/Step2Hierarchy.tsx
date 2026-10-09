import React, { useMemo } from 'react';
import { Building2, Users, ChevronRight, ChevronDown, Briefcase } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { CommandSelector } from '../../CommandSelector';
import { formatBand } from '../../../../domain/contractPayTerms';

interface RefRow {
    id: string;
    name: string;
    [key: string]: any;
}

export interface Step2HierarchyProps {
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
}

const cleanRoleName = (name: string) => name.replace(/\s*\(L\d+\)$/i, '').trim();

/** "EA L6–L7 · usually salaried" — the role's EA band is guidance; the level is picked in Step 3. */
const roleSubtitle = (r: any): string => [
    formatBand(r) ? `EA ${formatBand(r)}` : 'No EA range',
    r.typically_salaried ? 'usually salaried' : null,
].filter(Boolean).join(' · ');

/** Vertical glow connector, ported verbatim from AddContractDialog.tsx. */
const Connector: React.FC<{ active: boolean }> = ({ active }) => (
    <div className="flex flex-col items-center my-1 select-none">
        <div className={cn(
            "w-0.5 h-4 transition-all duration-500",
            active ? "bg-gradient-to-b from-primary to-primary/60 shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-border",
        )} />
        <div className={cn(
            "w-2 h-2 rounded-full border-2 transition-all duration-500",
            active ? "bg-primary border-primary ring-2 ring-primary/20 scale-110" : "bg-muted border-border",
        )} />
        <div className={cn(
            "w-0.5 h-4 transition-all duration-500",
            active ? "bg-gradient-to-b from-primary/60 to-primary shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-border",
        )} />
    </div>
);

/** Step 2 — Org → Dept → Sub-Dept → Role, the existing glow-connector chain extended one level. */
export const Step2Hierarchy: React.FC<Step2HierarchyProps> = ({
    organizations, departments, subDepartments, roles,
    organization_id, department_id, sub_department_id, role_id,
    onOrgChange, onDeptChange, onSubDeptChange, onRoleChange,
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

    return (
        <div className="max-w-md mx-auto flex flex-col items-center justify-center text-center w-full">
            <div className="mb-3">
                <span className="text-[10px] font-black tracking-[0.25em] uppercase text-primary bg-primary/10 px-3.5 py-1 rounded-full border border-primary/20">
                    Hierarchy Selection
                </span>
            </div>

            <div className="w-full relative z-40 shadow-md">
                <CommandSelector
                    label="Organization"
                    placeholder="Select organization"
                    value={organization_id}
                    options={organizations.map(o => ({ id: o.id, name: o.name }))}
                    onValueChange={onOrgChange}
                    icon={<Building2 className="w-5 h-5 text-primary" />}
                />
            </div>

            <Connector active={isOrgSelected} />

            <div className={cn("w-full transition-all duration-300 relative z-30 shadow-md", !isOrgSelected && "opacity-40 pointer-events-none")}>
                <CommandSelector
                    label="Department"
                    placeholder={isOrgSelected ? "Select department" : "Select organization first"}
                    value={department_id}
                    disabled={!isOrgSelected}
                    options={filteredDepartments.map(d => ({ id: d.id, name: d.name }))}
                    onValueChange={onDeptChange}
                    icon={<Users className="w-5 h-5 text-primary" />}
                />
            </div>

            <Connector active={isDeptSelected} />

            <div className={cn("w-full transition-all duration-300 relative z-20 shadow-md", !isDeptSelected && "opacity-40 pointer-events-none")}>
                <CommandSelector
                    label="Sub-Department"
                    placeholder={isDeptSelected ? "Select sub-department" : "Select department first"}
                    value={sub_department_id}
                    disabled={!isDeptSelected}
                    options={filteredSubDepartments.map(sd => ({ id: sd.id, name: sd.name }))}
                    onValueChange={onSubDeptChange}
                    icon={<ChevronRight className="w-5 h-5 text-primary" />}
                />
            </div>

            {/* Flow Pipe Connector down to the Role picker */}
            <div className="flex flex-col items-center my-1 select-none">
                <div className={cn(
                    "w-0.5 h-6 transition-all duration-500",
                    isSubDeptSelected ? "bg-gradient-to-b from-primary to-primary/60 shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-border",
                )} />
                <div className={cn(
                    "p-1 rounded-full border transition-all duration-500",
                    isSubDeptSelected ? "bg-primary/20 border-primary text-primary shadow-[0_0_15px_rgba(99,102,241,0.6)]" : "border-border text-muted-foreground/40",
                )}>
                    <ChevronDown className="w-3.5 h-3.5" />
                </div>
            </div>

            <div className={cn("w-full transition-all duration-300 relative z-10 shadow-md", !isSubDeptSelected && "opacity-40 pointer-events-none")}>
                <CommandSelector
                    label="Role / Position Title"
                    placeholder={isSubDeptSelected
                        ? (roleOptions.length === 0 ? 'No roles catalogued here' : 'Select role')
                        : 'Select sub-department first'}
                    value={role_id}
                    disabled={!isSubDeptSelected || roleOptions.length === 0}
                    options={roleOptions}
                    onValueChange={onRoleChange}
                    icon={<Briefcase className="w-5 h-5 text-primary" />}
                />
            </div>
        </div>
    );
};

export default Step2Hierarchy;
