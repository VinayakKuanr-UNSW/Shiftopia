import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { 
    Plus, Check, Building2, Users, ChevronRight, Briefcase, 
    Loader2, Sparkles, Pencil, Clock, GraduationCap, 
    BookOpen, Accessibility, ChevronDown, ShieldCheck, Zap, AlertTriangle
} from 'lucide-react';
import { useReferenceData } from '../hooks/useReferenceData';
import { useContractForm, FLEXIBLE_PT_ANNUAL_HOURS_MIN, FLEXIBLE_PT_ANNUAL_HOURS_MAX } from '../hooks/useContractForm';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { CommandSelector } from './CommandSelector';
import { EmploymentTypeDropdown, STANDARD_EMPLOYMENT_TYPES } from './EmploymentTypeDropdown';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { supabase } from '@/platform/supabase/client';
import { Input } from '@/modules/core/ui/primitives/input';
import { validateContractHours, MAX_CONTRACTED_WEEKLY_HOURS, type ExistingContract } from '../../domain/contractHoursCeiling';

interface AddContractDialogProps {
    employeeId: string;
    employeeName: string;
    existingContract?: {
        id: string;
        organization_id?: string | null;
        department_id?: string | null;
        sub_department_id?: string | null;
        role_id: string;
        remuneration_level?: number | null;
        employment_status?: string | null;
    };
    /** Every contract row the employee holds in ONE sub-department. */
    existingScope?: any[];
    /** All contracts for this employee — used for the 38h ceiling check. */
    existingContracts?: any[];
    trigger?: React.ReactNode;
    onSuccess?: () => void;
}

const SWS_MIN_WEEKLY_PAY = 90;

const fmtHours = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const AddContractDialog: React.FC<AddContractDialogProps> = ({ 
    employeeId, 
    employeeName, 
    existingContract, 
    existingScope,
    existingContracts = [], 
    trigger,
    onSuccess 
}) => {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();

    // Hooks
    const {
        organizations, departments, subDepartments, roles,
        isLoading: isLoadingRefs, loadReferenceData
    } = useReferenceData(open);

    const {
        formData, isSubmitting, updateField, toggleRole, setRoleTerm, submit, submitScopeUpdate, setFormData,
        positions, totalWeeklyHours,
    } = useContractForm(employeeId, () => {
        setOpen(false);
        if (onSuccess) onSuccess();
    });

    const isScopeEdit = !!existingScope?.length;
    const isEditMode = !!existingContract || isScopeEdit;

    // Pre-fill form when editing
    React.useEffect(() => {
        if (open && isScopeEdit && existingScope) {
            const head = existingScope[0];
            setFormData({
                organization_id: head.organization_id || '',
                department_id: head.department_id || '',
                sub_department_id: head.sub_department_id || '',
                role_ids: existingScope.map((c: any) => c.role_id).filter(Boolean),
                role_terms: Object.fromEntries(existingScope
                    .filter((c: any) => c.role_id)
                    .map((c: any) => [c.role_id, {
                        employment_status: c.employment_status || '',
                        contracted_weekly_hours: Number(c.contracted_weekly_hours) || 0,
                        annual_guaranteed_hours: Number(c.annual_guaranteed_hours) || 0,
                    }])),
                remuneration_level: '',
                employment_status: '',
                contracted_weekly_hours: 0,
                annual_guaranteed_hours: 0,
                is_apprentice: head.is_apprentice || false,
                apprentice_type: head.apprentice_type || 'standard',
                apprentice_year: head.apprentice_year || 1,
                has_completed_year_12: head.has_completed_year_12 || false,
                is_trainee: head.is_trainee || false,
                trainee_category: head.trainee_category || 'junior',
                trainee_level: head.trainee_level || 'A',
                trainee_exit_year: head.trainee_exit_year || 12,
                trainee_years_out: head.trainee_years_out || 0,
                trainee_aqf_level: head.trainee_aqf_level || 3,
                trainee_year: head.trainee_year || 1,
                is_training_on_job: head.is_training_on_job || false,
                prefers_sba_loading: head.prefers_sba_loading || false,
                is_sws: head.is_sws || false,
                sws_capacity_percentage: head.sws_capacity_percentage || 50,
                is_sws_trial: head.is_sws_trial || false,
                sws_trial_start_date: head.sws_trial_start_date || '',
            });
        } else if (open && existingContract) {
            setFormData({
                organization_id: existingContract.organization_id || '',
                department_id: existingContract.department_id || '',
                sub_department_id: existingContract.sub_department_id || '',
                role_ids: existingContract.role_id ? [existingContract.role_id] : [],
                role_terms: existingContract.role_id
                    ? {
                        [existingContract.role_id]: {
                            employment_status: existingContract.employment_status || '',
                            contracted_weekly_hours: (existingContract as any).contracted_weekly_hours || 0,
                            annual_guaranteed_hours: (existingContract as any).annual_guaranteed_hours || 0,
                        },
                    }
                    : {},
                remuneration_level: existingContract.remuneration_level != null ? existingContract.remuneration_level : '',
                employment_status: existingContract.employment_status || '',
                contracted_weekly_hours: (existingContract as any).contracted_weekly_hours || 0,
                is_apprentice: (existingContract as any).is_apprentice || false,
                apprentice_type: (existingContract as any).apprentice_type || 'standard',
                apprentice_year: (existingContract as any).apprentice_year || 1,
                has_completed_year_12: (existingContract as any).has_completed_year_12 || false,
                is_trainee: (existingContract as any).is_trainee || false,
                trainee_category: (existingContract as any).trainee_category || 'junior',
                trainee_level: (existingContract as any).trainee_level || 'A',
                trainee_exit_year: (existingContract as any).trainee_exit_year || 12,
                trainee_years_out: (existingContract as any).trainee_years_out || 0,
                trainee_aqf_level: (existingContract as any).trainee_aqf_level || 3,
                trainee_year: (existingContract as any).trainee_year || 1,
                is_training_on_job: (existingContract as any).is_training_on_job || false,
                prefers_sba_loading: (existingContract as any).prefers_sba_loading || false,
                is_sws: (existingContract as any).is_sws || false,
                sws_capacity_percentage: (existingContract as any).sws_capacity_percentage || 50,
                is_sws_trial: (existingContract as any).is_sws_trial || false,
                sws_trial_start_date: (existingContract as any).sws_trial_start_date || '',
                annual_guaranteed_hours: (existingContract as any).annual_guaranteed_hours || 0
            });
        } else if (open && !existingContract) {
            setFormData({
                organization_id: '',
                department_id: '',
                sub_department_id: '',
                role_ids: [],
                role_terms: {},
                remuneration_level: '',
                employment_status: '',
                contracted_weekly_hours: 0,
                annual_guaranteed_hours: 0,
                is_apprentice: false,
                apprentice_type: 'standard',
                apprentice_year: 1,
                has_completed_year_12: false,
                is_trainee: false,
                trainee_category: 'junior',
                trainee_level: 'A',
                trainee_exit_year: 12,
                trainee_years_out: 0,
                trainee_aqf_level: 3,
                trainee_year: 1,
                is_training_on_job: false,
                prefers_sba_loading: false,
                is_sws: false,
                sws_capacity_percentage: 50,
                is_sws_trial: false,
                sws_trial_start_date: ''
            });
        }
    }, [open, existingContract, existingScope, isScopeEdit, setFormData]);

    // Filtered hierarchy options
    const filteredDepartments = departments.filter(d => d.organization_id === formData.organization_id);
    const filteredSubDepartments = subDepartments.filter(sd => sd.department_id === formData.department_id);
    
    // Clean role names (remove trailing L0, L1 redundancy)
    const cleanRoleName = (name: string) => name.replace(/\s*\(L\d+\)$/i, '').trim();
    
    // Arrange roles from highest level to lowest: L7 down to L0 (not alphabetically)
    const filteredRoles = useMemo(() => {
        return roles
            .filter(r => r.sub_department_id === formData.sub_department_id)
            .map(r => ({ ...r, name: cleanRoleName(r.name) }))
            .sort((a, b) => {
                const levelA = a.remuneration_level != null ? Number(a.remuneration_level) : -1;
                const levelB = b.remuneration_level != null ? Number(b.remuneration_level) : -1;
                if (levelB !== levelA) {
                    return levelB - levelA; // L7 -> L6 -> L5 -> L4 -> L3 -> L2 -> L1 -> L0 -> unlevelled (-1)
                }
                return a.name.localeCompare(b.name);
            });
    }, [roles, formData.sub_department_id]);

    // Bounds Flexible Part-Time annual guaranteed hours to 624-1,976h/year
    const isFptHoursInvalid = positions.some(p =>
        p.employment_status === 'Flexible Part-Time' &&
        (p.annual_guaranteed_hours < FLEXIBLE_PT_ANNUAL_HOURS_MIN ||
            p.annual_guaranteed_hours > FLEXIBLE_PT_ANNUAL_HOURS_MAX));

    // 38h contracted weekly hours ceiling validation
    const ceilingContracts: ExistingContract[] = useMemo(() =>
        (existingContracts ?? []).map((c: any) => ({
            id: c.id,
            employment_status: c.employment_status ?? null,
            contracted_weekly_hours: c.contracted_weekly_hours ?? null,
            status: c.status ?? null,
        })),
        [existingContracts],
    );

    const ceilingValidation = useMemo(() => {
        return validateContractHours(
            totalWeeklyHours,
            totalWeeklyHours > 0 ? 'Part-Time' : 'Casual',
            ceilingContracts,
            isEditMode ? existingContract?.id : undefined,
            isScopeEdit ? existingScope?.map((c: any) => c.id) : undefined,
        );
    }, [totalWeeklyHours, ceilingContracts, isEditMode, existingContract?.id, isScopeEdit, existingScope]);

    const isCeilingExceeded = !ceilingValidation.valid;

    const mixedPermanentConflict = useMemo(() => {
        const perm = positions.filter(p => p.employment_status
            && p.employment_status !== 'Casual');
        const hasFT = perm.some(p => p.employment_status === 'Full-Time');
        if (hasFT && perm.length > 1) {
            return 'A Full-Time engagement is 38 hours and cannot be combined with another permanent (PT/FPT) engagement. Make additional roles Casual.';
        }
        return null;
    }, [positions]);

    const handleSubmit = async () => {
        if (isFptHoursInvalid) {
            toast({
                title: 'Validation Error',
                description: `Annual Guaranteed Hours must be between ${FLEXIBLE_PT_ANNUAL_HOURS_MIN}-${FLEXIBLE_PT_ANNUAL_HOURS_MAX}h (cl 12.4).`,
                variant: 'destructive',
            });
            return;
        }
        if (isCeilingExceeded) {
            toast({
                title: 'Contract Hours Ceiling',
                description: ceilingValidation.message || 'Combined contracted hours would exceed 38h/week.',
                variant: 'destructive',
            });
            return;
        }
        if (mixedPermanentConflict) {
            toast({
                title: 'Conflicting Engagements',
                description: mixedPermanentConflict,
                variant: 'destructive',
            });
            return;
        }
        if (isScopeEdit && existingScope) {
            await submitScopeUpdate(existingScope, roleLevels);
            return;
        }
        if (isEditMode) {
            const { error } = await supabase
                .from('user_contracts')
                .update({
                    organization_id: formData.organization_id,
                    department_id: formData.department_id,
                    sub_department_id: formData.sub_department_id,
                    role_id: formData.role_ids[0],
                    remuneration_level: formData.remuneration_level === '' ? undefined : formData.remuneration_level,
                    employment_status: formData.role_terms[formData.role_ids[0]]?.employment_status || formData.employment_status as any,
                    contracted_weekly_hours: formData.role_terms[formData.role_ids[0]]?.contracted_weekly_hours ?? formData.contracted_weekly_hours,
                    is_apprentice: formData.is_apprentice,
                    apprentice_type: formData.apprentice_type,
                    apprentice_year: formData.apprentice_year,
                    has_completed_year_12: formData.has_completed_year_12,
                    is_trainee: formData.is_trainee,
                    trainee_category: formData.trainee_category,
                    trainee_level: formData.trainee_level,
                    trainee_exit_year: formData.trainee_exit_year,
                    trainee_years_out: formData.trainee_years_out,
                    trainee_aqf_level: formData.trainee_aqf_level,
                    trainee_year: formData.trainee_year,
                    is_training_on_job: formData.is_training_on_job,
                    prefers_sba_loading: formData.prefers_sba_loading,
                    is_sws: formData.is_sws,
                    sws_capacity_percentage: formData.sws_capacity_percentage,
                    is_sws_trial: formData.is_sws_trial,
                    sws_trial_start_date: formData.sws_trial_start_date || null,
                    annual_guaranteed_hours: formData.role_terms[formData.role_ids[0]]?.annual_guaranteed_hours ?? formData.annual_guaranteed_hours
                })
                .eq('id', existingContract!.id);
            
            if (error) {
                console.error('Update error:', error);
                toast({
                    title: 'Contract Update Failed',
                    description: error.message || 'Failed to update contract.',
                    variant: 'destructive',
                });
                return;
            }
            setOpen(false);
            if (onSuccess) onSuccess();
        } else {
            await submit(roleLevels);
        }
    };

    // Sequential unlocking logic
    const isOrgSelected = !!formData.organization_id;
    const isDeptSelected = !!formData.department_id;
    const isSubDeptSelected = !!formData.sub_department_id;
    const isRoleSelected = formData.role_ids.length > 0;

    /** Check that every selected role has chosen its employment type */
    const allRolesTyped = formData.role_ids.every(
        id => !!formData.role_terms[id]?.employment_status,
    );

    /** role id → its remuneration level */
    const roleLevels = React.useMemo(
        () => Object.fromEntries(
            roles.map(r => [r.id, r.remuneration_level as number | null | undefined]),
        ),
        [roles],
    );

    const allRolesSelected = filteredRoles.length > 0 && formData.role_ids.length === filteredRoles.length;

    const handleSelectAllRoles = () => {
        if (allRolesSelected) {
            updateField('role_ids', []);
        } else {
            const allIds = filteredRoles.map(r => r.id);
            updateField('role_ids', allIds);
            // Default untyped roles to Casual or Full-Time
            allIds.forEach(id => {
                if (!formData.role_terms[id]?.employment_status) {
                    setRoleTerm(id, { employment_status: 'Casual', contracted_weekly_hours: 0, annual_guaranteed_hours: 0 });
                }
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button 
                        variant="outline" 
                        size="sm" 
                        className={cn(
                            "transition-all duration-300 rounded-xl",
                            isEditMode 
                                ? "bg-white/5 hover:bg-primary/20 text-muted-foreground hover:text-primary border-white/10" 
                                : "ml-auto bg-primary/10 hover:bg-primary/20 border-primary/30 text-primary font-bold shadow-md shadow-primary/10"
                        )}
                        onClick={() => loadReferenceData()}
                    >
                        {isEditMode ? (
                            <span className="flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> Edit</span>
                        ) : (
                            <>
                                <Plus className="w-4 h-4 mr-2" />
                                Add Contract
                            </>
                        )}
                    </Button>
                )}
            </DialogTrigger>

            <DialogContent className="w-[96vw] max-w-6xl h-[92vh] max-h-[92vh] flex flex-col gap-0 bg-background dark:bg-[#0b0e14]/98 border border-border text-foreground shadow-2xl backdrop-blur-3xl rounded-[2.5rem] overflow-hidden p-0">
                <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-primary/5 pointer-events-none" />
                
                {/* ── Top Header ────────────────────────────────────────────── */}
                <div className="p-6 sm:p-8 pb-5 flex-shrink-0 border-b border-border bg-muted/20 dark:bg-white/[0.02]">
                    <DialogHeader className="mb-0">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3.5">
                                <div className="p-2.5 rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30 shadow-inner">
                                    <Sparkles className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                    <DialogTitle className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
                                        {isEditMode ? 'Edit Contract' : 'Add Position Contract'}
                                        <span className="text-xs font-semibold px-3 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25">
                                            {employeeName}
                                        </span>
                                    </DialogTitle>
                                    <DialogDescription className="text-muted-foreground text-xs sm:text-sm mt-0.5">
                                        Configure hierarchy, select roles across all 8 remuneration levels individually, and set employment terms.
                                    </DialogDescription>
                                </div>
                            </div>
                            
                            {/* Live Weekly Hours Meter */}
                            <div className={cn(
                                "hidden lg:flex items-center gap-3 px-4 py-2 rounded-2xl border backdrop-blur-md transition-all",
                                isCeilingExceeded
                                    ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300"
                                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-300"
                            )}>
                                <div className="flex flex-col text-right">
                                    <span className="text-[9px] font-black uppercase tracking-wider opacity-70">
                                        Total Contracted Hours
                                    </span>
                                    <span className="text-xs font-bold font-mono">
                                        {fmtHours(ceilingValidation.proposedTotal)}h / {MAX_CONTRACTED_WEEKLY_HOURS}h Cap
                                    </span>
                                </div>
                                <div className={cn(
                                    "w-2.5 h-2.5 rounded-full",
                                    isCeilingExceeded ? "bg-rose-500 animate-pulse" : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                                )} />
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                {/* ── Scrollable Body (Internal Scrolling Container) ──────────── */}
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 sm:p-8 space-y-8 scrollbar-thin scrollbar-thumb-muted-foreground/30 overscroll-contain">
                    
                    {/* ─────────────────────────────────────────────────────────────
                        CENTERED VERTICAL HIERARCHY PIPELINE
                        Select Org -> | -> Select Dept -> | -> Select SubDept -> |
                       ───────────────────────────────────────────────────────────── */}
                    <div className="max-w-md mx-auto flex flex-col items-center justify-center text-center w-full">
                        <div className="mb-3">
                            <span className="text-[10px] font-black tracking-[0.25em] uppercase text-primary bg-primary/10 px-3.5 py-1 rounded-full border border-primary/20">
                                Hierarchy Selection
                            </span>
                        </div>

                        {/* 1. SELECT ORGANISATION */}
                        <div className="w-full relative z-30 shadow-md">
                            <CommandSelector
                                label="Organization"
                                placeholder="Select organization"
                                value={formData.organization_id}
                                options={organizations.map(o => ({ id: o.id, name: o.name }))}
                                onValueChange={(val) => {
                                    updateField('organization_id', val);
                                    updateField('department_id', '');
                                    updateField('sub_department_id', '');
                                    updateField('role_ids', []);
                                }}
                                icon={<Building2 className="w-5 h-5 text-primary" />}
                            />
                        </div>

                        {/* Flow Pipe Connector 1 */}
                        <div className="flex flex-col items-center my-1 select-none">
                            <div className={cn(
                                "w-0.5 h-4 transition-all duration-500",
                                isOrgSelected ? "bg-gradient-to-b from-primary to-primary/60 shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-border"
                            )} />
                            <div className={cn(
                                "w-2 h-2 rounded-full border-2 transition-all duration-500",
                                isOrgSelected ? "bg-primary border-primary ring-2 ring-primary/20 scale-110" : "bg-muted border-border"
                            )} />
                            <div className={cn(
                                "w-0.5 h-4 transition-all duration-500",
                                isOrgSelected ? "bg-gradient-to-b from-primary/60 to-primary shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-border"
                            )} />
                        </div>

                        {/* 2. SELECT DEPARTMENT */}
                        <div className={cn("w-full transition-all duration-300 relative z-20 shadow-md", !isOrgSelected && "opacity-40 pointer-events-none")}>
                            <CommandSelector
                                label="Department"
                                placeholder={isOrgSelected ? "Select department" : "Select organization first"}
                                value={formData.department_id}
                                disabled={!isOrgSelected}
                                options={filteredDepartments.map(d => ({ id: d.id, name: d.name }))}
                                onValueChange={(val) => {
                                    updateField('department_id', val);
                                    updateField('sub_department_id', '');
                                    updateField('role_ids', []);
                                }}
                                icon={<Users className="w-5 h-5 text-primary" />}
                            />
                        </div>

                        {/* Flow Pipe Connector 2 */}
                        <div className="flex flex-col items-center my-1 select-none">
                            <div className={cn(
                                "w-0.5 h-4 transition-all duration-500",
                                isDeptSelected ? "bg-gradient-to-b from-primary to-primary/60 shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-border"
                            )} />
                            <div className={cn(
                                "w-2 h-2 rounded-full border-2 transition-all duration-500",
                                isDeptSelected ? "bg-primary border-primary ring-2 ring-primary/20 scale-110" : "bg-muted border-border"
                            )} />
                            <div className={cn(
                                "w-0.5 h-4 transition-all duration-500",
                                isDeptSelected ? "bg-gradient-to-b from-primary/60 to-primary shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-border"
                            )} />
                        </div>

                        {/* 3. SELECT SUB-DEPARTMENT */}
                        <div className={cn("w-full transition-all duration-300 relative z-10 shadow-md", !isDeptSelected && "opacity-40 pointer-events-none")}>
                            <CommandSelector
                                label="Sub-Department"
                                placeholder={isDeptSelected ? "Select sub-department" : "Select department first"}
                                value={formData.sub_department_id}
                                disabled={!isDeptSelected}
                                options={filteredSubDepartments.map(sd => ({ id: sd.id, name: sd.name }))}
                                onValueChange={(val) => {
                                    updateField('sub_department_id', val);
                                    updateField('role_ids', []);
                                }}
                                icon={<ChevronRight className="w-5 h-5 text-primary" />}
                            />
                        </div>

                        {/* Flow Pipe Connector 3 down to 8 Levels Matrix */}
                        <div className="flex flex-col items-center my-1 select-none">
                            <div className={cn(
                                "w-0.5 h-6 transition-all duration-500",
                                isSubDeptSelected ? "bg-gradient-to-b from-primary to-primary/60 shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-border"
                            )} />
                            <div className={cn(
                                "p-1 rounded-full border transition-all duration-500",
                                isSubDeptSelected ? "bg-primary/20 border-primary text-primary shadow-[0_0_15px_rgba(99,102,241,0.6)]" : "border-border text-muted-foreground/40"
                            )}>
                                <ChevronDown className="w-3.5 h-3.5" />
                            </div>
                        </div>
                    </div>

                    {/* ─────────────────────────────────────────────────────────────
                        INDIVIDUAL 8-LEVEL ROLES CONFIGURATION MATRIX (L7 -> L0)
                        [ Select Button | Role | Employment Type | Contracted Hours ]
                       ───────────────────────────────────────────────────────────── */}
                    <AnimatePresence>
                        {isSubDeptSelected && (
                            <motion.div 
                                initial={{ opacity: 0, y: 25 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                transition={{ duration: 0.45 }}
                                className="w-full max-w-5xl mx-auto space-y-4"
                            >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 rounded-2xl bg-card border border-border shadow-sm">
                                    <div>
                                        <span className="text-[11px] font-black tracking-[0.2em] uppercase text-primary flex items-center gap-2">
                                            <Briefcase className="w-4 h-4" /> Position Roles & Level Configuration (L7 - L0)
                                        </span>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Set the Employment Type and Contracted Hours for each of the 8 levels individually.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2.5">
                                        {!isEditMode && filteredRoles.length > 1 && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={handleSelectAllRoles}
                                                className="text-xs h-9 rounded-xl border-border bg-background hover:bg-primary/10 hover:text-primary transition-all font-semibold"
                                            >
                                                {allRolesSelected ? 'Deselect All' : 'Select All Roles'}
                                            </Button>
                                        )}
                                        {formData.role_ids.length > 0 && (
                                            <span className="px-3.5 py-1.5 rounded-xl bg-primary/15 text-primary border border-primary/25 text-xs font-black">
                                                {formData.role_ids.length} Role{formData.role_ids.length === 1 ? '' : 's'} Selected
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* 8 Levels Matrix Table */}
                                <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden divide-y divide-border">
                                    {/* Table Column Headers */}
                                    <div className="grid grid-cols-12 gap-4 px-6 py-3.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground bg-muted/40 items-center">
                                        <div className="col-span-2 text-left">Select Button</div>
                                        <div className="col-span-4 text-left">Role (L7 - L0)</div>
                                        <div className="col-span-3 text-left">Employment Type</div>
                                        <div className="col-span-3 text-right">Contracted Hours</div>
                                    </div>

                                    {filteredRoles.length === 0 ? (
                                        <div className="p-10 text-center text-sm text-muted-foreground font-medium">
                                            No roles catalogued under this sub-department.
                                        </div>
                                    ) : (
                                        filteredRoles.map((role) => {
                                            const isSelected = formData.role_ids.includes(role.id);
                                            const terms = formData.role_terms[role.id];
                                            const roleStatus = terms?.employment_status ?? '';
                                            const isCasual = roleStatus === 'Casual';
                                            const isFlexible = roleStatus === 'Flexible Part-Time';
                                            const levelNumber = role.remuneration_level != null ? role.remuneration_level : -1;
                                            const levelLabel = levelNumber >= 0 ? `L${levelNumber}` : '—';
                                            
                                            return (
                                                <motion.div
                                                    key={role.id}
                                                    whileHover={{ backgroundColor: 'rgba(0, 0, 0, 0.02)' }}
                                                    className={cn(
                                                        "grid grid-cols-12 gap-4 px-6 py-3.5 items-center transition-all duration-200",
                                                        isSelected
                                                            ? "bg-primary/5 dark:bg-primary/10 border-l-4 border-l-primary"
                                                            : "border-l-4 border-l-transparent opacity-80 hover:opacity-100"
                                                    )}
                                                >
                                                    {/* 1. SELECT BUTTON (Circle & Tick only) */}
                                                    <div className="col-span-2 flex items-center text-left pl-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleRole(role.id)}
                                                            aria-label={isSelected ? `Deselect ${role.name}` : `Select ${role.name}`}
                                                            className={cn(
                                                                "w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer shrink-0",
                                                                isSelected
                                                                    ? "bg-primary text-primary-foreground border-2 border-primary shadow-sm shadow-primary/30"
                                                                    : "border-2 border-muted-foreground/40 hover:border-primary bg-transparent"
                                                            )}
                                                        >
                                                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                                        </button>
                                                    </div>

                                                    {/* 2. ROLE & LEVEL */}
                                                    <div className="col-span-4 flex items-center gap-3 min-w-0 text-left">
                                                        <span className={cn(
                                                            "px-2.5 py-1 rounded-lg text-xs font-black font-mono border shrink-0",
                                                            levelNumber === 7 ? "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30" :
                                                            levelNumber === 6 ? "bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30" :
                                                            levelNumber === 5 ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30" :
                                                            levelNumber === 4 ? "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30" :
                                                            levelNumber === 3 ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30" :
                                                            levelNumber === 2 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30" :
                                                            levelNumber === 1 ? "bg-teal-500/15 text-teal-600 dark:text-teal-300 border-teal-500/30" :
                                                            "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30"
                                                        )}>
                                                            {levelLabel}
                                                        </span>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className={cn(
                                                                "text-sm font-bold truncate",
                                                                isSelected ? "text-foreground font-black" : "text-foreground/80"
                                                            )}>
                                                                {role.name}
                                                            </span>
                                                            <span className="text-[10px] text-muted-foreground truncate">
                                                                {role.employment_type ? `Catalogued as ${role.employment_type}` : 'General Role'}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* 3. EMPLOYMENT TYPE SELECTOR */}
                                                    <div className="col-span-3 flex items-center text-left">
                                                        {isSelected ? (
                                                            <EmploymentTypeDropdown
                                                                value={roleStatus}
                                                                onChange={(val) => setRoleTerm(role.id, { employment_status: val })}
                                                                ariaLabel={`Employment type for ${role.name}`}
                                                                widthClassName="w-48"
                                                            />
                                                        ) : (
                                                            <span className="text-muted-foreground/40 text-xs font-mono pl-3">—</span>
                                                        )}
                                                    </div>

                                                    {/* 4. CONTRACTED HOURS INPUT (Square Box, WCAG/ARIA compliant) */}
                                                    <div className="col-span-3 flex items-center justify-end gap-2 text-right">
                                                        {!isSelected || !roleStatus ? (
                                                            <span className="text-muted-foreground/40 text-xs font-mono pr-4">—</span>
                                                        ) : (
                                                            <div className="flex items-center gap-1.5 justify-end">
                                                                <label htmlFor={`role-hours-${role.id}`} className="sr-only">
                                                                    {role.name} {isFlexible ? 'annual guaranteed hours' : 'contracted weekly hours'}
                                                                </label>
                                                                <Input
                                                                    id={`role-hours-${role.id}`}
                                                                    name={`contracted_hours_${role.id}`}
                                                                    type="number"
                                                                    inputMode="decimal"
                                                                    role="spinbutton"
                                                                    aria-label={`Contracted ${isFlexible ? 'annual' : 'weekly'} hours for ${role.name}`}
                                                                    aria-valuemin={0}
                                                                    aria-valuemax={isFlexible ? FLEXIBLE_PT_ANNUAL_HOURS_MAX : MAX_CONTRACTED_WEEKLY_HOURS}
                                                                    aria-valuenow={isCasual ? 0 : isFlexible ? (terms?.annual_guaranteed_hours ?? FLEXIBLE_PT_ANNUAL_HOURS_MIN) : (terms?.contracted_weekly_hours ?? 0)}
                                                                    aria-valuetext={isCasual ? '0 hours (Casual contract)' : `${isFlexible ? terms?.annual_guaranteed_hours ?? FLEXIBLE_PT_ANNUAL_HOURS_MIN : terms?.contracted_weekly_hours ?? 0} hours per ${isFlexible ? 'year' : 'week'}`}
                                                                    aria-required={isSelected && !isCasual}
                                                                    aria-invalid={isCeilingExceeded || isFptHoursInvalid}
                                                                    disabled={isCasual}
                                                                    min={isFlexible ? FLEXIBLE_PT_ANNUAL_HOURS_MIN : 0}
                                                                    max={isFlexible ? FLEXIBLE_PT_ANNUAL_HOURS_MAX : MAX_CONTRACTED_WEEKLY_HOURS}
                                                                    value={isCasual ? 0 : isFlexible
                                                                        ? (terms?.annual_guaranteed_hours ?? FLEXIBLE_PT_ANNUAL_HOURS_MIN)
                                                                        : (terms?.contracted_weekly_hours ?? 0)}
                                                                    onChange={(e) => setRoleTerm(role.id, isFlexible
                                                                        ? { annual_guaranteed_hours: parseFloat(e.target.value) || 0 }
                                                                        : { contracted_weekly_hours: parseFloat(e.target.value) || 0 })}
                                                                    className={cn(
                                                                        "h-10 w-20 text-right tabular-nums text-xs font-bold rounded-md border",
                                                                        "bg-background text-foreground border-input",
                                                                        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                                                        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:border-primary",
                                                                        isCasual && "opacity-40 cursor-not-allowed bg-muted/40 border-border"
                                                                    )}
                                                                />
                                                                <span className="text-xs font-semibold text-foreground/80 font-mono w-8 text-left select-none" aria-hidden="true">
                                                                    {isFlexible ? 'h/yr' : 'h/wk'}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            );
                                        })
                                    )}
                                </div>

                                {/* Problems & Warnings Callout */}
                                {(isCeilingExceeded || mixedPermanentConflict || isFptHoursInvalid) && (
                                    <motion.div 
                                        initial={{ opacity: 0, scale: 0.98 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="p-4 rounded-2xl border border-destructive/40 bg-destructive/10 flex items-center gap-3 text-destructive text-xs font-medium"
                                    >
                                        <AlertTriangle className="w-5 h-5 shrink-0" />
                                        <div className="space-y-0.5 text-left">
                                            {isCeilingExceeded && (
                                                <p>Contracted hours total {fmtHours(ceilingValidation.proposedTotal)}h/week, exceeding the {MAX_CONTRACTED_WEEKLY_HOURS}h maximum weekly ceiling.</p>
                                            )}
                                            {mixedPermanentConflict && (
                                                <p>{mixedPermanentConflict}</p>
                                            )}
                                            {isFptHoursInvalid && (
                                                <p>Flexible Part-Time annual guaranteed hours must be between {FLEXIBLE_PT_ANNUAL_HOURS_MIN} and {FLEXIBLE_PT_ANNUAL_HOURS_MAX}h/year (cl 12.4).</p>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* ─────────────────────────────────────────────────────────────
                        FOOTER SECTION: APPRENTICE / TRAINEE / SWS SPECIAL CONFIGS
                       ───────────────────────────────────────────────────────────── */}
                    <div className="max-w-5xl mx-auto pt-6 space-y-4">
                        <div className="text-center border-b border-border pb-3">
                            <span className="text-[10px] font-black tracking-[0.25em] uppercase text-muted-foreground inline-flex items-center gap-1.5 bg-muted/40 px-4 py-1.5 rounded-full border border-border">
                                <ShieldCheck className="w-4 h-4 text-emerald-500" /> Award Schedules & Special Conditions (Optional)
                            </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                            {/* 1. Apprentice Mode Card */}
                            <div className={cn(
                                "p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between shadow-sm",
                                formData.is_apprentice 
                                    ? "bg-indigo-500/10 border-indigo-500/40 shadow-indigo-500/10" 
                                    : "bg-card border-border hover:border-border/80"
                            )}>
                                <div>
                                    <div 
                                        className="flex items-center justify-between cursor-pointer select-none"
                                        onClick={() => updateField('is_apprentice', !formData.is_apprentice)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={cn(
                                                "p-2.5 rounded-xl transition-all",
                                                formData.is_apprentice ? "bg-indigo-500/20 text-indigo-600 dark:text-indigo-300" : "bg-muted text-muted-foreground"
                                            )}>
                                                <GraduationCap className="w-5 h-5" />
                                            </div>
                                            <div className="text-left">
                                                <h4 className="text-sm font-bold text-foreground">Apprentice Mode</h4>
                                                <p className="text-[10px] text-muted-foreground">Schedule 4 Wage Alignment</p>
                                            </div>
                                        </div>

                                        <div className={cn(
                                            "w-11 h-6 rounded-full relative transition-all duration-300",
                                            formData.is_apprentice ? "bg-indigo-500" : "bg-muted border border-border"
                                        )}>
                                            <motion.div 
                                                animate={{ x: formData.is_apprentice ? 22 : 2 }}
                                                className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                                            />
                                        </div>
                                    </div>

                                    {/* Expandable Apprentice Settings */}
                                    <AnimatePresence>
                                        {formData.is_apprentice && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="mt-4 pt-4 border-t border-indigo-500/20 space-y-4 overflow-hidden text-left"
                                            >
                                                <div className="space-y-1.5">
                                                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Apprentice Type</span>
                                                    <div className="grid grid-cols-3 gap-1.5">
                                                        {[
                                                            { id: 'standard', name: 'Standard' },
                                                            { id: 'adult', name: 'Adult (21+)' },
                                                            { id: 'school_based', name: 'School' }
                                                        ].map((t) => (
                                                            <button
                                                                key={t.id}
                                                                type="button"
                                                                onClick={() => updateField('apprentice_type', t.id)}
                                                                className={cn(
                                                                    "px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all truncate",
                                                                    formData.apprentice_type === t.id
                                                                        ? "bg-indigo-500/25 border-indigo-500/60 text-indigo-700 dark:text-indigo-200"
                                                                        : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                                )}
                                                            >
                                                                {t.name}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Training Year</span>
                                                    <div className="grid grid-cols-4 gap-1">
                                                        {[1, 2, 3, 4].map(year => (
                                                            <button
                                                                key={year}
                                                                type="button"
                                                                onClick={() => updateField('apprentice_year', year)}
                                                                className={cn(
                                                                    "h-7 rounded-lg text-[11px] font-bold border transition-all",
                                                                    formData.apprentice_year === year
                                                                        ? "bg-indigo-500 text-white border-indigo-400"
                                                                        : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                                )}
                                                            >
                                                                Yr {year}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 pt-1">
                                                    <input
                                                        id="apprentice-year12"
                                                        type="checkbox"
                                                        checked={!!formData.has_completed_year_12}
                                                        onChange={() => updateField('has_completed_year_12', !formData.has_completed_year_12)}
                                                        className="h-4 w-4 rounded border-border accent-indigo-500"
                                                    />
                                                    <label htmlFor="apprentice-year12" className="text-xs text-foreground cursor-pointer select-none">
                                                        Completed Year 12
                                                    </label>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>

                            {/* 2. Trainee Mode Card */}
                            <div className={cn(
                                "p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between shadow-sm",
                                formData.is_trainee 
                                    ? "bg-purple-500/10 border-purple-500/40 shadow-purple-500/10" 
                                    : "bg-card border-border hover:border-border/80"
                            )}>
                                <div>
                                    <div 
                                        className="flex items-center justify-between cursor-pointer select-none"
                                        onClick={() => updateField('is_trainee', !formData.is_trainee)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={cn(
                                                "p-2.5 rounded-xl transition-all",
                                                formData.is_trainee ? "bg-purple-500/20 text-purple-600 dark:text-purple-300" : "bg-muted text-muted-foreground"
                                            )}>
                                                <BookOpen className="w-5 h-5" />
                                            </div>
                                            <div className="text-left">
                                                <h4 className="text-sm font-bold text-foreground">Trainee Mode</h4>
                                                <p className="text-[10px] text-muted-foreground">Schedule 5 Wage Matrix</p>
                                            </div>
                                        </div>

                                        <div className={cn(
                                            "w-11 h-6 rounded-full relative transition-all duration-300",
                                            formData.is_trainee ? "bg-purple-500" : "bg-muted border border-border"
                                        )}>
                                            <motion.div 
                                                animate={{ x: formData.is_trainee ? 22 : 2 }}
                                                className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                                            />
                                        </div>
                                    </div>

                                    {/* Expandable Trainee Settings */}
                                    <AnimatePresence>
                                        {formData.is_trainee && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="mt-4 pt-4 border-t border-purple-500/20 space-y-4 overflow-hidden text-left"
                                            >
                                                <div className="space-y-1.5">
                                                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Category</span>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {['junior', 'adult'].map((cat) => (
                                                            <button
                                                                key={cat}
                                                                type="button"
                                                                onClick={() => updateField('trainee_category', cat)}
                                                                className={cn(
                                                                    "py-1.5 rounded-lg text-[10px] font-bold uppercase border transition-all",
                                                                    formData.trainee_category === cat
                                                                        ? "bg-purple-500/25 border-purple-500/60 text-purple-700 dark:text-purple-200"
                                                                        : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                                )}
                                                            >
                                                                {cat}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Wage Level</span>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {['A', 'B'].map((lvl) => (
                                                            <button
                                                                key={lvl}
                                                                type="button"
                                                                onClick={() => updateField('trainee_level', lvl)}
                                                                className={cn(
                                                                    "py-1 rounded-lg text-[11px] font-bold border transition-all",
                                                                    formData.trainee_level === lvl
                                                                        ? "bg-purple-500 text-white border-purple-400"
                                                                        : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                                                                )}
                                                            >
                                                                Level {lvl}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>

                            {/* 3. Supported Wage System (SWS) Card */}
                            <div className={cn(
                                "p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between shadow-sm",
                                formData.is_sws 
                                    ? "bg-emerald-500/10 border-emerald-500/40 shadow-emerald-500/10" 
                                    : "bg-card border-border hover:border-border/80"
                            )}>
                                <div>
                                    <div 
                                        className="flex items-center justify-between cursor-pointer select-none"
                                        onClick={() => updateField('is_sws', !formData.is_sws)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={cn(
                                                "p-2.5 rounded-xl transition-all",
                                                formData.is_sws ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                                            )}>
                                                <Accessibility className="w-5 h-5" />
                                            </div>
                                            <div className="text-left">
                                                <h4 className="text-sm font-bold text-foreground">Supported Wage (SWS)</h4>
                                                <p className="text-[10px] text-muted-foreground">Schedule 6 Compliance</p>
                                            </div>
                                        </div>

                                        <div className={cn(
                                            "w-11 h-6 rounded-full relative transition-all duration-300",
                                            formData.is_sws ? "bg-emerald-500" : "bg-muted border border-border"
                                        )}>
                                            <motion.div 
                                                animate={{ x: formData.is_sws ? 22 : 2 }}
                                                className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                                            />
                                        </div>
                                    </div>

                                    {/* Expandable SWS Settings */}
                                    <AnimatePresence>
                                        {formData.is_sws && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="mt-4 pt-4 border-t border-emerald-500/20 space-y-4 overflow-hidden text-left"
                                            >
                                                <div className="space-y-1.5">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Assessed Capacity</span>
                                                        <span className="text-xs font-black text-emerald-500 font-mono">{formData.sws_capacity_percentage}%</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min={10}
                                                        max={90}
                                                        step={10}
                                                        value={formData.sws_capacity_percentage}
                                                        onChange={(e) => updateField('sws_capacity_percentage', parseInt(e.target.value))}
                                                        className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-muted rounded-lg"
                                                    />
                                                </div>

                                                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-700 dark:text-emerald-200/80 leading-relaxed">
                                                    Schedule 6: Absolute minimum payable rate is ${SWS_MIN_WEEKLY_PAY}/week baseline regardless of capacity.
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Fixed Sticky Footer Action Bar ────────────────────────── */}
                <div className="p-6 px-8 bg-muted/20 dark:bg-white/[0.02] border-t border-border flex-shrink-0">
                    <DialogFooter className="flex-col sm:flex-row items-center justify-between gap-4 w-full">
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {!isRoleSelected ? (
                                <span>Select at least one role above.</span>
                            ) : !allRolesTyped ? (
                                <span className="text-amber-500 font-medium">Every selected role needs an Employment Type.</span>
                            ) : (
                                <span className="font-semibold text-foreground flex items-center gap-2">
                                    <span className="text-primary font-bold">{formData.role_ids.length} role(s)</span>
                                    <span>•</span>
                                    <span>{positions.length} position appointment(s)</span>
                                    <span>•</span>
                                    <span className="text-emerald-500 font-mono font-bold">{fmtHours(totalWeeklyHours)}h/wk</span>
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                            <Button 
                                variant="ghost" 
                                onClick={() => setOpen(false)}
                                className="rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                            >
                                Cancel
                            </Button>
                            <Button 
                                onClick={handleSubmit} 
                                disabled={isSubmitting || isLoadingRefs || !isRoleSelected || !allRolesTyped || isFptHoursInvalid || isCeilingExceeded || !!mixedPermanentConflict}
                                className={cn(
                                    "rounded-xl px-8 h-11 transition-all duration-300 font-bold shadow-md",
                                    isRoleSelected && allRolesTyped && !isCeilingExceeded && !mixedPermanentConflict
                                        ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/30 active:scale-95 cursor-pointer" 
                                        : "bg-muted text-muted-foreground cursor-not-allowed"
                                )}
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Saving…
                                    </>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        {isEditMode ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                        {isEditMode ? 'Save Changes' : 'Add Position Contract'}
                                    </span>
                                )}
                            </Button>
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default AddContractDialog;
