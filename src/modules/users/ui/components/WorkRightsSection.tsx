import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Label } from '@/modules/core/ui/primitives/label';
import { useEmployeeLicenses, useRemoveEmployeeLicense } from '@/modules/users/hooks/useEmployeeLicenses';
import { Shield, CheckCircle, XCircle, AlertTriangle, AlertOctagon, Loader2, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AddLicenseDialog } from './AddLicenseDialog';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useQueryClient } from '@tanstack/react-query';

interface WorkRightsSectionProps {
    employeeId: string;
    employeeName?: string;
}

const WorkRightsSection: React.FC<WorkRightsSectionProps> = ({ employeeId, employeeName = 'User' }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isToggling, setIsToggling] = useState(false);

    const { data: workRights, isLoading } = useEmployeeLicenses(employeeId, {
        filter: { license_type: 'WorkRights' }
    });
    const { mutate: removeLicense } = useRemoveEmployeeLicense();

    const workRight = workRights?.[0]; // Assuming one work rights entry per employee
    const isStudentVisa = workRight?.license?.name?.includes('Subclass 500');

    const handleToggleWorkLimit = async (checked: boolean) => {
        if (!workRight) return;

        setIsToggling(true);
        try {
            const { error } = await supabase
                .from('employee_licenses')
                .update({ has_restricted_work_limit: checked })
                .eq('id', workRight.id);

            if (error) throw error;

            queryClient.invalidateQueries({ queryKey: ['employee_licenses', employeeId] });
            toast({
                title: checked ? 'Restrictions Applied' : 'Restrictions Removed',
                description: checked ? 'Work hours limited to 48h per fortnight.' : 'Work hour restrictions removed.'
            });
        } catch (error) {
            console.error('Error updating work limit:', error);
            toast({ title: 'Error', description: 'Failed to update work limit settings', variant: 'destructive' });
        } finally {
            setIsToggling(false);
        }
    };

    const handleDelete = async () => {
        if (!workRight || !confirm('Are you sure you want to remove this work right record?')) return;
        removeLicense({ id: workRight.id, employeeId });
    };

    const getVerificationBadge = () => {
        if (!workRight) return null;

        switch (workRight.verification_status) {
            case 'Verified':
                return (
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                        <CheckCircle className="w-5 h-5" />
                        <div>
                            <p className="font-medium">VEVO Verified</p>
                            {workRight.last_checked_at && (
                                <p className="text-xs text-muted-foreground">
                                    Last checked: {format(parseISO(workRight.last_checked_at), 'MMM d, yyyy HH:mm')}
                                </p>
                            )}
                        </div>
                    </div>
                );
            case 'Failed':
                return (
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                        <XCircle className="w-5 h-5" />
                        <p className="font-medium">Verification Failed</p>
                    </div>
                );
            case 'Expired':
                return (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-5 h-5" />
                        <p className="font-medium">Verification Expired</p>
                    </div>
                );
            default:
                return (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <AlertTriangle className="w-5 h-5" />
                        <p className="font-medium">Not Verified</p>
                    </div>
                );
        }
    };

    return (
        <div className="bg-card border border-border/30 rounded-2xl overflow-hidden flex flex-col h-[420px] shadow-xs">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-border/20 bg-card flex items-center justify-between shrink-0">
                <div className="space-y-0.5">
                    <h3 className="text-sm font-black uppercase tracking-wider text-foreground flex items-center gap-2">
                        <Shield className="w-4 h-4 text-primary" aria-hidden="true" />
                        Work Rights
                    </h3>
                </div>
                {!workRight && (
                    <AddLicenseDialog
                        employeeId={employeeId}
                        employeeName={employeeName}
                        type="WorkRights"
                        existingLicenseIds={workRights?.map(l => l.license_id) || []}
                    />
                )}
            </div>

            {/* Scrollable Content Body */}
            <div className="p-4 flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-muted-foreground text-xs font-medium animate-pulse">Loading work rights...</p>
                    </div>
                ) : !workRight ? (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted-foreground">
                        <Shield className="w-8 h-8 mx-auto mb-2 opacity-20" aria-hidden="true" />
                        <p className="text-xs font-bold">No work rights recorded</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="bg-muted/30 hover:bg-muted/60 rounded-xl border border-border/20 p-3.5 transition-colors group">
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="min-w-0 flex-1">
                                    <h4 className="font-bold text-xs text-foreground truncate">{workRight.license?.name || 'Work Rights'}</h4>
                                    {workRight.license?.description && (
                                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{workRight.license.description}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <Badge className={
                                        workRight.status === 'Active'
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-bold text-[9px] uppercase shadow-none'
                                            : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 font-bold text-[9px] uppercase shadow-none'
                                    }>
                                        {workRight.status}
                                    </Badge>
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        aria-label="Remove Work Rights"
                                        className="text-muted-foreground/60 hover:text-red-500 p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                        title="Remove Work Rights"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-3 text-[9px] font-semibold text-muted-foreground mt-2">
                                {workRight.issue_date && (
                                    <span>Issued: {format(parseISO(workRight.issue_date), 'MMM d, yyyy')}</span>
                                )}
                                {workRight.expiration_date && (
                                    <span>Expires: {format(parseISO(workRight.expiration_date), 'MMM d, yyyy')}</span>
                                )}
                            </div>
                            <div className="pt-2.5 mt-2.5 border-t border-border/20 flex items-center justify-between">
                                {getVerificationBadge()}
                            </div>
                        </div>

                        {/* Student Visa Restrictions Toggle */}
                        {isStudentVisa && (
                            <div className="bg-amber-500/10 p-3.5 rounded-xl border border-amber-500/30 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="space-y-0.5">
                                        <Label className="text-amber-600 dark:text-amber-400 font-bold text-xs flex items-center gap-1.5">
                                            <AlertOctagon className="w-3.5 h-3.5" aria-hidden="true" />
                                            Student Visa (Subclass 500)
                                        </Label>
                                        <p className="text-[10px] text-amber-600/90 dark:text-amber-400/90 font-medium">
                                            Fortnightly work hours limit
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isToggling && <Loader2 className="w-3 h-3 animate-spin text-amber-600 dark:text-amber-400" aria-hidden="true" />}
                                        <Switch
                                            checked={workRight.has_restricted_work_limit || false}
                                            onCheckedChange={handleToggleWorkLimit}
                                            disabled={isToggling}
                                            className="data-[state=checked]:bg-amber-500"
                                        />
                                    </div>
                                </div>

                                {workRight.has_restricted_work_limit && (
                                    <div className="p-2.5 bg-amber-500/15 rounded-lg border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-medium">
                                        <strong>Restriction Active:</strong> Limited to 48 hours per fortnight while study session is active.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default WorkRightsSection;
