import React from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useEmployeeLicenses, useRemoveEmployeeLicense } from '@/modules/users/hooks/useEmployeeLicenses';
import { Award, AlertCircle, Trash2 } from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { AddLicenseDialog } from './AddLicenseDialog';

interface LicensesSectionProps {
    employeeId: string;
    employeeName?: string;
}

const LicensesSection: React.FC<LicensesSectionProps> = ({ employeeId, employeeName = 'User' }) => {
    const { data: licenses, isLoading } = useEmployeeLicenses(employeeId, {
        filter: { license_type: 'Standard' }  // Exclude work rights
    });
    const { mutate: removeLicense } = useRemoveEmployeeLicense();

    const handleDelete = (id: string, name: string) => {
        if (confirm(`Are you sure you want to remove ${name}?`)) {
            removeLicense({ id, employeeId });
        }
    };

    const getStatusBadge = (status: string, expirationDate?: string) => {
        if (status === 'Expired') {
            return <Badge className="bg-destructive/10 text-destructive border border-destructive/20">Expired</Badge>;
        }

        if (expirationDate) {
            const daysUntilExpiry = differenceInDays(parseISO(expirationDate), new Date());
            if (daysUntilExpiry <= 60 && daysUntilExpiry > 0) {
                return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">Expiring Soon</Badge>;
            }
        }

        return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">Active</Badge>;
    };

    return (
        <Card className="border border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Award className="w-5 h-5" />
                        Licenses
                    </CardTitle>
                    <CardDescription>
                        {licenses?.length || 0} licenses recorded
                    </CardDescription>
                </div>
                <AddLicenseDialog
                    employeeId={employeeId}
                    employeeName={employeeName}
                    type="Standard"
                    existingLicenseIds={licenses?.map(l => l.license_id) || []}
                />
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading licenses...</p>
                ) : !licenses || licenses.length === 0 ? (
                    <div className="text-center py-8">
                        <Award className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                        <p className="text-muted-foreground text-sm">No licenses recorded</p>
                        <p className="text-muted-foreground/70 text-xs mt-1">Add licenses to track certifications</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {licenses.map(license => (
                            <div
                                key={license.id}
                                className="bg-card rounded-lg border border-border hover:border-border/80 hover:shadow-sm transition-all cursor-pointer group p-4"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex-1">
                                        <h4 className="font-medium text-foreground">{license.license?.name}</h4>
                                        {license.license?.description && (
                                            <p className="text-sm text-muted-foreground mt-1">{license.license.description}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {getStatusBadge(license.status, license.expiration_date)}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(license.id, license.license?.name || 'License');
                                            }}
                                            className="text-muted-foreground/40 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-1"
                                            title="Remove License"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex gap-4 text-xs text-muted-foreground">
                                    {license.issue_date && (
                                        <span>Issued: {format(parseISO(license.issue_date), 'MMM d, yyyy')}</span>
                                    )}
                                    {license.expiration_date && (
                                        <span>Expires: {format(parseISO(license.expiration_date), 'MMM d, yyyy')}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default LicensesSection;
