import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent } from '@/modules/core/ui/primitives/dialog';
import { Form } from '@/modules/core/ui/primitives/form';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/modules/core/hooks/use-toast';
import { shiftsApi as enhancedShiftService } from '@/modules/rosters/api/shifts.api';
import { supabase } from '@/platform/realtime/client';
import { format, isBefore, startOfDay, parse } from 'date-fns';
import { useCreateShift, useUpdateShift } from '@/modules/rosters/state/useRosterShifts';

// Types and Schema
import { formSchema, FormValues, EnhancedAddShiftModalProps } from './types';
import { calculateShiftLength, isDateInPast, isShiftStarted } from './utils';
import { SYDNEY_TZ, formatInTimezone, isPastInTimezone, getTodayInTimezone } from '@/modules/core/lib/date.utils';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

// Hooks
import { useShiftFormData, useHardValidation, useStepNavigation, useComplianceRunner } from './hooks';

// Components
import {
    ModalHeader,
    ContextBar,
    ModalFooter,
    CancelConfirmDialog,
    ScheduleStep,
    RoleStep,
    RequirementsStep,
    NotesStep,
    ComplianceStep,
    ReviewLogsStep,
    StepIndicator,
} from './components';

export const EnhancedAddShiftModal: React.FC<EnhancedAddShiftModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    context,
    isTemplateMode = false,
    editMode = false,
    existingShift,
    onShiftCreated,
}) => {
    const safeContext = context ?? {};
    const { toast } = useToast();
    // const [isLoading, setIsLoading] = useState(false); // NOW DERIVED
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [selectedRosterId, setSelectedRosterId] = useState<string>(safeContext.rosterId || '');

    // Scope filter for global hierarchy
    const { scope, scopeTree } = useScopeFilter('managerial');

    // Mutations
    const createShiftMutation = useCreateShift();
    const updateShiftMutation = useUpdateShift();
    const isLoading = createShiftMutation.isPending || updateShiftMutation.isPending;

    // Compliance state
    const [complianceHasRun, setComplianceHasRun] = useState(false);
    const [complianceNeedsRerun, setComplianceNeedsRerun] = useState(false);
    const [complianceResults, setComplianceResults] = useState<Record<string, any>>({});

    // Form setup
    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            group_type: (safeContext.groupName?.toLowerCase().replace(/\s+/g, '_') as any) || undefined,
            sub_group_name: safeContext.subGroupName || '',
            role_id: safeContext.roleId || '',
            remuneration_level_id: safeContext.remunerationLevelId || '',
            shift_date: safeContext.date ? new Date(safeContext.date) : undefined,
            start_time: safeContext.eventStartTime || '',
            end_time: safeContext.eventEndTime || '',
            paid_break_minutes: undefined,
            unpaid_break_minutes: undefined,
            timezone: 'Australia/Sydney',
            assigned_employee_id: safeContext.employeeId || null,
            required_skills: [],
            required_licenses: [],
            event_ids: [],
            notes: '',
        },
    });

    // Watch form values
    const watchStart = form.watch('start_time');
    const watchEnd = form.watch('end_time');
    const watchUnpaidBreak = form.watch('unpaid_break_minutes');
    const watchRoleId = form.watch('role_id');
    const watchSkills = form.watch('required_skills');
    const watchLicenses = form.watch('required_licenses');
    const watchEmployeeId = form.watch('assigned_employee_id');
    const watchShiftDate = form.watch('shift_date');
    const watchRemLevel = form.watch('remuneration_level_id');
    const watchTimezone = form.watch('timezone') || SYDNEY_TZ;

    // Load form data
    const {
        roles,
        remunerationLevels,
        employees,
        skills,
        licenses,
        events,
        rosters,
        rosterStructure,
        activeSubGroups,
        isLoadingData,
    } = useShiftFormData({
        isOpen,
        context: safeContext,
        editMode,
        existingShift,
        selectedRosterId,
        setSelectedRosterId,
    });

    // Reset form when modal opens with new context
    useEffect(() => {
        if (isOpen && !editMode) {
            console.log('[EnhancedAddShiftModal] Resetting form with context:', safeContext);
            form.reset({
                group_type: (safeContext.groupName?.toLowerCase().replace(/\s+/g, '_') as any) || undefined,
                sub_group_name: safeContext.subGroupName || '',
                role_id: safeContext.roleId || '',
                remuneration_level_id: safeContext.remunerationLevelId || '',
                shift_date: safeContext.date ? new Date(safeContext.date) : undefined,
                start_time: safeContext.eventStartTime || '',
                end_time: safeContext.eventEndTime || '',
                paid_break_minutes: undefined,
                unpaid_break_minutes: undefined,
                timezone: 'Australia/Sydney',
                assigned_employee_id: safeContext.employeeId || null,
                required_skills: [],
                required_licenses: [],
                event_ids: [],
                notes: '',
            });
        }
    }, [isOpen, safeContext, editMode, form]);

    // Force sync of Role/Level if they are in context but not yet set in form (e.g. data loaded late)
    useEffect(() => {
        if (isOpen && !editMode && safeContext.roleId && !watchRoleId && roles.length > 0) {
            const match = roles.find(r => r.id === safeContext.roleId);
            if (match) {
                console.log('[EnhancedAddShiftModal] late-sync match found:', match.name, match.id);
                form.setValue('role_id', match.id);
                if (match.remuneration_level_id) {
                    form.setValue('remuneration_level_id', match.remuneration_level_id);
                }
            } else {
                console.warn('[EnhancedAddShiftModal] late-sync: safeContext.roleId not found in roles array!', {
                    contextRoleId: safeContext.roleId,
                    availableRoles: roles.map(r => ({ id: r.id, name: r.name }))
                });
            }
        }
    }, [isOpen, editMode, safeContext.roleId, watchRoleId, roles, form]);



    // Resolve UUIDs for Group/SubGroup from Roster Data
    // Context only has Names (strings) from the Grid View, but DB needs UUIDs.
    const resolvedContext = useMemo(() => {
        // 1. Resolve IDs from context (which comes from page banner/grid launch)
        // RostersPlannerPage syncs banner scope to selectedDepartmentIds/selectedSubDepartmentIds
        const orgId = safeContext.organizationId;
        const deptId = safeContext.departmentId || safeContext.departmentIds?.[0];
        const subDeptId = safeContext.subDepartmentId || safeContext.subDepartmentIds?.[0];

        // 2. Resolve names from scopeTree (for display in HierarchyColumn)
        // If IDs are missing (All Departments), info will be undefined, falling back to 'All...' labels
        const orgInfo = scopeTree?.organizations?.find(o => o.id === orgId);
        const deptInfo = orgInfo?.departments?.find(d => d.id === deptId);
        const subDeptInfo = deptInfo?.subdepartments?.find(sd => sd.id === subDeptId);

        const roster = rosters.find(r => r.id === (selectedRosterId || safeContext.rosterId));

        let groupId = safeContext.groupId;
        let subGroupId = safeContext.subGroupId;

        if (roster && (safeContext.groupName || safeContext.group_type) && !groupId) {
            const searchName = safeContext.groupName?.trim().toLowerCase();
            const searchType = safeContext.group_type;

            // Find group by external_id (group_type) FIRST, then fallback to name
            const group = roster.groups?.find(g => {
                if (searchType && g.external_id === searchType) return true;
                if (!searchName) return false;

                const dbName = g.name.trim().toLowerCase();
                const normalizedDbName = dbName.replace(/\s+/g, '_');
                return dbName === searchName || normalizedDbName === searchName;
            });

            if (group) {
                groupId = group.id;

                // Find sub-group by name (flexible)
                if (safeContext.subGroupName && !subGroupId) {
                    const subSearchName = safeContext.subGroupName.trim().toLowerCase();
                    const subGroup = group.subGroups?.find(sg => {
                        const dbSubName = sg.name.trim().toLowerCase();
                        const normalizedDbSubName = dbSubName.replace(/\s+/g, '_');
                        return dbSubName === subSearchName || normalizedDbSubName === subSearchName;
                    });
                    if (subGroup) subGroupId = subGroup.id;
                }
            }
        }

        // 3. IMPORTANT: Sync hierarchy with roster scope if roster is found
        // If the found roster is "Global" (null department), we should reflect that in the hierarchy
        // instead of sticking to the restrictive launch context.
        const effectiveDeptId = roster ? (roster.department_id || null) : deptId;
        const effectiveSubDeptId = roster ? (roster.sub_department_id || null) : subDeptId;

        // Re-resolve names based on effective IDs
        const effectiveDeptInfo = orgInfo?.departments?.find(d => d.id === effectiveDeptId);
        const effectiveSubDeptInfo = effectiveDeptInfo?.subdepartments?.find(sd => sd.id === effectiveSubDeptId);

        return {
            ...safeContext,
            organizationId: orgId,
            organizationName: orgInfo?.name || safeContext.organizationName,
            departmentId: effectiveDeptId,
            departmentName: effectiveDeptInfo?.name || (effectiveDeptId === null ? 'All Departments' : safeContext.departmentName),
            subDepartmentId: effectiveSubDeptId,
            subDepartmentName: effectiveSubDeptInfo?.name || (effectiveSubDeptId === null ? 'All Sub-Departments' : safeContext.subDepartmentName),
            groupId: groupId || safeContext.groupId,
            subGroupId: subGroupId || safeContext.subGroupId
        };
    }, [scope, scopeTree, rosters, selectedRosterId, safeContext]);

    // Hard validation
    const { hardValidation, employeeExistingShifts } = useHardValidation({
        watchStart,
        watchEnd,
        watchShiftDate,
        watchEmployeeId,
        isTemplateMode,
        existingShiftId: existingShift?.id,
        timezone: watchTimezone,
    });

    // Calculated values
    const shiftLength = useMemo(
        () => calculateShiftLength(watchStart, watchEnd),
        [watchStart, watchEnd]
    );

    const netLength = useMemo(() => {
        const unpaid = watchUnpaidBreak || 0;
        return Math.max(0, shiftLength - unpaid / 60);
    }, [shiftLength, watchUnpaidBreak]);

    const selectedRemLevel = remunerationLevels.find((r) => r.id === watchRemLevel);
    const isNetLengthValid = netLength > 0 && netLength <= 12;

    // Read-only checks
    const isPast = useMemo(() => isDateInPast(watchShiftDate, watchTimezone), [watchShiftDate, watchTimezone]);
    const isStarted = useMemo(
        () => isShiftStarted(watchShiftDate, watchStart, watchTimezone),
        [watchShiftDate, watchStart, watchTimezone]
    );
    const isPublished = useMemo(
        () => !isTemplateMode && existingShift?.lifecycle_status === 'Published',
        [isTemplateMode, existingShift]
    );
    const isReadOnly = isPast || isStarted || isPublished;

    const isGridLaunch = safeContext.launchSource === 'grid';
    const isEditModeSource = safeContext.launchSource === 'edit';

    // Context checks
    const hasDepartment = !!resolvedContext.departmentId;
    // In edit mode, fall back to the existing shift's roster ID if context is missing
    const derivedRosterId = selectedRosterId || safeContext.rosterId || (editMode ? existingShift?.roster_id : null);
    const hasRoster = !!derivedRosterId;
    const selectedRoster = useMemo(() => rosters.find(r => r.id === derivedRosterId), [rosters, derivedRosterId]);
    // Managers must be able to add to draft rosters!
    const isRosterActive = selectedRoster?.status === 'published' || selectedRoster?.status === 'draft';
    const watchGroup = form.watch('group_type');
    const watchSubGroupName = form.watch('sub_group_name');

    // Tab completion state
    const tabCompletion = useMemo(() => {
        if (isReadOnly) {
            return {
                schedule: true,
                role: true,
                requirements: true,
                notes: true,
                system: true,
                audit: true,
            };
        }
        return {
            schedule: isTemplateMode
                ? !!(watchStart && watchEnd)
                : !!(watchStart && watchEnd && watchShiftDate && hasRoster && isRosterActive && watchGroup && watchSubGroupName),
            role: !!watchRoleId,
            requirements: (watchSkills?.length || 0) > 0 || (watchLicenses?.length || 0) > 0,
            notes: !!form.watch('notes'),
            system: true,
            audit: true,
        };
    }, [isReadOnly, watchStart, watchEnd, watchRoleId, watchSkills, watchLicenses, watchShiftDate, form, isTemplateMode, hasRoster]);

    // Step navigation
    const {
        currentStep,
        completedSteps,
        setCurrentStep,
        handleNextStep,
        handlePrevStep,
        handleStepClick,
        isStepValid,
        hasBlockingComplianceFailures,
    } = useStepNavigation({
        isTemplateMode,
        tabCompletion,
        isNetLengthValid: isReadOnly ? true : isNetLengthValid,
        watchRoleId: isReadOnly ? 'read-only' : watchRoleId,
        complianceHasRun: isReadOnly ? true : complianceHasRun,
        hardValidation,
        complianceResults,
    });


    // Lock logic: Hierarchy is ALWAYS locked. Roster is locked if in grid/edit context.
    // Group/Sub-group are locked ONLY in Group Mode.
    const isContextInherited = isGridLaunch || isEditModeSource;
    const isRosterLocked = isContextInherited && !!derivedRosterId;

    // Strict Mode Locking as per User Requirements:
    // Group Mode: Locked Group/SubGroup
    // People Mode: Locked Employee
    // Roles Mode: Locked Role
    const isGroupLocked = isContextInherited && (!!resolvedContext.groupId || !!resolvedContext.groupName || !!resolvedContext.group_type) && safeContext.mode === 'group';
    const isSubGroupLocked = isContextInherited && (!!resolvedContext.subGroupId || !!resolvedContext.subGroupName) && safeContext.mode === 'group';
    const isRoleLocked = isContextInherited && safeContext.mode === 'roles' && !!safeContext.roleId;
    const isEmployeeLocked = isContextInherited && safeContext.mode === 'people' && !!safeContext.employeeId;

    // Can user save the shift?
    // Only gate on core data steps (1-4), NOT compliance step.
    // Compliance is advisory - hard validation errors still block via the handleSubmit guard.
    const canSave = useMemo(() => {
        const coreStepsValid = [1, 2, 3, 4].every(step => isStepValid(step));
        const hardValidationPassed = hardValidation.passed;

        const result = coreStepsValid && hardValidationPassed && hasDepartment && (hasRoster || isTemplateMode);

        console.debug('[canSave]', {
            coreStepsValid,
            hardValidationPassed,
            hasDepartment,
            hasRoster,
            isTemplateMode,
            derivedRosterId,
            result
        });

        return result;
    }, [isStepValid, hardValidation.passed, hasDepartment, hasRoster, isTemplateMode, derivedRosterId]);


    useEffect(() => {
        if (isOpen) {
            console.log('[EnhancedAddShiftModal] ReadOnly Audit:', {
                isPast,
                isStarted,
                isPublished,
                isReadOnly,
                watchShiftDate: watchShiftDate?.toISOString(),
                watchStart,
                watchTimezone,
                editMode,
                existingShiftId: existingShift?.id
            });
        }
    }, [isOpen, isPast, isStarted, isPublished, isReadOnly, watchShiftDate, watchStart, watchTimezone, editMode, existingShift]);

    // Invalidate compliance when key fields change
    useEffect(() => {
        setComplianceNeedsRerun(true);
        setComplianceHasRun(false);
    }, [
        watchStart,
        watchEnd,
        watchShiftDate?.toISOString(),
        watchRoleId,
        watchEmployeeId,
        JSON.stringify(watchSkills),
        JSON.stringify(watchLicenses)
    ]);

    // Auto-select remuneration level when role changes
    useEffect(() => {
        if (watchRoleId && roles.length > 0) {
            const selectedRole = roles.find(r => r.id === watchRoleId);
            if (selectedRole?.remuneration_level_id) {
                form.setValue('remuneration_level_id', selectedRole.remuneration_level_id);
            }
        }
    }, [watchRoleId, roles, form]);

    // Reset form when modal opens
    useEffect(() => {
        if (!isOpen) return;

        setCurrentStep(1);

        if (editMode && existingShift) {
            form.reset({
                group_type: existingShift.group_type || (existingShift.groupName?.toLowerCase().replace(/\s+/g, '_') as any) || undefined,
                sub_group_name: existingShift.sub_group_name || existingShift.subGroupName || '',
                role_id: existingShift.role_id || existingShift.roleId || '',
                remuneration_level_id: existingShift.remuneration_level_id || existingShift.remunerationLevelId || '',
                shift_date: existingShift.shift_date ? startOfDay(parse(existingShift.shift_date, 'yyyy-MM-dd', new Date())) : undefined,
                start_time: existingShift.start_time || existingShift.startTime || '',
                end_time: existingShift.end_time || existingShift.endTime || '',
                paid_break_minutes: existingShift.paid_break_minutes ?? existingShift.paidBreakDuration ?? undefined,
                unpaid_break_minutes: existingShift.unpaid_break_minutes ?? existingShift.unpaidBreakDuration ?? undefined,
                timezone: existingShift.timezone || 'Australia/Sydney',
                assigned_employee_id: existingShift.assigned_employee_id || existingShift.assignedEmployeeId || null,
                required_skills: existingShift.required_skills || existingShift.skills || [],
                required_licenses: existingShift.required_licenses || existingShift.licenses || [],
                event_ids: existingShift.event_ids || [],
                notes: existingShift.notes || '',
            });
            // Initialize selectedRosterId from existingShift if context is missing
            if (!selectedRosterId && existingShift.roster_id) {
                setSelectedRosterId(existingShift.roster_id);
            }
        } else {
            form.reset({
                group_type: (context?.groupName?.toLowerCase().replace(/\s+/g, '_') as any) || undefined,
                sub_group_name: context?.subGroupName || '',
                role_id: '',
                remuneration_level_id: '',
                shift_date: context?.date ? startOfDay(parse(context.date, 'yyyy-MM-dd', new Date())) : undefined,
                start_time: '',
                end_time: '',
                paid_break_minutes: undefined,
                unpaid_break_minutes: undefined,
                timezone: 'Australia/Sydney',
                assigned_employee_id: context?.employeeId || null,
                required_skills: [],
                required_licenses: [],
                event_ids: [],
                notes: '',
            });
        }
    }, [isOpen, editMode, existingShift, context, form, setCurrentStep]);

    // Handle cancel with confirmation
    const handleCancel = () => {
        if (form.formState.isDirty) {
            setShowCancelConfirm(true);
        } else {
            onClose();
        }
    };

    // Handle unpublish (V3 DEPRECATED/DISABLED)
    const handleUnpublish = async () => {
        toast({
            title: 'Action Not Supported',
            description: 'Unpublishing shifts is not supported. Please use Cancel or Close Bidding.',
            variant: 'destructive'
        });
    };

    // Build compliance input
    const buildComplianceInput = useCallback(() => ({
        employee_id: watchEmployeeId || 'preview',
        action_type: 'add' as const,
        candidate_shift: {
            start_time: watchStart || '',
            end_time: watchEnd || '',
            shift_date: isTemplateMode
                ? formatInTimezone(new Date(), 'yyyy-MM-dd', watchTimezone)
                : (watchShiftDate ? format(watchShiftDate, 'yyyy-MM-dd') : formatInTimezone(new Date(), 'yyyy-MM-dd', watchTimezone)),
            unpaid_break_minutes: watchUnpaidBreak || 0
        },
        existing_shifts: employeeExistingShifts
    }), [watchEmployeeId, watchStart, watchEnd, watchShiftDate, watchUnpaidBreak, isTemplateMode, employeeExistingShifts, watchTimezone]);

    // Compliance Runner
    const { runChecks, isRunning: isComplianceRunning } = useComplianceRunner({
        buildComplianceInput,
        hardValidation,
        setComplianceResults,
        needsRerun: complianceNeedsRerun,
        setNeedsRerun: setComplianceNeedsRerun,
        setHasRun: setComplianceHasRun
    });

    // Auto-run compliance when needed (debounced)
    useEffect(() => {
        if (complianceNeedsRerun && !isTemplateMode && watchStart && watchEnd && watchRoleId) {
            const timer = setTimeout(() => {
                runChecks();
            }, 500); // Debounce check
            return () => clearTimeout(timer);
        }
    }, [complianceNeedsRerun, isTemplateMode, watchStart, watchEnd, watchRoleId, runChecks]);

    // Handle form submission
    const handleSubmit = async (values: FormValues) => {
        console.log('[EnhancedAddShiftModal] handleSubmit called', {
            values,
            canSave,
            hasDepartment,
            hasRoster,
            derivedRosterId,
            selectedRosterId,
            contextRosterId: safeContext.rosterId,
            hardValidationPassed: hardValidation.passed,
            complianceHasRun,
            isTemplateMode,
            editMode,
        });

        if (!canSave) {
            console.warn('[EnhancedAddShiftModal] canSave is FALSE, blocking submit');
            if (!hardValidation.passed) {
                toast({
                    title: 'Validation Failed',
                    description: hardValidation.errors.join('. ') || 'Hard validation failed.',
                    variant: 'destructive',
                });
            } else {
                toast({
                    title: 'Validation Error',
                    description: `Please check all required fields: ${!hasDepartment ? 'Department ' : ''}${!hasRoster ? 'Roster ' : ''}${!watchRoleId ? 'Role ' : ''}`.trim(),
                    variant: 'destructive',
                });
            }
            return;
        }


        if (!resolvedContext.departmentId) {
            toast({
                title: 'Missing Context',
                description: 'Department is required. Please select from the function bar.',
                variant: 'destructive',
            });
            return;
        }

        const rosterId = selectedRosterId || resolvedContext.rosterId || existingShift?.roster_id;
        if (!rosterId && !isTemplateMode) {
            toast({
                title: 'Missing Roster',
                description: 'Please select a roster.',
                variant: 'destructive',
            });
            return;
        }

        if (!isTemplateMode && values.shift_date && !editMode) {
            if (isPastInTimezone(values.shift_date, watchTimezone)) {
                toast({
                    title: 'Invalid Date',
                    description: 'Cannot create shifts on past dates.',
                    variant: 'destructive',
                });
                return;
            }
        }



        try {
            if (isTemplateMode && onShiftCreated) {
                const role = roles.find((r) => r.id === values.role_id);
                const remLevel = remunerationLevels.find((r) => r.id === values.remuneration_level_id);
                const assignedEmployee = employees.find((e) => e.id === values.assigned_employee_id);

                onShiftCreated({
                    name: role?.name || 'Shift',
                    role_id: values.role_id,
                    roleId: values.role_id,
                    roleName: role?.name,
                    remuneration_level_id: values.remuneration_level_id,
                    remunerationLevelId: values.remuneration_level_id,
                    remunerationLevel: remLevel?.level_name,
                    start_time: values.start_time,
                    startTime: values.start_time,
                    end_time: values.end_time,
                    endTime: values.end_time,
                    paid_break_minutes: values.paid_break_minutes || 0,
                    paidBreakDuration: values.paid_break_minutes || 0,
                    unpaid_break_minutes: values.unpaid_break_minutes || 0,
                    unpaidBreakDuration: values.unpaid_break_minutes || 0,
                    skills: values.required_skills || [],
                    licenses: values.required_licenses || [],
                    notes: values.notes,
                    netLength,
                    assigned_employee_id: values.assigned_employee_id || null,
                    assignedEmployeeId: values.assigned_employee_id || null,
                    assignedEmployeeName: assignedEmployee?.profiles?.full_name || assignedEmployee?.full_name || null,
                });

                toast({ title: 'Shift Added' });
                onSuccess?.();
                form.reset();
                onClose();
            } else {
                const payload = {
                    roster_id: rosterId,
                    shift_date: format(values.shift_date!, 'yyyy-MM-dd'),
                    start_time: values.start_time,
                    end_time: values.end_time,
                    organization_id: resolvedContext.organizationId || null,
                    department_id: resolvedContext.departmentId,
                    sub_department_id: resolvedContext.subDepartmentId || null,
                    group_type: values.group_type || (resolvedContext.groupName?.toLowerCase().replace(/\s+/g, '_') || null) as any,
                    sub_group_name: values.sub_group_name || resolvedContext.subGroupName || null,
                    shift_group_id: resolvedContext.groupId || null,
                    shift_subgroup_id: resolvedContext.subGroupId || null,
                    role_id: values.role_id || null,
                    remuneration_level_id: values.remuneration_level_id || null,
                    paid_break_minutes: values.paid_break_minutes || 0,
                    unpaid_break_minutes: values.unpaid_break_minutes || 0,
                    timezone: values.timezone,
                    assigned_employee_id: values.assigned_employee_id || null,
                    required_skills: values.required_skills || [],
                    required_licenses: values.required_licenses || [],
                    event_ids: values.event_ids || [],
                    notes: values.notes || null,
                    display_order: 0,
                    lifecycle_status: 'Draft' as any,
                    fulfillment_status: (values.assigned_employee_id ? 'scheduled' : 'none') as any,
                };

                console.log('[EnhancedAddShiftModal] Final payload:', JSON.stringify(payload, null, 2));

                if (editMode && existingShift?.id) {
                    console.log('[EnhancedAddShiftModal] Calling updateShiftMutation for shift:', existingShift.id);
                    updateShiftMutation.mutate({
                        shiftId: existingShift.id,
                        updates: payload
                    }, {
                        onSuccess: () => {
                            toast({
                                title: 'Shift Updated',
                                description: `Shift updated for ${format(values.shift_date!, 'dd MMM yyyy')}`,
                            });
                            onSuccess?.();
                            form.reset();
                            onClose();
                        },
                        onError: (error: any) => {
                            toast({
                                title: 'Error',
                                description: error.message || 'Failed to update shift',
                                variant: 'destructive',
                            });
                        }
                    });
                } else {
                    console.log('[EnhancedAddShiftModal] Calling createShiftMutation with payload');
                    createShiftMutation.mutate(payload, {
                        onSuccess: () => {
                            toast({
                                title: 'Shift Created',
                                description: `Shift created for ${format(values.shift_date!, 'dd MMM yyyy')}`,
                            });
                            onSuccess?.();
                            form.reset();
                            onClose();
                        },
                        onError: (error: any) => {
                            toast({
                                title: 'Error',
                                description: error.message || 'Failed to create shift',
                                variant: 'destructive',
                            });
                        }
                    });
                }
            }
        } catch (error: any) {
            console.error('Shift save error:', error);
            // Error handling is mainly done in mutation callbacks now, but kept for non-mutation errors
            if (!editMode && !createShiftMutation.isPending && !updateShiftMutation.isPending) {
                toast({
                    title: 'Error',
                    description: error.message || 'An unexpected error occurred',
                    variant: 'destructive',
                });
            }
        } finally {
            // Loading state is now derived from mutation status
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent
                className="sm:max-w-[1200px] h-[90vh] p-0 gap-0 bg-[#0f172a] border-white/10 overflow-hidden flex flex-col"
                aria-describedby={undefined}
            >
                <ModalHeader
                    editMode={editMode}
                    isReadOnly={isReadOnly}
                    isPast={isPast}
                    isStarted={isStarted}
                    isPublished={isPublished}
                    safeContext={resolvedContext}
                    onUnpublish={handleUnpublish}
                />

                <ContextBar
                    safeContext={resolvedContext}
                    timezone={form.watch('timezone')}
                />

                <Form {...form}>
                    <form id="shift-form" onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        {/* Step Indicator */}
                        <div className="px-6 pt-4 pb-6 border-b border-white/5">
                            <StepIndicator
                                currentStep={currentStep}
                                completedSteps={completedSteps}
                                onStepClick={handleStepClick}
                                disabled={isReadOnly}
                                editMode={editMode}
                            />
                        </div>

                        <ScrollArea className="flex-1">
                            <div className="px-6 py-6">
                                {currentStep === 1 && (
                                    <ScheduleStep
                                        form={form}
                                        isReadOnly={isReadOnly}
                                        isLoadingData={isLoadingData}
                                        isTemplateMode={isTemplateMode}
                                        shiftLength={shiftLength}
                                        netLength={netLength}
                                        hardValidation={hardValidation}
                                        rosters={rosters}
                                        rosterStructure={rosterStructure}
                                        selectedRosterId={selectedRosterId}
                                        onRosterChange={setSelectedRosterId}
                                        isGroupLocked={isGroupLocked}
                                        isSubGroupLocked={isSubGroupLocked}
                                        isRosterLocked={isRosterLocked}
                                        context={resolvedContext}
                                        activeSubGroups={activeSubGroups}
                                    />
                                )}

                                {currentStep === 2 && (
                                    <RoleStep
                                        form={form}
                                        isReadOnly={isReadOnly}
                                        isLoadingData={isLoadingData}
                                        isTemplateMode={isTemplateMode}
                                        roles={roles}
                                        remunerationLevels={remunerationLevels}
                                        employees={employees}
                                        netLength={netLength}
                                        selectedRemLevel={selectedRemLevel}
                                        safeContext={resolvedContext}
                                        isRoleLocked={isRoleLocked}
                                        isEmployeeLocked={isEmployeeLocked}
                                    />
                                )}

                                {currentStep === 3 && (
                                    <RequirementsStep
                                        form={form}
                                        isReadOnly={isReadOnly}
                                        isLoadingData={isLoadingData}
                                        isTemplateMode={isTemplateMode}
                                        skills={skills}
                                        licenses={licenses}
                                        events={events}
                                    />
                                )}

                                {currentStep === 4 && (
                                    <NotesStep
                                        form={form}
                                        isReadOnly={isReadOnly}
                                        isLoadingData={isLoadingData}
                                        isTemplateMode={isTemplateMode}
                                    />
                                )}

                                {currentStep === 5 && (
                                    <ComplianceStep
                                        isTemplateMode={isTemplateMode}
                                        watchEmployeeId={watchEmployeeId}
                                        hardValidation={hardValidation}
                                        complianceResults={complianceResults}
                                        setComplianceResults={setComplianceResults}
                                        buildComplianceInput={buildComplianceInput}
                                        complianceNeedsRerun={complianceNeedsRerun}
                                        onChecksComplete={() => {
                                            setComplianceHasRun(true);
                                            setComplianceNeedsRerun(false);
                                        }}
                                    />
                                )}

                                {currentStep === 6 && (
                                    <ReviewLogsStep
                                        form={form}
                                        editMode={editMode}
                                        existingShift={existingShift}
                                        safeContext={resolvedContext}
                                        selectedRosterId={derivedRosterId || ''}
                                        shiftLength={shiftLength}
                                        netLength={netLength}
                                    />
                                )}
                            </div>
                        </ScrollArea>
                    </form>
                </Form>

                <ModalFooter
                    currentStep={currentStep}
                    isStepValid={isStepValid}
                    isLoading={isLoading}
                    canSave={canSave}
                    isPast={isPast}
                    isStarted={isStarted}
                    isPublished={isPublished}
                    editMode={editMode}
                    onCancel={handleCancel}
                    onPrevStep={handlePrevStep}
                    onNextStep={handleNextStep}
                    onSubmit={form.handleSubmit(handleSubmit)}
                    onUnpublish={handleUnpublish}
                />
            </DialogContent>

            <CancelConfirmDialog
                open={showCancelConfirm}
                onOpenChange={setShowCancelConfirm}
                onConfirm={onClose}
            />
        </Dialog>
    );
};

export default EnhancedAddShiftModal;
export * from './types';
