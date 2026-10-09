import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { 
    Briefcase, 
    Shield, 
    Trash2, 
    Clock, 
    Building2, 
    ChevronRight, 
    CheckCircle2, 
    AlertCircle,
    User,
    Users,
    Crown,
    Globe,
    Zap,
    Plus,
    Pencil
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AddContractDialog } from './AddContractDialog';
import { ContractWizardDialog } from './contract-wizard/ContractWizardDialog';
import { RemunerationLevelBadge } from './RemunerationLevelBadge';
import { AccessCertificateDialog } from './AddAccessCertificateDialog';
import { useAuth } from '@/platform/auth/useAuth';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import { motion, AnimatePresence } from 'framer-motion';
import { getCasualConversionStatus } from '../../domain/casualConversion';
import { getSwsTrialStatus } from '../../domain/swsTrial';
import { EXCLUSION_REASON_LABELS, type EbaExclusionReason } from '../../domain/contractPayTerms';

interface SectionProps {
    employeeId: string;
    employeeName: string;
}

// =============================================
// 1. User Contracts Section
// =============================================

export const UserContractsSection: React.FC<SectionProps> = ({ employeeId, employeeName }) => {
    const queryClient = useQueryClient();
    const { user: currentUser } = useAuth();
    const isAuthorizedAdmin = currentUser?.highestAccessLevel === 'epsilon';

    const { data: contracts, isLoading } = useQuery({
        queryKey: ['user_contracts', employeeId],
        queryFn: async () => {
            // public.user_contracts is a VIEW over hr.user_contracts (no FK metadata),
            // so embeds fail. Fetch scalar rows, then resolve names in a second pass
            // and re-attach them under the same keys the render expects.
            const { data: rawContracts, error } = await supabase
                .from('user_contracts')
                .select('*')
                .eq('user_id', employeeId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            const rows = (rawContracts ?? []) as any[];

            const roleIds = [...new Set(rows.map(r => r.role_id).filter(Boolean))];
            const orgIds = [...new Set(rows.map(r => r.organization_id).filter(Boolean))];
            const deptIds = [...new Set(rows.map(r => r.department_id).filter(Boolean))];
            const subDeptIds = [...new Set(rows.map(r => r.sub_department_id).filter(Boolean))];

            const [rolesRes, orgsRes, deptsRes, subDeptsRes] = await Promise.all([
                roleIds.length ? supabase.from('roles').select('id, name').in('id', roleIds) : Promise.resolve({ data: [] as any[] }),
                orgIds.length ? supabase.from('organizations').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] as any[] }),
                deptIds.length ? supabase.from('departments').select('id, name').in('id', deptIds) : Promise.resolve({ data: [] as any[] }),
                subDeptIds.length ? supabase.from('sub_departments').select('id, name').in('id', subDeptIds) : Promise.resolve({ data: [] as any[] }),
            ]);
            const roleById = new Map((rolesRes.data ?? []).map((r: any) => [r.id, r]));
            const orgById = new Map((orgsRes.data ?? []).map((o: any) => [o.id, o]));
            const deptById = new Map((deptsRes.data ?? []).map((d: any) => [d.id, d]));
            const subDeptById = new Map((subDeptsRes.data ?? []).map((sd: any) => [sd.id, sd]));

            return rows.map(c => ({
                ...c,
                roles: c.role_id ? roleById.get(c.role_id) ?? null : null,
                organizations: c.organization_id ? orgById.get(c.organization_id) ?? null : null,
                departments: c.department_id ? deptById.get(c.department_id) ?? null : null,
                sub_departments: c.sub_department_id ? subDeptById.get(c.sub_department_id) ?? null : null,
            }));
        },
        enabled: !!employeeId
    });

    /**
     * ONE CARD PER SUB-DEPARTMENT.
     *
     * Not per row, and not per `position_id` either. A person can hold several
     * positions in one sub-department — Full-Time as a Supervisor and Casual as
     * an Usher in Set-up is exactly the arrangement EBA cl 13 (Multi-Hiring)
     * contemplates — and splitting those across cards repeats the organisation,
     * department and sub-department three times to say one thing: where this
     * person works. The sub-department is the place; the roles are what they do
     * there; the employment type belongs to each role, which is why it sits on
     * the role row rather than on the card.
     *
     * Keyed on the full org/dept/sub-dept triple rather than sub-department
     * alone: a null sub-department is a DEPARTMENT-WIDE engagement, and two of
     * those under different departments are different places.
     */
    const scopes = React.useMemo(() => {
        const byScope = new Map<string, any[]>();
        for (const c of contracts ?? []) {
            const key = [c.organization_id ?? '-', c.department_id ?? '-', c.sub_department_id ?? '-'].join('|');
            byScope.set(key, [...(byScope.get(key) ?? []), c]);
        }
        // Roles highest level first, so a card reads as the ladder it covers.
        return [...byScope.entries()].map(([key, rows]) => ({
            key,
            rows: [...rows].sort((a, b) => (b.remuneration_level ?? -1) - (a.remuneration_level ?? -1)),
        }));
    }, [contracts]);

    /**
     * Remove an entire engagement — every role held in that sub-department.
     *
     * There is no per-role delete on the card by design: a role is removed by
     * unticking it in the edit dialog, which is the same control that added it.
     * Two ways to do one thing invites the pair to drift.
     */
    const handleDeleteScope = async (rows: any[], placeName: string) => {
        const ids = rows.map(r => r.id);
        const roleNames = rows.map(r => r.roles?.name ?? 'Unknown role').join(', ');
        if (!confirm(
            `Remove ${employeeName}'s engagement in ${placeName}?\n\n`
            + `This deletes ${ids.length} contract${ids.length === 1 ? '' : 's'}: ${roleNames}.`
        )) return;

        const { error } = await supabase.from('user_contracts').delete().in('id', ids);
        if (error) {
            console.error('Delete error:', error);
            return;
        }
        queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });
    };

    return (
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm shadow-xl rounded-[2rem] overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/10 pb-5 px-6 pt-6">
                <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-primary/10 text-primary shadow-inner">
                        <Briefcase className="w-5 h-5" />
                    </div>
                    Employment Contracts
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border ml-1">
                        {contracts?.length ?? 0} role{(contracts?.length ?? 0) === 1 ? '' : 's'}
                        {scopes.length > 0 && ` across ${scopes.length} sub-department${scopes.length === 1 ? '' : 's'}`}
                    </span>
                </CardTitle>
                {isAuthorizedAdmin && (
                    <ContractWizardDialog
                        employeeId={employeeId}
                        employeeName={employeeName}
                        existingContracts={contracts ?? []}
                        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] })}
                    />
                )}
            </CardHeader>

            <CardContent className="p-6">
                {isLoading ? (
                    <div className="space-y-4">
                        {Array.from({ length: 2 }).map((_, i) => (
                            <div key={i} className="h-44 rounded-2xl bg-muted/20 animate-pulse border border-border" />
                        ))}
                    </div>
                ) : scopes.length === 0 ? (
                    <div className="py-12 flex flex-col items-center text-muted-foreground text-center">
                        <Briefcase className="w-12 h-12 mb-4 opacity-10" />
                        <p className="text-sm font-medium">No contracts configured</p>
                        <p className="text-xs max-w-xs mt-1">Add organizational role contracts to assign departments and positions.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                        {scopes.map(({ key, rows }) => {
                            const head = rows[0];
                            const placeName = head.sub_departments?.name
                                ?? `${head.departments?.name ?? 'Unknown department'} (department-wide)`;
                            const conversion = rows
                                .map((c: any) => getCasualConversionStatus({
                                    employmentStatus: c.employment_status,
                                    contractStatus: c.status,
                                    startDate: c.start_date,
                                }))
                                .find((r: any) => r.eligible);
                            const swsOverrun = rows
                                .map((c: any) => getSwsTrialStatus({
                                    isSws: c.is_sws,
                                    isSwsTrial: c.is_sws_trial,
                                    swsTrialStartDate: c.sws_trial_start_date,
                                }))
                                .find((r: any) => r.overrun);

                            const created = rows
                                .map((c: any) => c.created_at)
                                .filter(Boolean)
                                .sort()[0];
                            const anyActive = rows.some((c: any) => c.status === 'Active');

                            return (
                                <section
                                    key={key}
                                    aria-label={`Engagement in ${placeName}`}
                                    className="rounded-2xl border border-border bg-card p-6 shadow-md backdrop-blur-xl group hover:border-primary/40 transition-all duration-300 relative space-y-5"
                                >
                                    {/* ── Header: Hierarchy Breadcrumb & Admin Actions ── */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1.5 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1.5 text-foreground font-semibold">
                                                    <Building2 className="w-3.5 h-3.5 text-primary" />
                                                    {head.organizations?.name || 'Organisation'}
                                                </span>
                                                <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
                                                <span className="flex items-center gap-1.5 text-foreground font-semibold">
                                                    <Users className="w-3.5 h-3.5 text-primary" />
                                                    {head.departments?.name || 'Department'}
                                                </span>
                                            </div>
                                            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                                                <span>{head.sub_departments?.name ?? 'Department-wide'}</span>
                                            </h3>
                                        </div>

                                        {isAuthorizedAdmin && (
                                            <div className="flex shrink-0 items-center gap-2">
                                                <AddContractDialog
                                                    employeeId={employeeId}
                                                    employeeName={employeeName}
                                                    existingScope={rows}
                                                    existingContracts={contracts ?? []}
                                                    trigger={
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 px-3 rounded-xl border-border bg-background hover:bg-primary/15 hover:text-primary text-xs font-bold transition-all"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5 mr-1.5" />
                                                            Edit
                                                        </Button>
                                                    }
                                                    onSuccess={() => queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] })}
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={`Remove engagement in ${placeName}`}
                                                    onClick={() => handleDeleteScope(rows, placeName)}
                                                    className="h-8 w-8 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                                                >
                                                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>

                                    {/* ── Roles Table ── */}
                                    <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
                                        <table className="w-full border-collapse">
                                            <caption className="sr-only">Roles held in {placeName}</caption>
                                            <thead>
                                                <tr className="border-b border-border bg-muted/40">
                                                    <th scope="col" className="w-14 px-3.5 py-2.5 text-left text-[10px] font-black uppercase tracking-wider text-muted-foreground">Lvl</th>
                                                    <th scope="col" className="px-3.5 py-2.5 text-left text-[10px] font-black uppercase tracking-wider text-muted-foreground">Role</th>
                                                    <th scope="col" className="px-3.5 py-2.5 text-left text-[10px] font-black uppercase tracking-wider text-muted-foreground">Type</th>
                                                    <th scope="col" className="px-3.5 py-2.5 text-right text-[10px] font-black uppercase tracking-wider text-muted-foreground">Hours</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {rows.map((c: any) => {
                                                    const weekly = Number(c.contracted_weekly_hours) || 0;
                                                    const annual = Number(c.annual_guaranteed_hours) || 0;
                                                    const levelNumber = c.remuneration_level != null ? Number(c.remuneration_level) : -1;
                                                    const status = c.employment_status || '';
                                                    const isSalaried = c.pay_basis === 'salary';
                                                    const reason = c.eba_exclusion_reason as EbaExclusionReason | null;

                                                    return (
                                                        <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                                                            <td className="px-3.5 py-2.5">
                                                                {isSalaried ? (
                                                                    <span className="px-2.5 py-1 rounded-lg text-xs font-black border inline-block bg-muted text-foreground border-border">
                                                                        Salary
                                                                    </span>
                                                                ) : (
                                                                    <RemunerationLevelBadge level={levelNumber} />
                                                                )}
                                                            </td>
                                                            <th scope="row" className="px-3.5 py-2.5 text-left font-bold text-sm text-foreground">
                                                                {c.roles?.name || 'Unknown role'}
                                                                {isSalaried && reason && (
                                                                    <span className="block text-[11px] font-normal text-muted-foreground">{EXCLUSION_REASON_LABELS[reason]}</span>
                                                                )}
                                                            </th>
                                                            <td className="px-3.5 py-2.5">
                                                                <span className={cn(
                                                                    "px-2 py-0.5 rounded-lg text-[11px] font-bold border inline-block",
                                                                    status === 'Full-Time' ? "bg-primary/15 text-primary border-primary/30" :
                                                                    status === 'Part-Time' ? "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30" :
                                                                    status === 'Flexible Part-Time' ? "bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30" :
                                                                    "bg-muted text-muted-foreground border-border"
                                                                )}>
                                                                    {status || '—'}
                                                                </span>
                                                                {c.engagement_kind === 'multi_hire' && (
                                                                    <span
                                                                        className="ml-1.5 px-2 py-0.5 rounded-lg text-[11px] font-bold border inline-block bg-muted text-muted-foreground border-border"
                                                                        title={c.multi_hire_request_ref ? `Request to Multi-Hire: ${c.multi_hire_request_ref}` : undefined}
                                                                    >
                                                                        Multi-hire · cl 13
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-3.5 py-2.5 text-right font-mono font-bold text-xs text-foreground">
                                                                {weekly > 0 ? `${weekly} h/wk`
                                                                    : annual > 0 ? `${annual} h/yr`
                                                                        : <span className="text-muted-foreground/40 font-normal">—</span>}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* ── Footer Tags ── */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className={cn(
                                                "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1.5",
                                                anyActive 
                                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" 
                                                    : "bg-muted text-muted-foreground border-border"
                                            )}>
                                                <span className={cn("w-1.5 h-1.5 rounded-full", anyActive ? "bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-muted-foreground/40")} />
                                                {anyActive ? 'Active' : (head.status ?? 'Inactive')}
                                            </span>
                                            <span className="text-muted-foreground text-[11px]">
                                                Created {created ? format(parseISO(created), 'd MMM yyyy') : '—'}
                                            </span>
                                        </div>

                                        {conversion && (
                                            <span className="px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-semibold">
                                                Conversion eligible ({conversion.tenureMonths} mo)
                                            </span>
                                        )}
                                        {swsOverrun && (
                                            <span className="px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-semibold">
                                                SWS trial overrun ({swsOverrun.weeksElapsed} wks)
                                            </span>
                                        )}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};


// =============================================
// 2. Access Certificates Section
// =============================================

export const AccessCertificatesSection: React.FC<SectionProps> = ({ employeeId, employeeName }) => {
    const queryClient = useQueryClient();
    const { user: currentUser } = useAuth();
    const isAuthorizedAdmin = currentUser?.highestAccessLevel === 'epsilon';

    const { data: certificates, isLoading } = useQuery({
        queryKey: ['access_certificates', employeeId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('app_access_certificates')
                .select(`
                    *,
                    organizations(name),
                    departments(name),
                    sub_departments(name)
                `)
                .eq('user_id', employeeId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
        enabled: !!employeeId
    });

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to revoke this certificate?')) return;
        
        const { error } = await supabase
            .from('app_access_certificates')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Revoke error:', error);
            return;
        }

        queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] });
    };

    const getIcon = (level: string) => {
        switch (level?.toLowerCase()) {
            case 'epsilon': return <Globe className="w-5 h-5 text-emerald-400" />;
            case 'delta': return <Crown className="w-5 h-5 text-amber-400" />;
            case 'gamma': return <Building2 className="w-5 h-5 text-purple-400" />;
            case 'beta': return <Shield className="w-5 h-5 text-blue-400" />;
            default: return <User className="w-5 h-5 text-slate-400" />;
        }
    };

    return (
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm shadow-xl rounded-[2rem] overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/10 pb-6">
                <div>
                    <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 shadow-inner">
                            <Shield className="w-5 h-5" />
                        </div>
                        System Access Certificates
                    </CardTitle>
                </div>
                {isAuthorizedAdmin && (
                    <AccessCertificateDialog 
                        employeeId={employeeId} 
                        employeeName={employeeName} 
                        existingCertificates={certificates || []}
                        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] })}
                    />
                )}
            </CardHeader>
            <CardContent className="p-6">
                <div className="space-y-4">
                    {isLoading ? (
                        <div className="space-y-4">
                            <div className="h-20 rounded-2xl bg-muted/20 animate-pulse" />
                            <div className="h-20 rounded-2xl bg-muted/20 animate-pulse" />
                        </div>
                    ) : !certificates || certificates.length === 0 ? (
                        <div className="py-12 flex flex-col items-center text-muted-foreground text-center">
                            <Shield className="w-12 h-12 mb-4 opacity-10" />
                            <p className="text-sm font-medium">No access certificates issued</p>
                            <p className="text-xs max-w-xs mt-1">Access certificates determine data visibility and administrative permissions.</p>
                        </div>
                    ) : (
                        certificates.map((cert) => (
                            <motion.div
                                key={cert.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className={cn(
                                    "group p-5 rounded-2xl border transition-all duration-300 flex items-center gap-6",
                                    cert.is_active !== false 
                                        ? "border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40" 
                                        : "border-border/40 bg-muted/10 grayscale opacity-60"
                                )}
                            >
                                <div className="p-3 rounded-xl bg-card border border-border/40 shadow-sm">
                                    {getIcon(cert.access_level)}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 mb-1">
                                        <h4 className="font-black uppercase tracking-tight text-foreground">
                                            {cert.access_level} Access
                                        </h4>
                                        <Badge variant="outline" className={cn(
                                            "rounded-lg px-2 py-0 h-5 text-[10px] font-black uppercase tracking-wider",
                                            cert.certificate_type === 'Y' 
                                                ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                                                : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                        )}>
                                            Type {cert.certificate_type}
                                        </Badge>
                                        {cert.is_active === false && (
                                            <Badge variant="destructive" className="rounded-lg h-5 text-[10px]">Inactive</Badge>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground font-medium">
                                        <div className="flex items-center gap-1.5">
                                            <Building2 className="w-3.5 h-3.5 opacity-40" />
                                            {cert.organizations?.name || 'Global'}
                                        </div>
                                        {cert.departments?.name && (
                                            <>
                                                <ChevronRight className="w-3 h-3 opacity-20" />
                                                <span>{cert.departments.name}</span>
                                            </>
                                        )}
                                        {cert.sub_departments?.name && (
                                            <>
                                                <ChevronRight className="w-3 h-3 opacity-20" />
                                                <span>{cert.sub_departments.name}</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-1">
                                    {isAuthorizedAdmin && (
                                        <>
                                            <AccessCertificateDialog 
                                                employeeId={employeeId} 
                                                employeeName={employeeName} 
                                                existingCertificates={certificates || []}
                                                certificateToEdit={cert}
                                                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] })}
                                                trigger={
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-muted-foreground hover:text-primary transition-all"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                }
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDelete(cert.id)}
                                                className="text-muted-foreground hover:text-destructive transition-all"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </>
                                    )}
                                    <div className={cn(
                                        "w-2.5 h-2.5 rounded-full ml-2",
                                        cert.is_active !== false ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-muted-foreground/30"
                                    )} />
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>

                <div className="mt-8 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 flex gap-4">
                    <div className="p-2 rounded-xl bg-amber-500/10 h-fit">
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-xs font-bold text-amber-500 uppercase tracking-widest">Security Protocol</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            Access certificates define the organizational boundaries of user data. Type Y certificates provide managerial scope, while Type X certificates are restricted to individual employee data access.
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
