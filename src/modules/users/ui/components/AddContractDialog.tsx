import React, { useState } from 'react'; // Re-triggering build
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import { Plus, Building2, Users, ChevronRight, Briefcase, DollarSign, Loader2, Sparkles, CheckCircle2, Pencil } from 'lucide-react';
import { useReferenceData } from '../hooks/useReferenceData';
import { useContractForm } from '../hooks/useContractForm';
import { CommandSelector } from './CommandSelector';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { supabase } from '@/platform/realtime/client';

interface AddContractDialogProps {
    employeeId: string;
    employeeName: string;
    existingContract?: {
        id: string;
        organization_id?: string | null;
        department_id?: string | null;
        sub_department_id?: string | null;
        role_id: string;
        rem_level_id?: string | null;
        employment_status?: string | null;
    };
    onSuccess?: () => void;
}

export const AddContractDialog: React.FC<AddContractDialogProps> = ({ employeeId, employeeName, existingContract, onSuccess }) => {
    const [open, setOpen] = useState(false);

    // Hooks
    const {
        organizations, departments, subDepartments, roles, remLevels,
        isLoading: isLoadingRefs, loadReferenceData
    } = useReferenceData(open);

    const {
        formData, isSubmitting, updateField, updateRole, submit, setFormData
    } = useContractForm(employeeId, () => {
        setOpen(false);
        if (onSuccess) onSuccess();
    });

    // Determines if we are in Edit Mode
    const isEditMode = !!existingContract;

    // Pre-fill form when editing
    React.useEffect(() => {
        if (open && existingContract) {
            setFormData({
                organization_id: existingContract.organization_id || '',
                department_id: existingContract.department_id || '',
                sub_department_id: existingContract.sub_department_id || '',
                role_id: existingContract.role_id,
                rem_level_id: existingContract.rem_level_id || '',
                employment_status: (existingContract.employment_status as any) || 'Casual'
            });
        } else if (open && !existingContract) {
            setFormData({
                organization_id: '',
                department_id: '',
                sub_department_id: '',
                role_id: '',
                rem_level_id: '',
                employment_status: 'Casual'
            });
        }
    }, [open, existingContract, setFormData]);

    // Filtered options based on form selection
    const filteredDepartments = departments.filter(d => d.organization_id === formData.organization_id);
    const filteredSubDepartments = subDepartments.filter(sd => sd.department_id === formData.department_id);
    
    // Clean role names (remove L0, L1 redundancy)
    const cleanRoleName = (name: string) => name.replace(/\s*\(L\d+\)$/i, '').trim();
    
    const filteredRoles = roles
        .filter(r => r.sub_department_id === formData.sub_department_id)
        .map(r => ({ ...r, name: cleanRoleName(r.name) }));

    const handleSubmit = async () => {
        if (isEditMode) {
            // Implement update logic here or in useContractForm
            const { error } = await supabase
                .from('user_contracts')
                .update({
                    organization_id: formData.organization_id,
                    department_id: formData.department_id,
                    sub_department_id: formData.sub_department_id,
                    role_id: formData.role_id,
                    rem_level_id: formData.rem_level_id,
                    employment_status: formData.employment_status as any
                })
                .eq('id', existingContract!.id);
            
            if (error) {
                console.error('Update error:', error);
                return;
            }
            setOpen(false);
            if (onSuccess) onSuccess();
        } else {
            await submit();
        }
    };

    // Sequential unlocking logic
    const isOrgSelected = !!formData.organization_id;
    const isDeptSelected = !!formData.department_id;
    const isSubDeptSelected = !!formData.sub_department_id;
    const isRoleSelected = !!formData.role_id;

    // Prefilled/Locked data logic
    const selectedRole = roles.find(r => r.id === formData.role_id);
    const selectedRemLevel = remLevels.find(rl => rl.id === formData.rem_level_id);
    const isRemLocked = !!formData.role_id && !!selectedRole?.remuneration_level_id;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button 
                    variant="outline" 
                    size="sm" 
                    className={cn(
                        "transition-all duration-300",
                        isEditMode 
                            ? "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary" 
                            : "ml-auto bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary"
                    )}
                    onClick={() => loadReferenceData()}
                >
                    {isEditMode ? (
                        <Pencil className="w-4 h-4" />
                    ) : (
                        <>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Contract
                        </>
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-xl bg-[#0b0e14]/95 border-border/40 text-foreground shadow-2xl backdrop-blur-2xl rounded-[2rem] overflow-hidden p-0">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
                
                <div className="p-8 pb-4">
                    <DialogHeader className="mb-6">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 rounded-xl bg-primary/10 text-primary shadow-inner">
                                <Sparkles className="w-5 h-5" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-bold tracking-tight">
                                    {isEditMode ? 'Edit Contract' : 'Add Contract'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground/60">
                                    {isEditMode ? 'Update existing' : 'Create a new'} organizational role for {employeeName}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="flex flex-col gap-6 py-2 relative">
                        {/* Progress Line */}
                        <div className="absolute left-6 top-8 bottom-8 w-[1px] bg-gradient-to-b from-primary/50 via-primary/20 to-transparent opacity-20 pointer-events-none" />

                        {/* 1. Organization */}
                        <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4 }}
                        >
                            <CommandSelector
                                label="Organization"
                                placeholder="Select organization"
                                value={formData.organization_id}
                                options={organizations}
                                onValueChange={(val) => updateField('organization_id', val)}
                                icon={<Building2 className="w-5 h-5" />}
                            />
                        </motion.div>

                        {/* 2. Department */}
                        <AnimatePresence>
                            {isOrgSelected && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0, y: 10 }}
                                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                                    exit={{ opacity: 0, height: 0, y: 10 }}
                                    transition={{ duration: 0.5, ease: "easeOut" }}
                                >
                                    <CommandSelector
                                        label="Department"
                                        placeholder="Select department"
                                        value={formData.department_id}
                                        options={filteredDepartments}
                                        onValueChange={(val) => updateField('department_id', val)}
                                        icon={<Users className="w-5 h-5" />}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* 3. Sub-Department */}
                        <AnimatePresence>
                            {isDeptSelected && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0, y: 10 }}
                                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                                    exit={{ opacity: 0, height: 0, y: 10 }}
                                    transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
                                >
                                    <CommandSelector
                                        label="Sub-Department"
                                        placeholder="Select sub-department"
                                        value={formData.sub_department_id}
                                        options={filteredSubDepartments}
                                        onValueChange={(val) => updateField('sub_department_id', val)}
                                        icon={<ChevronRight className="w-5 h-5" />}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* 4. Role */}
                        <AnimatePresence>
                            {isSubDeptSelected && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0, y: 10 }}
                                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                                    exit={{ opacity: 0, height: 0, y: 10 }}
                                    transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 }}
                                >
                                    <CommandSelector
                                        label="Role"
                                        placeholder="Select role"
                                        value={formData.role_id}
                                        options={filteredRoles}
                                        onValueChange={(val) => {
                                            const role = roles.find(r => r.id === val);
                                            updateRole(val, role?.remuneration_level_id, role?.employment_type);
                                        }}
                                        icon={<Briefcase className="w-5 h-5" />}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* 5. Remuneration & Employment (Locked) */}
                        <AnimatePresence>
                            {isRoleSelected && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0, y: 10 }}
                                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                                    transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
                                    className="grid grid-cols-2 gap-4 mt-2 p-4 rounded-2xl bg-primary/5 border border-primary/10 shadow-inner"
                                >
                                    <div className="space-y-1">
                                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold flex items-center gap-1.5">
                                            <DollarSign className="w-3 h-3" /> Remuneration
                                        </Label>
                                        <div className="text-sm font-semibold text-primary/90 flex items-center gap-2">
                                            {selectedRemLevel ? (
                                                <>
                                                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-xs">L{selectedRemLevel.level_number}</span>
                                                    <span>{selectedRemLevel.level_name}</span>
                                                </>
                                            ) : '—'}
                                        </div>
                                    </div>
                                    <div className="space-y-1 border-l border-border/40 pl-4">
                                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold flex items-center gap-1.5">
                                            <Briefcase className="w-3 h-3" /> Type
                                        </Label>
                                        <div className="text-sm font-semibold text-primary/90 flex items-center gap-2">
                                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                            {formData.employment_status || '—'}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                <div className="p-8 pt-4 bg-muted/20 border-t border-border/20">
                    <DialogFooter className="gap-3 sm:gap-0">
                        <Button 
                            variant="ghost" 
                            onClick={() => setOpen(false)}
                            className="rounded-xl hover:bg-muted/50 transition-all duration-300"
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleSubmit} 
                            disabled={isSubmitting || isLoadingRefs || !isRoleSelected}
                            className={cn(
                                "rounded-xl px-8 transition-all duration-500 font-bold shadow-lg shadow-primary/20",
                                isRoleSelected ? "bg-primary hover:bg-primary/90 scale-100" : "bg-muted-foreground/20 scale-95 opacity-50"
                            )}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Synchronizing...
                                </>
                            ) : (
                                <span className="flex items-center gap-2">
                                    {isEditMode ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                    {isEditMode ? 'Update Contract' : 'Add Contract'}
                                </span>
                            )}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
};
