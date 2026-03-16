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
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col h-full">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900 flex items-center justify-between">
                <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Award className="w-4 h-4 text-slate-500" />
                        Licenses
                    </h3>
                    <p className="text-[10px] text-slate-400 font-medium pl-6 uppercase tracking-wider">
                        {licenses?.length || 0} licenses recorded
                    </p>
                </div>
                <AddLicenseDialog
                    employeeId={employeeId}
                    employeeName={employeeName}
                    type="Standard"
                    existingLicenseIds={licenses?.map(l => l.license_id) || []}
                />
            </div>
            <div className="p-5 flex-1">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-slate-400 text-sm animate-pulse">Loading licenses...</p>
                    </div>
                ) : !licenses || licenses.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-center text-slate-400">
                        <Award className="w-8 h-8 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">No licenses recorded</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {licenses.map(license => (
                            <div
                                key={license.id}
                                className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all cursor-pointer group p-4"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex-1">
                                        <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100">{license.license?.name}</h4>
                                        {license.license?.description && (
                                            <p className="text-[11px] text-slate-500 mt-1">{license.license.description}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {getStatusBadge(license.status, license.expiration_date)}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(license.id, license.license?.name || 'License');
                                            }}
                                            className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1"
                                            title="Remove License"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex gap-4 text-[10px] text-slate-400 uppercase tracking-widest font-semibold mt-3">
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
            </div>
        </div>
    );
};

export default LicensesSection;
