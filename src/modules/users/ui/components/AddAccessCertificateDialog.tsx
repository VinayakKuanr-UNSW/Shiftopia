import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Label } from '@/modules/core/ui/primitives/label';
import { Plus, Building2, Users, ChevronRight, Shield, Loader2, AlertTriangle, User, UserCheck, Crown, Globe, Pencil, Lock, Zap } from 'lucide-react';
import { AccessLevel, CertificateType } from '@/platform/auth/types';
import { useReferenceData } from '../hooks/useReferenceData';
import { supabase } from '@/platform/realtime/client';

interface AccessCertificateDialogProps {
    employeeId: string;
    employeeName: string;
    existingCertificates: { id: string; access_level: string; certificate_type?: string; is_active?: boolean }[];
    certificateToEdit?: {
        id: string;
        access_level: string;
        certificate_type?: string;
        organization_id?: string;
        department_id?: string;
        sub_department_id?: string;
    } | null;
    trigger?: React.ReactNode;
    onSuccess?: () => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

// =============================================
// Access Level Configs (grouped by certificate type)
// =============================================

const TYPE_X_LEVELS: { level: AccessLevel; label: string; description: string; icon: React.ReactNode }[] = [
    {
        level: 'alpha',
        label: 'Alpha (Employee)',
        description: 'View own data only',
        icon: <User className="w-4 h-4 text-slate-400" />,
    },
    {
        level: 'beta',
        label: 'Beta (Team Lead)',
        description: 'View timesheets & basic team data',
        icon: <UserCheck className="w-4 h-4 text-blue-400" />,
    },
];

const TYPE_Y_LEVELS: { level: AccessLevel; label: string; description: string; icon: React.ReactNode }[] = [
    {
        level: 'gamma',
        label: 'Gamma (Sub-Dept Manager)',
        description: 'Manage specific sub-department operations',
        icon: <Building2 className="w-4 h-4 text-purple-400" />,
    },
    {
        level: 'delta',
        label: 'Delta (Dept Manager)',
        description: 'Full department oversight',
        icon: <Crown className="w-4 h-4 text-amber-400" />,
    },
    {
        level: 'epsilon',
        label: 'Epsilon (Org Admin)',
        description: 'Full organization access',
        icon: <Globe className="w-4 h-4 text-emerald-400" />,
    },
    {
        level: 'zeta',
        label: 'Zeta (Super Admin)',
        description: 'Unrestricted global access across all organizations',
        icon: <Zap className="w-4 h-4 text-rose-400" />,
    },
];

// Combined for backward compat lookup
const ACCESS_LEVEL_CONFIG: Record<AccessLevel, { label: string; description: string; icon: React.ReactNode }> = {
    alpha: TYPE_X_LEVELS[0],
    beta: TYPE_X_LEVELS[1],
    gamma: TYPE_Y_LEVELS[0],
    delta: TYPE_Y_LEVELS[1],
    epsilon: TYPE_Y_LEVELS[2],
    zeta: TYPE_Y_LEVELS[3],
};

export const AccessCertificateDialog: React.FC<AccessCertificateDialogProps> = ({
    employeeId,
    employeeName,
    existingCertificates,
    certificateToEdit,
    trigger,
    onSuccess,
    open: controlledOpen,
    onOpenChange: setControlledOpen
}) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = isControlled ? setControlledOpen! : setInternalOpen;

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Determines if we are in Edit Mode
    const isEditMode = !!certificateToEdit;

    // Local Form State
    const [certificateType, setCertificateType] = useState<CertificateType>('X');
    const [accessLevel, setAccessLevel] = useState<AccessLevel>('alpha');
    const [organizationId, setOrganizationId] = useState<string>('');
    const [departmentId, setDepartmentId] = useState<string>('');
    const [subDepartmentId, setSubDepartmentId] = useState<string>('');

    // Check if user already has an active Type Y certificate
    const hasExistingTypeY = useMemo(() => {
        return existingCertificates.some(c =>
            (c.certificate_type === 'Y' || ['gamma', 'delta', 'epsilon', 'zeta'].includes(c.access_level)) &&
            c.is_active !== false &&
            c.id !== certificateToEdit?.id
        );
    }, [existingCertificates, certificateToEdit]);

    // Pre-fill form on open/change of certificateToEdit
    useEffect(() => {
        if (open && certificateToEdit) {
            const certType = certificateToEdit.certificate_type as CertificateType ||
                (['alpha', 'beta'].includes(certificateToEdit.access_level) ? 'X' : 'Y');
            setCertificateType(certType);
            setAccessLevel(certificateToEdit.access_level as AccessLevel);
            setOrganizationId(certificateToEdit.organization_id || '');
            setDepartmentId(certificateToEdit.department_id || '');
            setSubDepartmentId(certificateToEdit.sub_department_id || '');
        } else if (open && !certificateToEdit) {
            setCertificateType('X');
            setAccessLevel('alpha');
            setOrganizationId('');
            setDepartmentId('');
            setSubDepartmentId('');
        }
    }, [open, certificateToEdit]);

    // Reset access level when type changes
    useEffect(() => {
        if (certificateType === 'X' && !['alpha', 'beta'].includes(accessLevel)) {
            setAccessLevel('alpha');
        } else if (certificateType === 'Y' && !['gamma', 'delta', 'epsilon', 'zeta'].includes(accessLevel)) {
            setAccessLevel('gamma');
        }
    }, [certificateType]);

    // Hooks
    const {
        organizations, departments, subDepartments,
        isLoading: isLoadingRefs, loadReferenceData
    } = useReferenceData(open);

    useEffect(() => {
        if (open) loadReferenceData();
    }, [open]);

    // Filtered options based on form selection
    const filteredDepartments = departments.filter(d => d.organization_id === organizationId);
    const filteredSubDepartments = subDepartments.filter(sd => sd.department_id === departmentId);

    // Reset subordinate fields when parent changes
    const updateOrganization = (val: string) => {
        setOrganizationId(val);
        setDepartmentId('');
        setSubDepartmentId('');
    };

    const updateDepartment = (val: string) => {
        setDepartmentId(val);
        setSubDepartmentId('');
    };

    // Scope requirements per level (per PRD §5.3)
    // Zeta → org, dept, subdept must be null (all global)
    // Epsilon → org required, dept/subdept null (all depts/subdepts)
    // Delta → org+dept required, subdept null (all subdepts)
    // Gamma, Alpha, Beta → all required
    const needsOrganization = accessLevel !== 'zeta';
    const needsDepartment = ['alpha', 'beta', 'gamma', 'delta'].includes(accessLevel);
    const needsSubDepartment = ['alpha', 'beta', 'gamma'].includes(accessLevel);

    // Available levels based on certificate type
    const availableLevels = certificateType === 'X' ? TYPE_X_LEVELS : TYPE_Y_LEVELS;

    const handleSubmit = async () => {
        // 1. Type Y uniqueness
        if (certificateType === 'Y' && hasExistingTypeY) {
            setError('User already has an active Type Y (Managerial) certificate. Only one is allowed.');
            return;
        }

        // 2. Required fields
        if (needsOrganization && !organizationId) {
            setError('Organization is required.');
            return;
        }
        if (needsDepartment && !departmentId) {
            setError('Department is required for this access level.');
            return;
        }
        if (needsSubDepartment && !subDepartmentId) {
            setError('Sub-Department is required for this access level.');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const payload = {
                user_id: employeeId,
                certificate_type: certificateType,
                access_level: accessLevel,
                organization_id: needsOrganization ? organizationId : null,
                department_id: needsDepartment ? departmentId : null,
                sub_department_id: needsSubDepartment ? subDepartmentId : null,
            };

            let errorResult;

            if (isEditMode && certificateToEdit) {
                const { error } = await supabase
                    .from('app_access_certificates')
                    .update(payload)
                    .eq('id', certificateToEdit.id);
                errorResult = error;
            } else {
                const { error } = await supabase
                    .from('app_access_certificates')
                    .insert(payload);
                errorResult = error;
            }

            if (errorResult) throw errorResult;

            setOpen(false);
            if (onSuccess) onSuccess();
        } catch (err: any) {
            console.error('Failed to save certificate:', err);
            setError(err.message || 'Failed to save certificate');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline" size="sm" onClick={() => loadReferenceData()} className="border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300">
                        <Shield className="w-4 h-4 mr-2" />
                        Add Certificate
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="max-w-xl bg-slate-900/95 border-emerald-500/20 text-white shadow-2xl shadow-emerald-900/10">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                            {isEditMode ? <Pencil className="w-5 h-5 text-emerald-400" /> : <Shield className="w-5 h-5 text-emerald-400" />}
                        </div>
                        <div>
                            <DialogTitle>{isEditMode ? 'Edit Access Certificate' : 'Add Access Certificate'}</DialogTitle>
                            <DialogDescription>
                                {isEditMode ? 'Update' : 'Grant'} system permissions for {employeeName}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="grid grid-cols-1 gap-6 py-4">
                    {/* Certificate Type Selection */}
                    <div className="space-y-2">
                        <Label className="text-white/70 flex items-center gap-2">
                            <Shield className="w-4 h-4" /> Certificate Type
                        </Label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => setCertificateType('X')}
                                className={`p-3 rounded-lg border text-left transition-all ${certificateType === 'X'
                                    ? 'border-blue-500/40 bg-blue-500/10'
                                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                                    }`}
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <User className="w-4 h-4 text-blue-400" />
                                    <span className="font-semibold text-sm">Type X — Personal</span>
                                </div>
                                <p className="text-xs text-white/50">Individual access to own data</p>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!hasExistingTypeY || isEditMode) {
                                        setCertificateType('Y');
                                    }
                                }}
                                disabled={hasExistingTypeY && !isEditMode}
                                className={`p-3 rounded-lg border text-left transition-all ${certificateType === 'Y'
                                    ? 'border-purple-500/40 bg-purple-500/10'
                                    : hasExistingTypeY && !isEditMode
                                        ? 'border-white/5 bg-white/[0.01] opacity-50 cursor-not-allowed'
                                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                                    }`}
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <Crown className="w-4 h-4 text-purple-400" />
                                    <span className="font-semibold text-sm">Type Y — Managerial</span>
                                    {hasExistingTypeY && !isEditMode && (
                                        <Lock className="w-3 h-3 text-amber-400/60 ml-auto" />
                                    )}
                                </div>
                                <p className="text-xs text-white/50">
                                    {hasExistingTypeY && !isEditMode
                                        ? 'Already assigned (max 1)'
                                        : 'Administrative data scope'
                                    }
                                </p>
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-white/10" />

                    {/* Access Level */}
                    <div className="space-y-2">
                        <Label className="text-white/70 flex items-center gap-2">
                            <Shield className="w-4 h-4" /> Access Level
                        </Label>
                        <Select
                            value={accessLevel}
                            onValueChange={(val) => setAccessLevel(val as AccessLevel)}
                        >
                            <SelectTrigger className="bg-emerald-950/20 border-emerald-500/20 text-white h-12">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-white/10">
                                {availableLevels.map(({ level, label, description, icon }) => (
                                    <SelectItem key={level} value={level} className="focus:bg-white/5">
                                        <div className="flex items-center gap-3 py-1">
                                            {icon}
                                            <div className="flex flex-col text-left">
                                                <span className="font-semibold capitalize text-base">{label}</span>
                                                <span className="text-xs text-white/50">{description}</span>
                                            </div>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="h-px bg-white/10" />

                    {/* Scope Selection */}
                    <div className="space-y-4">
                        {/* Organization */}
                        <div className="space-y-2">
                            <Label className={`flex items-center gap-2 ${needsOrganization ? 'text-white/70' : 'text-white/30'}`}>
                                <Building2 className="w-4 h-4" /> Organization
                                {needsOrganization && <span className="text-rose-400">*</span>}
                            </Label>
                            {needsOrganization ? (
                                <Select
                                    value={organizationId}
                                    onValueChange={updateOrganization}
                                >
                                    <SelectTrigger className="bg-white/5 border-white/10">
                                        <SelectValue placeholder="Select organization" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-900 border-white/10">
                                        {organizations.map(org => (
                                            <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400 flex items-center gap-2">
                                    <Lock className="w-4 h-4" />
                                    Global Access (All Organizations)
                                </div>
                            )}
                        </div>

                        {/* Department */}
                        <div className="space-y-2">
                            <Label className={`flex items-center gap-2 ${needsDepartment ? 'text-white/70' : 'text-white/30'}`}>
                                <Users className="w-4 h-4" /> Department
                                {needsDepartment && <span className="text-rose-400">*</span>}
                            </Label>
                            {needsDepartment ? (
                                <Select
                                    value={departmentId}
                                    onValueChange={updateDepartment}
                                    disabled={!organizationId}
                                >
                                    <SelectTrigger className="bg-white/5 border-white/10">
                                        <SelectValue placeholder="Select department" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-900 border-white/10">
                                        {filteredDepartments.map(dept => (
                                            <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400 flex items-center gap-2">
                                    <Lock className="w-4 h-4" />
                                    Global Access (All Departments)
                                </div>
                            )}
                        </div>

                        {/* Sub-Department */}
                        <div className="space-y-2">
                            <Label className={`flex items-center gap-2 ${needsSubDepartment ? 'text-white/70' : 'text-white/30'}`}>
                                <ChevronRight className="w-4 h-4" /> Sub-Department
                                {needsSubDepartment && <span className="text-rose-400">*</span>}
                            </Label>
                            {needsSubDepartment ? (
                                <Select
                                    value={subDepartmentId}
                                    onValueChange={setSubDepartmentId}
                                    disabled={!departmentId}
                                >
                                    <SelectTrigger className="bg-white/5 border-white/10">
                                        <SelectValue placeholder="Select sub-department" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-900 border-white/10">
                                        {filteredSubDepartments.map(sd => (
                                            <SelectItem key={sd.id} value={sd.id}>{sd.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400 flex items-center gap-2">
                                    <Lock className="w-4 h-4" />
                                    {accessLevel === 'zeta'
                                        ? 'Global Access (All Sub-Departments)'
                                        : accessLevel === 'epsilon'
                                            ? 'Global Access (All Sub-Departments)'
                                            : 'Global Access (All Sub-Departments in Department)'}
                                </div>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-md flex items-center gap-2 text-rose-400 text-sm">
                            <AlertTriangle className="w-4 h-4" /> {error}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting || isLoadingRefs} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                {isEditMode ? 'Updating...' : 'Granting...'}
                            </>
                        ) : (
                            isEditMode ? 'Update Access' : 'Grant Access'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
