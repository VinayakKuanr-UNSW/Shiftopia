import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Label } from '@/modules/core/ui/primitives/label';
import { useEmployeeLicenses, useRemoveEmployeeLicense } from '@/modules/users/hooks/useEmployeeLicenses';
import { Shield, CheckCircle, XCircle, AlertTriangle, AlertOctagon, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AddLicenseDialog } from './AddLicenseDialog';
import { supabase } from '@/platform/realtime/client';
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
        <Card className="border border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Shield className="w-5 h-5" />
                        Work Rights
                    </CardTitle>
                    <CardDescription>
                        Visa status and employment eligibility
                    </CardDescription>
                </div>
                {!workRight && (
                    <AddLicenseDialog
                        employeeId={employeeId}
                        employeeName={employeeName}
                        type="WorkRights"
                        existingLicenseIds={workRights?.map(l => l.license_id) || []}
                    />
                )}
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading work rights...</p>
                ) : !workRight ? (
                    <div className="text-center py-8">
                        <Shield className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                        <p className="text-muted-foreground text-sm">No work rights recorded</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-card rounded-lg border border-border p-4">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex-1">
                                    <h4 className="font-medium text-foreground text-lg">{workRight.license?.name || 'Work Rights'}</h4>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {workRight.license?.description || 'Employment eligibility verification'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Badge className={
                                        workRight.status === 'Active'
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                            : 'bg-destructive/10 text-destructive border border-destructive/20'
                                    }>
                                        {workRight.status}
                                    </Badge>
                                    <button
                                        onClick={handleDelete}
                                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                        title="Remove Work Rights"
                                    >
                                        <XCircle className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                                {workRight.issue_date && (
                                    <div>
                                        <p className="text-muted-foreground">Issue Date</p>
                                        <p className="text-foreground">{format(parseISO(workRight.issue_date), 'MMM d, yyyy')}</p>
                                    </div>
                                )}
                                {workRight.expiration_date && (
                                    <div>
                                        <p className="text-muted-foreground">Expiration Date</p>
                                        <p className="text-foreground">{format(parseISO(workRight.expiration_date), 'MMM d, yyyy')}</p>
                                    </div>
                                )}
                            </div>

                            <div className="pt-4 border-t border-border flex items-center justify-between">
                                {getVerificationBadge()}
                            </div>
                        </div>

                        {/* Student Visa Restrictions Toggle */}
                        {isStudentVisa && (
                            <div className="bg-amber-500/5 p-4 rounded-lg border border-amber-500/20">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="space-y-0.5">
                                        <Label className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-2">
                                            <AlertOctagon className="w-4 h-4" />
                                            Student Visa Restrictions (Subclass 500)
                                        </Label>
                                        <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                                            Limit work hours during study sessions
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isToggling && <Loader2 className="w-3 h-3 animate-spin text-amber-600 dark:text-amber-400" />}
                                        <Switch
                                            checked={workRight.has_restricted_work_limit || false}
                                            onCheckedChange={handleToggleWorkLimit}
                                            disabled={isToggling}
                                            className="data-[state=checked]:bg-amber-500"
                                        />
                                    </div>
                                </div>

                                {workRight.has_restricted_work_limit && (
                                    <div className="mt-3 p-3 bg-amber-500/10 rounded border border-amber-500/20 text-amber-700 dark:text-amber-300 text-sm">
                                        <strong>Restriction Active:</strong> Cannot work more than 48 hours a fortnight when course of study or training is in session.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default WorkRightsSection;
