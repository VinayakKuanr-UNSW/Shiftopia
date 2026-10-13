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
     * ONE TABLE, ONE ROW PER CONTRACT.
     *
     * A contract is one role in one place, and a person holds a role in a place
     * at most once (contractPlacement.ts). They can hold several roles in one
     * sub-department — Full-Time as a Supervisor and Casual as an Usher in
     * Set-up is what EBA cl 13 (Multi-Hiring) contemplates — each its own
     * contract, added, edited and removed on its own row. Rows are grouped by
     * place so a person's roles in one sub-department sit together.
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
        // Roles highest level first within a place, so it reads as the ladder it covers.
        return [...byScope.entries()].map(([key, rows]) => ({
            key,
            rows: [...rows].sort((a, b) => (b.remuneration_level ?? -1) - (a.remuneration_level ?? -1)),
        }));
    }, [contracts]);

    const tableRows = React.useMemo(() => scopes.flatMap((s) => s.rows), [scopes]);

    /** Remove one contract. Its other roles in the same place are untouched. */
    const handleDeleteContract = async (c: any, placeName: string) => {
        const roleName = c.roles?.name ?? 'Unknown role';
        if (!confirm(`Remove ${employeeName}'s ${roleName} contract in ${placeName}?`)) return;

        const { error } = await supabase.from('user_contracts').delete().eq('id', c.id);
        if (error) {
            console.error('Delete error:', error);
            // 23503: a pay record still points at the contract — today, its
            // time-in-lieu ledger, which must be kept (Fair Work record rules).
            alert(error.code === '23503'
                ? `The ${roleName} contract has time-in-lieu records, which must be kept, so it can't be deleted. Ask an administrator to end it (give it an end date) instead — any banked time in lieu is then paid out.`
                : `The contract could not be removed: ${error.message}`);
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
                        {contracts?.length ?? 0} contract{(contracts?.length ?? 0) === 1 ? '' : 's'}
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
                    <div className="rounded-xl border border-border overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <caption className="sr-only">Employment contracts for {employeeName}</caption>
                            <thead>
                                <tr className="border-b border-border bg-muted/40">
                                    {['Place', 'Lvl', 'Role', 'Type', 'Hours', 'Status', 'Created'].map((h) => (
                                        <th
                                            key={h}
                                            scope="col"
                                            className={cn(
                                                "px-4 py-3 text-[10px] font-black uppercase tracking-wider text-muted-foreground whitespace-nowrap",
                                                h === 'Hours' ? 'text-right' : 'text-left'
                                            )}
                                        >
                                            {h}
                                        </th>
                                    ))}
                                    {isAuthorizedAdmin && (
                                        <th scope="col" className="w-24 px-4 py-3"><span className="sr-only">Actions</span></th>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {tableRows.map((c: any) => {
                                    const weekly = Number(c.contracted_weekly_hours) || 0;
                                    const annual = Number(c.annual_guaranteed_hours) || 0;
                                    const levelNumber = c.remuneration_level != null ? Number(c.remuneration_level) : -1;
                                    const status = c.employment_status || '';
                                    const isSalaried = c.pay_basis === 'salary';
                                    const reason = c.eba_exclusion_reason as EbaExclusionReason | null;
                                    const isActive = c.status === 'Active';
                                    const placeName = c.sub_departments?.name
                                        ?? `${c.departments?.name ?? 'Unknown department'} (department-wide)`;
                                    const conversion = getCasualConversionStatus({
                                        employmentStatus: c.employment_status,
                                        contractStatus: c.status,
                                        startDate: c.start_date,
                                    });
                                    const sws = getSwsTrialStatus({
                                        isSws: c.is_sws,
                                        isSwsTrial: c.is_sws_trial,
                                        swsTrialStartDate: c.sws_trial_start_date,
                                    });

                                    return (
                                        <tr key={c.id} className="hover:bg-muted/30 transition-colors align-middle">
                                            <td className="px-4 py-3 min-w-[16rem]">
                                                <div className="flex items-center gap-1.5 text-xs font-medium flex-wrap">
                                                    <Building2 className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" aria-hidden="true" />
                                                    <span className="text-muted-foreground">{c.organizations?.name || 'Organisation'}</span>
                                                    <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" aria-hidden="true" />
                                                    <span className="text-muted-foreground">{c.departments?.name || 'Department'}</span>
                                                    <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" aria-hidden="true" />
                                                    <span className="text-foreground font-semibold">
                                                        {c.sub_departments?.name ?? 'Department-wide'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {isSalaried ? (
                                                    <span className="px-2.5 py-1 rounded-lg text-xs font-black border inline-block bg-muted text-foreground border-border">
                                                        Salary
                                                    </span>
                                                ) : (
                                                    <RemunerationLevelBadge level={levelNumber} />
                                                )}
                                            </td>
                                            <th scope="row" className="px-4 py-3 text-left font-bold text-foreground min-w-[10rem]">
                                                {c.roles?.name || 'Unknown role'}
                                                {isSalaried && reason && (
                                                    <span className="block text-[11px] font-normal text-muted-foreground">{EXCLUSION_REASON_LABELS[reason]}</span>
                                                )}
                                            </th>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className={cn(
                                                        "px-2 py-0.5 rounded-lg text-[11px] font-bold border whitespace-nowrap",
                                                        status === 'Full-Time' ? "bg-primary/15 text-primary border-primary/30" :
                                                        status === 'Part-Time' ? "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30" :
                                                        status === 'Flexible Part-Time' ? "bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30" :
                                                        "bg-muted text-muted-foreground border-border"
                                                    )}>
                                                        {status || '—'}
                                                    </span>
                                                    {c.engagement_kind === 'multi_hire' && (
                                                        <span
                                                            className="px-2 py-0.5 rounded-lg text-[11px] font-bold border whitespace-nowrap bg-muted text-muted-foreground border-border"
                                                            title={c.multi_hire_request_ref ? `Request to Multi-Hire: ${c.multi_hire_request_ref}` : undefined}
                                                        >
                                                            Multi-hire · cl 13
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-xs text-foreground whitespace-nowrap">
                                                {weekly > 0 ? `${weekly} h/wk`
                                                    : annual > 0 ? `${annual} h/yr`
                                                        : <span className="text-muted-foreground/40 font-normal">—</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className={cn(
                                                        "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border inline-flex items-center gap-1.5 whitespace-nowrap",
                                                        isActive
                                                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                                            : "bg-muted text-muted-foreground border-border"
                                                    )}>
                                                        <span className={cn("w-1.5 h-1.5 rounded-full", isActive ? "bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-muted-foreground/40")} />
                                                        {c.status ?? 'Inactive'}
                                                    </span>
                                                    {conversion.eligible && (
                                                        <span className="px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-semibold whitespace-nowrap">
                                                            Conversion eligible ({conversion.tenureMonths} mo)
                                                        </span>
                                                    )}
                                                    {sws.overrun && (
                                                        <span className="px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-semibold whitespace-nowrap">
                                                            SWS trial overrun ({sws.weeksElapsed} wks)
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                                {c.created_at ? format(parseISO(c.created_at), 'd MMM yyyy') : '—'}
                                            </td>
                                            {isAuthorizedAdmin && (
                                                <td className="px-2 py-1.5">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <ContractWizardDialog
                                                            employeeId={employeeId}
                                                            employeeName={employeeName}
                                                            existingContract={c}
                                                            existingContracts={contracts ?? []}
                                                            trigger={
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    aria-label={`Edit ${c.roles?.name ?? 'role'} contract`}
                                                                    className="h-11 w-11 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                                >
                                                                    <Pencil className="w-4 h-4" aria-hidden="true" />
                                                                </Button>
                                                            }
                                                            onSuccess={() => queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] })}
                                                        />
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label={`Remove ${c.roles?.name ?? 'role'} contract`}
                                                            onClick={() => handleDeleteContract(c, placeName)}
                                                            className="h-11 w-11 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                        >
                                                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                                                        </Button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
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

    /**
     * Revoking deactivates the certificate; it is never deleted, so
     * access_certificate_events keeps the whole history. When the caller may
     * not change this certificate (an epsilon revoking another epsilon) the
     * policy matches no row instead of erroring, hence the empty-result check.
     */
    const handleRevoke = async (cert: { id: string; access_level: string }) => {
        if (!confirm(`Revoke ${employeeName}'s ${cert.access_level} access?`)) return;

        const { data, error } = await supabase
            .from('app_access_certificates')
            .update({ is_active: false })
            .eq('id', cert.id)
            .select('id');

        if (error || !data?.length) {
            console.error('Revoke error:', error);
            alert(error?.message?.includes('last active zeta')
                ? 'This is the last zeta certificate, so it cannot be revoked. Grant zeta to someone else first.'
                : error?.message ?? 'You are not allowed to revoke this certificate.');
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
                                            {cert.is_active !== false && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={`Revoke ${cert.access_level} access`}
                                                    title="Revoke access"
                                                    onClick={() => handleRevoke(cert)}
                                                    className="text-muted-foreground hover:text-destructive transition-all"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
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
