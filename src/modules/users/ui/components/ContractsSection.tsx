import React from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
import { Button } from '@/modules/core/ui/primitives/button';
import { Briefcase, Trash2, Shield, User, Users, Building2, Crown, Globe, Pencil } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { AddContractDialog } from './AddContractDialog';
import { AccessCertificateDialog } from './AddAccessCertificateDialog';

interface ContractsSectionProps {
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

const ContractsSection: React.FC<ContractsSectionProps> = ({ employeeId, employeeName = 'User' }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // 1. Fetch HR Contracts
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

    // 2. Fetch Access Certificates
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
            // Also invalidate profile/contracts to refresh derived auth state
            queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });
        } catch (error) {
            console.error('Error deleting certificate:', error);
            toast({ title: 'Error', description: 'Failed to revoke access', variant: 'destructive' });
        }
    };

    return (
        <div className="space-y-6">
            {/* Position Contracts Section */}
            <Card className="border border-border bg-card">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2">
                            <Briefcase className="w-5 h-5" />
                            Position Contracts
                        </CardTitle>
                        <CardDescription>
                            HR & Employment Position Details
                        </CardDescription>
                    </div>
                    <AddContractDialog employeeId={employeeId} employeeName={employeeName} />
                </CardHeader>
                <CardContent className="p-0">
                    {isLoadingContracts ? (
                        <div className="p-6 text-sm text-muted-foreground">Loading contracts...</div>
                    ) : !contracts || contracts.length === 0 ? (
                        <div className="p-6 text-center text-sm text-muted-foreground">
                            No active positions.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Organization</TableHead>
                                        <TableHead>Department</TableHead>
                                        <TableHead>Sub-Department</TableHead>
                                        <TableHead>Role</TableHead>
                                        <TableHead>Level</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {contracts.map(contract => (
                                        <TableRow key={contract.id} className="hover:bg-muted/50 transition-colors">
                                            <TableCell className="font-medium">{contract.organization_name}</TableCell>
                                            <TableCell>{contract.department_name}</TableCell>
                                            <TableCell>{contract.sub_department_name}</TableCell>
                                            <TableCell>{contract.role_name}</TableCell>
                                            <TableCell>{contract.level_name}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border">
                                                    {contract.employment_status || 'Full-Time'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm" onClick={() => handleDeleteContract(contract.id)} className="text-muted-foreground hover:text-destructive h-8 w-8 p-0">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Access Certificates Section */}
            <Card className="border border-border bg-card">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="w-5 h-5" />
                            Access Certificates
                        </CardTitle>
                        <CardDescription>
                            System Permissions & Scope
                        </CardDescription>
                    </div>
                    {/* Add Certificate Dialog */}
                    <AccessCertificateDialog
                        employeeId={employeeId}
                        employeeName={employeeName}
                        existingCertificates={certificates || []}
                        onSuccess={() => {
                            queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] });
                        }}
                    />
                </CardHeader>
                <CardContent className="p-0">
                    {isLoadingCerts ? (
                        <div className="p-6 text-sm text-muted-foreground">Loading certificates...</div>
                    ) : !certificates || certificates.length === 0 ? (
                        <div className="p-6 text-center text-sm text-muted-foreground">
                            No access certificates. User has no system access.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Access Level</TableHead>
                                        <TableHead>Scope</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {certificates.map(cert => (
                                        <TableRow key={cert.id} className="hover:bg-muted/50 transition-colors">
                                            <TableCell>
                                                <Badge className={`pl-1.5 flex w-fit items-center ${ACCESS_LEVEL_STYLES[cert.access_level]?.color || ACCESS_LEVEL_STYLES.alpha.color}`}>
                                                    <AccessIcon level={cert.access_level} />
                                                    {cert.access_level}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-sm font-light text-muted-foreground">
                                                {/* Smart Scope Display */}
                                                <span className="text-foreground font-medium">{cert.organization_name}</span>
                                                {cert.department_name ? (
                                                    <> <span className="text-muted-foreground/40">/</span> {cert.department_name}</>
                                                ) : cert.access_level === 'epsilon' ? (
                                                    <span className="text-emerald-500/60 ml-2 italic text-xs border border-emerald-500/20 px-1.5 py-0.5 rounded bg-emerald-500/5">Global</span>
                                                ) : null}

                                                {cert.sub_department_name ? (
                                                    <> <span className="text-muted-foreground/40">/</span> {cert.sub_department_name}</>
                                                ) : (
                                                    cert.department_name && ['delta'].includes(cert.access_level) ? (
                                                        <span className="text-amber-500/60 ml-2 italic text-xs border border-amber-500/20 px-1.5 py-0.5 rounded bg-amber-500/5">Full Dept</span>
                                                    ) : null
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    {/* Edit Dialog */}
                                                    <AccessCertificateDialog
                                                        employeeId={employeeId}
                                                        employeeName={employeeName}
                                                        existingCertificates={certificates || []}
                                                        certificateToEdit={cert}
                                                        trigger={
                                                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary h-8 w-8 p-0">
                                                                <Pencil className="w-4 h-4" />
                                                            </Button>
                                                        }
                                                        onSuccess={() => {
                                                            queryClient.invalidateQueries({ queryKey: ['access_certificates', employeeId] });
                                                        }}
                                                    />
                                                    <Button variant="ghost" size="sm" onClick={() => handleDeleteCertificate(cert.id)} className="text-muted-foreground hover:text-destructive h-8 w-8 p-0">
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ContractsSection;
