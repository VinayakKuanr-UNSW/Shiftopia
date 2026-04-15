import React from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
import { Button } from '@/modules/core/ui/primitives/button';
import { Briefcase, Trash2, Shield, User, Users, Building2, Crown, Globe, Pencil } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { AddContractDialog } from './AddContractDialog';
import { AccessCertificateDialog } from './AddAccessCertificateDialog';

interface SectionProps {
    employeeId: string;
    employeeName?: string;
}

interface Contract {
    id: string;
    organization_name?: string;
    department_name?: string;
    sub_department_name?: string;
    role_name?: string;
    level_name?: string;
    employment_status?: string;
}

interface AccessCertificate {
    id: string;
    access_level: string;
    organization_id?: string;
    department_id?: string;
    sub_department_id?: string;
    organization_name?: string;
    department_name?: string;
    sub_department_name?: string;
}

const ACCESS_LEVEL_STYLES: Record<string, { color: string }> = {
    alpha: { color: 'bg-muted/50 text-muted-foreground border border-border' },
    beta: { color: 'bg-primary/10 text-primary border border-primary/20' },
    gamma: { color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20' },
    delta: { color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' },
    epsilon: { color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' },
};

const AccessIcon = ({ level }: { level: string }) => {
    switch (level.toLowerCase()) {
        case 'alpha': return <User className="w-3 h-3 mr-1.5" />;
        case 'beta': return <Users className="w-3 h-3 mr-1.5" />;
        case 'gamma': return <Building2 className="w-3 h-3 mr-1.5" />;
        case 'delta': return <Crown className="w-3 h-3 mr-1.5" />;
        case 'epsilon': return <Globe className="w-3 h-3 mr-1.5" />;
        default: return <Shield className="w-3 h-3 mr-1.5" />;
    }
}

export const UserContractsSection: React.FC<SectionProps> = ({ employeeId, employeeName = 'User' }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: contracts, isLoading: isLoadingContracts } = useQuery({
        queryKey: ['user_contracts', employeeId],
        queryFn: async () => {
            const { data, error } = await (supabase as any)
                .from('user_contracts')
                .select(`
          *,
          organization:organizations(name),
          department:departments(name),
          sub_department:sub_departments(name),
          role:roles(name),
          rem_level:remuneration_levels!user_contracts_rem_level_id_fkey(level_name)
        `)
                .eq('user_id', employeeId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            return (data || []).map((c: any) => ({
                ...c,
                organization_name: c.organization?.name,
                department_name: c.department?.name,
                sub_department_name: c.sub_department?.name,
                role_name: c.role?.name,
                level_name: c.rem_level?.level_name,
            })) as Contract[];
        },
        enabled: !!employeeId,
    });

    const handleDeleteContract = async (contractId: string) => {
        if (!confirm('Are you sure you want to delete this contract?')) return;

        try {
            const { error } = await (supabase as any).from('user_contracts').delete().eq('id', contractId);
            if (error) throw error;
            toast({ title: 'Success', description: 'Contract deleted' });
            queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });
        } catch (error) {
            console.error('Error deleting contract:', error);
            toast({ title: 'Error', description: 'Failed to delete contract', variant: 'destructive' });
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col h-full">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900 flex items-center justify-between">
                <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-slate-500" />
                        User Contracts
                    </h3>
                    <p className="text-[10px] text-slate-400 font-medium pl-6 uppercase tracking-wider">
                        HR & Employment Contract Details
                    </p>
                </div>
                <AddContractDialog employeeId={employeeId} employeeName={employeeName} />
            </div>
            <div>
                {isLoadingContracts ? (
                    <div className="p-8 text-center text-sm text-slate-400 animate-pulse">Loading contracts...</div>
                ) : !contracts || contracts.length === 0 ? (
                    <div className="p-8 text-center text-sm font-medium text-slate-400">
                        No active contracts recorded.
                    </div>
                ) : (
                    <>
                        {/* Mobile: card layout */}
                        <div className="block md:hidden space-y-3 p-3">
                            {contracts.map(contract => (
                                <div key={contract.id} className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2.5">
                                    {/* Top row: role + status badge */}
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">
                                                {contract.role_name || '—'}
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                                {contract.sub_department_name || contract.department_name || '—'}
                                            </p>
                                        </div>
                                        <Badge variant="secondary" className="shrink-0 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-none font-medium text-xs">
                                            {contract.employment_status || 'Full-Time'}
                                        </Badge>
                                    </div>
                                    {/* Detail pills: org + department + level */}
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                        {contract.organization_name && (
                                            <span className="font-semibold text-slate-700 dark:text-slate-300">{contract.organization_name}</span>
                                        )}
                                        {contract.department_name && (
                                            <span>{contract.department_name}</span>
                                        )}
                                        {contract.level_name && (
                                            <span className="text-slate-600 dark:text-slate-300 font-medium">{contract.level_name}</span>
                                        )}
                                    </div>
                                    {/* Action buttons */}
                                    <div className="flex gap-2 pt-1">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDeleteContract(contract.id)}
                                            className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 px-3 gap-1.5 text-xs border border-transparent shadow-none"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Desktop: table */}
                        <div className="hidden md:block overflow-x-auto">
                            <Table className="px-4">
                                <TableHeader className="bg-slate-50/50 dark:bg-slate-900/50">
                                    <TableRow className="border-b-slate-100 dark:border-b-slate-800/60">
                                        <TableHead className="text-xs text-slate-500 font-semibold h-10">Organization</TableHead>
                                        <TableHead className="text-xs text-slate-500 font-semibold h-10">Department</TableHead>
                                        <TableHead className="text-xs text-slate-500 font-semibold h-10">Sub-Department</TableHead>
                                        <TableHead className="text-xs text-slate-500 font-semibold h-10">Role</TableHead>
                                        <TableHead className="text-xs text-slate-500 font-semibold h-10">Level</TableHead>
                                        <TableHead className="text-xs text-slate-500 font-semibold h-10">Status</TableHead>
                                        <TableHead className="text-xs text-slate-500 font-semibold h-10 text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {contracts.map(contract => (
                                        <TableRow key={contract.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b-slate-100 dark:border-b-slate-800/60">
                                            <TableCell className="font-semibold text-sm text-slate-800 dark:text-slate-200">{contract.organization_name}</TableCell>
                                            <TableCell className="text-sm text-slate-600 dark:text-slate-400">{contract.department_name}</TableCell>
                                            <TableCell className="text-sm text-slate-600 dark:text-slate-400">{contract.sub_department_name}</TableCell>
                                            <TableCell className="text-sm text-slate-600 dark:text-slate-400">{contract.role_name}</TableCell>
                                            <TableCell className="text-sm text-slate-600 dark:text-slate-400">{contract.level_name}</TableCell>
                                            <TableCell>
                                                <Badge variant="secondary" className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-none font-medium text-xs">
                                                    {contract.employment_status || 'Full-Time'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm" onClick={() => handleDeleteContract(contract.id)} className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 h-10 w-10 p-0 border border-transparent shadow-none">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export const AccessCertificatesSection: React.FC<SectionProps> = ({ employeeId, employeeName = 'User' }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: certificates, isLoading: isLoadingCerts } = useQuery({
        queryKey: ['access_certificates', employeeId],
        queryFn: async () => {
            const { data, error } = await (supabase as any)
                .from('app_access_certificates')
                .select(`
                    *,
                    organization:organizations(name),
                    department:departments(name),
                    sub_department:sub_departments(name)
                `)
                .eq('user_id', employeeId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            return (data || []).map((c: any) => ({
                ...c,
                organization_name: c.organization?.name,
                department_name: c.department?.name,
                sub_department_name: c.sub_department?.name,
            })) as AccessCertificate[];
        },
        enabled: !!employeeId,
    });

    const handleDeleteCertificate = async (certId: string) => {
        if (certificates && certificates.length <= 1) {
            toast({
                title: 'Cannot Revoke Access',
                description: 'User must have at least one access certificate. Please add a new one before removing this.',
                variant: 'destructive'
            });
            return;
        }

        if (!confirm('Are you sure you want to revoke this access certificate?')) return;

        try {
            const { error } = await (supabase as any).from('app_access_certificates').delete().eq('id', certId);
            if (error) throw error;
            toast({ title: 'Success', description: 'Access revoked' });
            queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] });
            queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });
        } catch (error) {
            console.error('Error deleting certificate:', error);
            toast({ title: 'Error', description: 'Failed to revoke access', variant: 'destructive' });
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col h-full">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900 flex items-center justify-between">
                <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-slate-500" />
                        Access Certificates
                    </h3>
                    <p className="text-[10px] text-slate-400 font-medium pl-6 uppercase tracking-wider">
                        System Permissions & Scope
                    </p>
                </div>
                <AccessCertificateDialog
                    employeeId={employeeId}
                    employeeName={employeeName}
                    existingCertificates={certificates || []}
                    onSuccess={() => {
                        queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] });
                    }}
                />
            </div>
            <div>
                {isLoadingCerts ? (
                    <div className="p-8 text-center text-sm text-slate-400 animate-pulse">Loading certificates...</div>
                ) : !certificates || certificates.length === 0 ? (
                    <div className="p-8 text-center text-sm font-medium text-slate-400">
                        No access certificates. User has no system access.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table className="px-4">
                            <TableHeader className="bg-slate-50/50 dark:bg-slate-900/50">
                                <TableRow className="border-b-slate-100 dark:border-b-slate-800/60">
                                    <TableHead className="text-xs text-slate-500 font-semibold h-10">Access Level</TableHead>
                                    <TableHead className="text-xs text-slate-500 font-semibold h-10">Scope</TableHead>
                                    <TableHead className="text-xs text-slate-500 font-semibold h-10 text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {certificates.map(cert => (
                                    <TableRow key={cert.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b-slate-100 dark:border-b-slate-800/60">
                                        <TableCell>
                                            <Badge className={`pl-1.5 flex w-fit items-center font-medium text-[10px] tracking-wider uppercase rounded-[4px] py-1 ${ACCESS_LEVEL_STYLES[cert.access_level]?.color || ACCESS_LEVEL_STYLES.alpha.color}`}>
                                                <AccessIcon level={cert.access_level} />
                                                {cert.access_level}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm font-medium text-slate-500 dark:text-slate-400">
                                            <span className="text-slate-800 dark:text-slate-200">{cert.organization_name}</span>
                                            {cert.department_name ? (
                                                <> <span className="opacity-40">/</span> {cert.department_name}</>
                                            ) : cert.access_level === 'epsilon' ? (
                                                <span className="text-emerald-600 dark:text-emerald-400 ml-2 font-bold text-[9px] uppercase tracking-wide border border-emerald-500/20 px-1.5 py-0.5 rounded bg-emerald-500/10">Global</span>
                                            ) : null}
                                            {cert.sub_department_name ? (
                                                <> <span className="opacity-40">/</span> {cert.sub_department_name}</>
                                            ) : (
                                                cert.department_name && ['delta'].includes(cert.access_level) ? (
                                                    <span className="text-amber-600 dark:text-amber-400 ml-2 font-bold text-[9px] uppercase tracking-wide border border-amber-500/20 px-1.5 py-0.5 rounded bg-amber-500/10">Full Dept</span>
                                                ) : null
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <AccessCertificateDialog
                                                    employeeId={employeeId}
                                                    employeeName={employeeName}
                                                    existingCertificates={certificates || []}
                                                    certificateToEdit={cert}
                                                    trigger={
                                                        <Button variant="ghost" size="sm" className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 h-10 w-10 p-0 border border-transparent shadow-none">
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </Button>
                                                    }
                                                    onSuccess={() => {
                                                        queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] });
                                                    }}
                                                />
                                                <Button variant="ghost" size="sm" onClick={() => handleDeleteCertificate(cert.id)} className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 h-10 w-10 p-0 border border-transparent shadow-none">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>
        </div>
    );
};

const ContractsSection: React.FC<SectionProps> = (props) => {
    return (
        <div className="space-y-6">
            <UserContractsSection {...props} />
            <AccessCertificatesSection {...props} />
        </div>
    );
};

export default ContractsSection;
