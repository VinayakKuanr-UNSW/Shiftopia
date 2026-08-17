import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import { Input } from '@/modules/core/ui/primitives/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { useEmployeeLicenses, useUpdateEmployeeLicense, useRemoveEmployeeLicense, EmployeeLicense } from '@/modules/users/hooks/useEmployeeLicenses';
import { Award, AlertCircle, Trash2, Pencil } from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { AddLicenseDialog } from './AddLicenseDialog';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { cn } from '@/modules/core/lib/utils';

interface LicensesSectionProps {
    employeeId: string;
    employeeName?: string;
}

const LicensesSection: React.FC<LicensesSectionProps> = ({ employeeId, employeeName = 'User' }) => {
    const { data: licenses, isLoading } = useEmployeeLicenses(employeeId, {
        filter: { license_type: 'Standard' }  // Exclude work rights
    });
    const updateLicenseMutation = useUpdateEmployeeLicense();
    const { mutate: removeLicense } = useRemoveEmployeeLicense();
    const [editingLicense, setEditingLicense] = useState<EmployeeLicense | null>(null);
    const { toast } = useToast();

    const handleDelete = (id: string, name: string) => {
        if (confirm(`Are you sure you want to remove ${name}?`)) {
            removeLicense({ id, employeeId });
        }
    };

    const handleUpdateLicense = async () => {
        if (!editingLicense) return;

        if (!editingLicense.issue_date) {
            toast({ title: 'Validation Error', description: 'Issue date is mandatory for licenses', variant: 'destructive' });
            return;
        }

        if (!editingLicense.expiration_date) {
            toast({ title: 'Validation Error', description: 'Expiry date is mandatory for licenses', variant: 'destructive' });
            return;
        }

        if (new Date(editingLicense.issue_date) > new Date(editingLicense.expiration_date)) {
            toast({ title: 'Validation Error', description: 'Issue date cannot be after expiration date', variant: 'destructive' });
            return;
        }

        await updateLicenseMutation.mutateAsync({
            id: editingLicense.id,
            updates: {
                issue_date: editingLicense.issue_date,
                expiration_date: editingLicense.expiration_date,
            },
        });

        setEditingLicense(null);
    };

    const getStatusBadge = (status: string, expirationDate?: string) => {
        if (status === 'Expired') {
            return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 font-bold text-[9px] uppercase shadow-none">Expired</Badge>;
        }

        if (expirationDate) {
            const daysUntilExpiry = differenceInDays(parseISO(expirationDate), new Date());
            if (daysUntilExpiry <= 0) {
                return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 font-bold text-[9px] uppercase shadow-none">Expired</Badge>;
            }
            if (daysUntilExpiry <= 60) {
                return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-bold text-[9px] uppercase shadow-none">Expiring Soon</Badge>;
            }
        }

        return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-bold text-[9px] uppercase shadow-none">Active</Badge>;
    };

    return (
        <div className="bg-card border border-border/30 rounded-2xl overflow-hidden flex flex-col h-[420px] shadow-xs">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-border/20 bg-card flex items-center justify-between shrink-0">
                <div className="space-y-0.5">
                    <h3 className="text-sm font-black uppercase tracking-wider text-foreground flex items-center gap-2">
                        <Award className="w-4 h-4 text-primary" aria-hidden="true" />
                        Licenses ({licenses?.length || 0})
                    </h3>
                </div>
                <AddLicenseDialog
                    employeeId={employeeId}
                    employeeName={employeeName}
                    type="Standard"
                    existingLicenseIds={licenses?.map(l => l.license_id) || []}
                />
            </div>

            {/* Edit License Dialog */}
            {editingLicense && (
                <Dialog open={!!editingLicense} onOpenChange={(open) => !open && setEditingLicense(null)}>
                    <DialogContent className="rounded-2xl border border-border/30 bg-popover">
                        <DialogHeader>
                            <DialogTitle className="text-lg font-black uppercase tracking-tight">Edit License</DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground">
                                Update issue & expiry dates for <span className="font-bold text-foreground">{editingLicense.license?.name}</span>
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 mt-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs font-bold">Issue Date <span className="text-red-500">*</span></Label>
                                    <Input
                                        type="date"
                                        required
                                        value={editingLicense.issue_date ? editingLicense.issue_date.split('T')[0] : ''}
                                        onChange={(e) => setEditingLicense({ ...editingLicense, issue_date: e.target.value })}
                                        className="rounded-xl border-border/40"
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs font-bold">Expiry Date <span className="text-red-500">*</span></Label>
                                    <Input
                                        type="date"
                                        required
                                        value={editingLicense.expiration_date ? editingLicense.expiration_date.split('T')[0] : ''}
                                        onChange={(e) => setEditingLicense({ ...editingLicense, expiration_date: e.target.value })}
                                        className="rounded-xl border-border/40"
                                    />
                                </div>
                            </div>
                            <Button onClick={handleUpdateLicense} className="w-full rounded-xl font-bold uppercase tracking-wider shadow-none">
                                Save Changes
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            {/* Scrollable Content Body */}
            <div className="p-4 flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-muted-foreground text-xs font-medium animate-pulse">Loading licenses...</p>
                    </div>
                ) : !licenses || licenses.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted-foreground">
                        <Award className="w-8 h-8 mx-auto mb-2 opacity-20" aria-hidden="true" />
                        <p className="text-xs font-bold">No licenses recorded</p>
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {licenses.map(license => (
                            <div
                                key={license.id}
                                className="bg-muted/30 hover:bg-muted/60 rounded-xl border border-border/20 p-3 transition-colors group flex items-start justify-between gap-2"
                            >
                                <div className="min-w-0 flex-1">
                                    <h4 className="font-bold text-xs text-foreground truncate">{license.license?.name}</h4>
                                    {license.license?.description && (
                                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{license.license.description}</p>
                                    )}
                                    <div className="flex flex-wrap gap-3 text-[9px] font-semibold text-muted-foreground mt-2">
                                        {license.issue_date && (
                                            <span>Issued: {format(parseISO(license.issue_date), 'MMM d, yyyy')}</span>
                                        )}
                                        {license.expiration_date && (
                                            <span>Expires: {format(parseISO(license.expiration_date), 'MMM d, yyyy')}</span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    {getStatusBadge(license.status, license.expiration_date)}
                                    <button
                                        type="button"
                                        onClick={() => setEditingLicense(license)}
                                        aria-label={`Edit license ${license.license?.name}`}
                                        className="text-muted-foreground/60 hover:text-primary p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                        title="Edit License"
                                    >
                                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(license.id, license.license?.name || 'License');
                                        }}
                                        aria-label={`Remove license ${license.license?.name}`}
                                        className="text-muted-foreground/60 hover:text-red-500 p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                        title="Remove License"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
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
