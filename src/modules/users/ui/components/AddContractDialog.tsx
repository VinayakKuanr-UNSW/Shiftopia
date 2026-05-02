import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Label } from '@/modules/core/ui/primitives/label';
import { Plus, Building2, Users, ChevronRight, Briefcase, DollarSign, Loader2 } from 'lucide-react';
import { useReferenceData } from '../hooks/useReferenceData';
import { useContractForm } from '../hooks/useContractForm';

interface AddContractDialogProps {
    employeeId: string;
    employeeName: string;
}

// Replaced hardcoded themes

export const AddContractDialog: React.FC<AddContractDialogProps> = ({ employeeId, employeeName }) => {
    const [open, setOpen] = useState(false);

    // Hooks
    const {
        organizations, departments, subDepartments, roles, remLevels,
        isLoading: isLoadingRefs, loadReferenceData
    } = useReferenceData(open);

    const {
        formData, isSubmitting, updateField, updateRole, submit,
    } = useContractForm(employeeId, () => setOpen(false));

    // Filtered options based on form selection
    const filteredDepartments = departments.filter(d => d.organization_id === formData.organization_id);
    const filteredSubDepartments = subDepartments.filter(sd => sd.department_id === formData.department_id);
    const filteredRoles = roles.filter(r => r.sub_department_id === formData.sub_department_id);

    const handleSubmit = async () => {
        await submit();
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => loadReferenceData()}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Contract
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl bg-card border-border text-foreground shadow-xl shadow-black/5 dark:shadow-black/20">
                <DialogHeader>
                    <DialogTitle>Add Contract</DialogTitle>
                    <DialogDescription>
                        Create a new user contract for {employeeName}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                    {/* Organization */}
                    <div className="space-y-2">
                        <Label className="text-muted-foreground flex items-center gap-2">
                            <Building2 className="w-4 h-4" /> Organization
                        </Label>
                        <Select
                            value={formData.organization_id}
                            onValueChange={(val) => updateField('organization_id', val)}
                        >
                            <SelectTrigger className="bg-muted/30 border-border">
                                <SelectValue placeholder="Select organization" />
                            </SelectTrigger>
                            <SelectContent>
                                {organizations.map(org => (
                                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Department */}
                    <div className="space-y-2">
                        <Label className="text-muted-foreground flex items-center gap-2">
                            <Users className="w-4 h-4" /> Department
                        </Label>
                        <Select
                            value={formData.department_id}
                            onValueChange={(val) => updateField('department_id', val)}
                            disabled={!formData.organization_id}
                        >
                            <SelectTrigger className="bg-muted/30 border-border">
                                <SelectValue placeholder="Select department" />
                            </SelectTrigger>
                            <SelectContent>
                                {filteredDepartments.map(dept => (
                                    <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Sub-Department */}
                    <div className="space-y-2">
                        <Label className="text-muted-foreground flex items-center gap-2">
                            <ChevronRight className="w-4 h-4" /> Sub-Department
                        </Label>
                        <Select
                            value={formData.sub_department_id}
                            onValueChange={(val) => updateField('sub_department_id', val)}
                            disabled={!formData.department_id}
                        >
                            <SelectTrigger className="bg-muted/30 border-border">
                                <SelectValue placeholder="Select sub-department" />
                            </SelectTrigger>
                            <SelectContent>
                                {filteredSubDepartments.map(sd => (
                                    <SelectItem key={sd.id} value={sd.id}>{sd.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Role */}
                    <div className="space-y-2">
                        <Label className="text-muted-foreground flex items-center gap-2">
                            <Briefcase className="w-4 h-4" /> Role
                        </Label>
                        <Select
                            value={formData.role_id}
                            onValueChange={(val) => {
                                const role = roles.find(r => r.id === val);
                                updateRole(val, role?.remuneration_level_id, role?.employment_type);
                            }}
                            disabled={!formData.sub_department_id}
                        >
                            <SelectTrigger className="bg-muted/30 border-border">
                                <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                                {filteredRoles.map(role => (
                                    <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {(() => {
                        const selectedRole = roles.find(r => r.id === formData.role_id);
                        const roleEmploymentType = selectedRole?.employment_type;

                        const allowedStatuses = (() => {
                            if (!roleEmploymentType) return ['Full-Time', 'Part-Time', 'Casual', 'Flexible Part-Time'];
                            const lower = roleEmploymentType.toLowerCase();
                            const statuses: string[] = [];
                            if (lower.includes('full time')) statuses.push('Full-Time');
                            if (lower.includes('part time')) statuses.push('Part-Time');
                            if (lower.includes('casual')) statuses.push('Casual');
                            if (lower.includes('flexible')) statuses.push('Flexible Part-Time');
                            return statuses.length > 0 ? statuses : ['Full-Time', 'Part-Time', 'Casual', 'Flexible Part-Time'];
                        })();

                        const isRemLocked = !!formData.role_id && !!selectedRole?.remuneration_level_id;
                        const isEmpLocked = !!formData.role_id && allowedStatuses.length === 1;

                        return (
                            <>
                                {/* Remuneration Level */}
                                <div className="space-y-2">
                                    <Label className="text-muted-foreground flex items-center gap-2">
                                        <DollarSign className="w-4 h-4" /> Remuneration Level
                                    </Label>
                                    <Select
                                        value={formData.rem_level_id}
                                        onValueChange={(val) => updateField('rem_level_id', val)}
                                        disabled={isRemLocked}
                                    >
                                        <SelectTrigger className="bg-muted/30 border-border">
                                            <SelectValue placeholder="Select level" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {remLevels.map(rl => (
                                                <SelectItem key={rl.id} value={rl.id}>
                                                    L{rl.level_number} - {rl.level_name} (${rl.hourly_rate_min}/hr)
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Employment Status */}
                                <div className="space-y-2">
                                    <Label className="text-muted-foreground flex items-center gap-2">
                                        <Briefcase className="w-4 h-4" /> Employment Status
                                    </Label>
                                    <Select
                                        value={formData.employment_status}
                                        onValueChange={(val) => updateField('employment_status', val)}
                                        disabled={isEmpLocked}
                                    >
                                        <SelectTrigger className="bg-muted/30 border-border">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {allowedStatuses.map(status => (
                                                <SelectItem key={status} value={status}>
                                                    {status}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </>
                        );
                    })()}
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting || isLoadingRefs}>
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Adding...
                            </>
                        ) : (
                            'Add Contract'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
