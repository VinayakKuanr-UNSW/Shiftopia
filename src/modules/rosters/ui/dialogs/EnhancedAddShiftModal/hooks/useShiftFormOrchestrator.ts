/**
 * useShiftFormOrchestrator
 *
 * Owns all business logic for the EnhancedAddShiftModal:
 *   - form setup + watchers
 *   - context resolution (UUID lookup from names)
 *   - read-only & lock rules
 *   - step navigation wiring
 *   - compliance lifecycle
 *   - create / update submission
 *
 * The modal component itself becomes a pure rendering layer that
 * spreads these values into its JSX.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format, startOfDay, parse, getDay } from 'date-fns';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useCreateShift, useUpdateShift, useUnpublishShift } from '@/modules/rosters/state/useRosterShifts';
import { formatInTimezone, isPastInTimezone } from '@/modules/core/lib/date.utils';
import { calculateShiftLength, isDateInPast, isShiftStarted } from '../utils';
import { formSchema, FormValues, EnhancedAddShiftModalProps, ShiftContext } from '../types';
import { useShiftFormData } from './useShiftFormData';
import { useHardValidation } from './useHardValidation';
import { useStepNavigation } from './useStepNavigation';
import { useComplianceRunner } from './useComplianceRunner';

const SYDNEY_TZ = 'Australia/Sydney';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useShiftFormOrchestrator({
    isOpen,
    onClose,
    onSuccess,
    context,
    isTemplateMode = false,
    editMode = false,
    existingShift,
    onShiftCreated,
}: EnhancedAddShiftModalProps) {
    const safeContext = context ?? {};
    const { toast } = useToast();
    const { scopeTree } = useScopeFilter('managerial');

    // ── Mutations ────────────────────────────────────────────────────────────
    const createShiftMutation = useCreateShift();
    const updateShiftMutation = useUpdateShift();
    const isLoading = createShiftMutation.isPending || updateShiftMutation.isPending;

    // ── Local UI state ───────────────────────────────────────────────────────
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [selectedRosterId, setSelectedRosterId] = useState<string>(safeContext.rosterId || '');

    // ── Compliance state ─────────────────────────────────────────────────────
    const [complianceHasRun, setComplianceHasRun] = useState(false);
    const [complianceNeedsRerun, setComplianceNeedsRerun] = useState(false);
    const [complianceResults, setComplianceResults] = useState<Record<string, any>>({});

    // ── Form ─────────────────────────────────────────────────────────────────
    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            paid_break_minutes: undefined,
            unpaid_break_minutes: undefined,
            timezone: SYDNEY_TZ,
            assigned_employee_id: safeContext.employeeId || null,
            required_skills: [],
            required_licenses: [],
            event_ids: [],
            notes: '',
            group_type: (safeContext.group_type || safeContext.groupName?.toLowerCase().replace(/\s+/g, '_')) as FormValues['group_type'],
            sub_group_name: safeContext.sub_group_name || safeContext.subGroupName || '',
        },
    });

    // ── Watchers ─────────────────────────────────────────────────────────────
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
    const watchGroup = form.watch('group_type');
    const watchSubGroupName = form.watch('sub_group_name');
    const watchIsTraining = form.watch('is_training');

    // ── Data hooks ───────────────────────────────────────────────────────────
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
        selectedRoleId: watchRoleId,
    });

    // ── Context resolution ───────────────────────────────────────────────────
    // Translate string names from the grid launch context into DB UUIDs using
    // the scope tree + loaded roster groups.
    const resolvedContext = useMemo((): ShiftContext => {
        const orgId = safeContext.organizationId;
        const deptId = safeContext.departmentId || safeContext.departmentIds?.[0];
        const subDeptId = safeContext.subDepartmentId || safeContext.subDepartmentIds?.[0];

        const orgInfo = scopeTree?.organizations?.find(o => o.id === orgId);
        const deptInfo = orgInfo?.departments?.find(d => d.id === deptId);

        const roster = rosters.find(r => r.id === (selectedRosterId || safeContext.rosterId));

        let groupId = safeContext.groupId;
        let subGroupId = safeContext.subGroupId;

        if (roster && (safeContext.groupName || safeContext.group_type) && !groupId) {
            const searchName = safeContext.groupName?.trim().toLowerCase();
            const searchType = safeContext.group_type;

            const group = roster.groups?.find(g => {
                if (searchType && g.external_id === searchType) return true;
                if (!searchName) return false;
                const dbName = g.name.trim().toLowerCase();
                return dbName === searchName || dbName.replace(/\s+/g, '_') === searchName;
            });

            if (group) {
                groupId = group.id;
                if (safeContext.subGroupName && !subGroupId) {
                    const sub = safeContext.subGroupName.trim().toLowerCase();
                    const found = group.subGroups?.find(sg => {
                        const dbSub = sg.name.trim().toLowerCase();
                        return dbSub === sub || dbSub.replace(/\s+/g, '_') === sub;
                    });
                    if (found) subGroupId = found.id;
                }
            }
        }

        const effectiveDeptId = roster ? (roster.department_id || null) : deptId;
        const effectiveSubDeptId = roster ? (roster.sub_department_id || null) : subDeptId;
        const effectiveDeptInfo = orgInfo?.departments?.find(d => d.id === effectiveDeptId);
        const effectiveSubDeptInfo = effectiveDeptInfo?.subdepartments?.find(sd => sd.id === effectiveSubDeptId);

        // For people/roles modes: the user selects a group from the dropdown — resolve
        // its UUID from the current form value so the submit payload carries the right IDs.
        if (!groupId && watchGroup) {
            const activeRoster = rosters.find(r => r.id === (selectedRosterId || safeContext.rosterId));
            const grp = activeRoster?.groups?.find(g =>
                g.external_id === watchGroup ||
                g.name.trim().toLowerCase().replace(/\s+/g, '_') === watchGroup,
            );
            if (grp) {
                groupId = grp.id;
                if (!subGroupId && watchSubGroupName) {
                    const sub = grp.subGroups?.find(sg =>
                        sg.name.trim().toLowerCase() === watchSubGroupName.trim().toLowerCase(),
                    );
                    if (sub) subGroupId = sub.id;
                }
            }
        }

        return {
            ...safeContext,
            organizationId: orgId,
            organizationName: orgInfo?.name || safeContext.organizationName,
            departmentId: effectiveDeptId,
            departmentName: effectiveDeptInfo?.name || (effectiveDeptId === null ? 'All Departments' : safeContext.departmentName),
            subDepartmentId: effectiveSubDeptId,
            subDepartmentName: effectiveSubDeptInfo?.name || (effectiveSubDeptId === null ? 'All Sub-Departments' : safeContext.subDepartmentName),
            groupId: groupId || safeContext.groupId,
            subGroupId: subGroupId || safeContext.subGroupId,
        };
    }, [scopeTree, rosters, selectedRosterId, safeContext, watchGroup, watchSubGroupName]);

    // ── Hard validation ──────────────────────────────────────────────────────
    const { hardValidation, employeeExistingShifts, studentVisaEnforcement } = useHardValidation({
        watchStart,
        watchEnd,
        watchShiftDate,
        watchEmployeeId,
        isTemplateMode,
        existingShiftId: existingShift?.id,
        timezone: watchTimezone,
    });

    // ── Computed values ──────────────────────────────────────────────────────
    const shiftLength = useMemo(
        () => calculateShiftLength(watchStart, watchEnd),
        [watchStart, watchEnd],
    );

    const netLength = useMemo(() => {
        const unpaid = watchUnpaidBreak || 0;
        return Math.max(0, shiftLength - unpaid / 60);
    }, [shiftLength, watchUnpaidBreak]);

    const selectedRemLevel = remunerationLevels.find(r => r.id === watchRemLevel);
    const minShiftHours = useMemo(() => {
        if (watchIsTraining) return 2.0;
        if (!watchShiftDate) return 3.0;
        const day = getDay(watchShiftDate);
        return day === 0 ? 4.0 : 3.0; // Sunday=0
    }, [watchIsTraining, watchShiftDate]);

    const isMinLengthValid = netLength >= minShiftHours;
    const isNetLengthValid = netLength > 0 && netLength <= 12 && isMinLengthValid;

    // ── Read-only checks ─────────────────────────────────────────────────────
    const isPast = useMemo(() => isDateInPast(watchShiftDate, watchTimezone), [watchShiftDate, watchTimezone]);
    const isStarted = useMemo(() => isShiftStarted(watchShiftDate, watchStart, watchTimezone), [watchShiftDate, watchStart, watchTimezone]);
    const isPublished = useMemo(() => !isTemplateMode && existingShift?.lifecycle_status === 'Published', [isTemplateMode, existingShift]);
    // Published shifts are now read-only per user request
    const isReadOnly = isPast || isStarted || isPublished;

    // ── Unpublish eligibility (state-machine.md §8.1) ───────────────────────
    // Unpublish is allowed from: S3 (Offered), S5/S6 (OnBidding), S8 (BiddingClosedNoWinner)
    // Blocked for: S4 (Confirmed), S7 (EmergencyAssigned), InProgress, Completed, Cancelled
    const canUnpublish = useMemo(() => {
        if (!editMode || !existingShift || isTemplateMode || isPast || isStarted) return false;
        const lifecycle = existingShift.lifecycle_status;
        if (lifecycle !== 'Published') return false;
        const outcome = existingShift.assignment_outcome;
        const bidding = existingShift.bidding_status;
        // S4: Confirmed — blocked
        if (outcome === 'confirmed') return false;
        // S7: EmergencyAssigned — blocked
        if (outcome === 'emergency_assigned') return false;
        // S3: Offered — allowed
        if (outcome === 'offered') return true;
        // S5/S6: OnBidding — allowed
        if (bidding === 'on_bidding_normal' || bidding === 'on_bidding_urgent') return true;
        // S8: BiddingClosedNoWinner — allowed
        if (bidding === 'bidding_closed_no_winner') return true;
        return false;
    }, [editMode, existingShift, isTemplateMode, isPast, isStarted]);

    // ── Roster / context locks ───────────────────────────────────────────────
    const isGridLaunch = safeContext.launchSource === 'grid';
    const isEditModeSource = safeContext.launchSource === 'edit';

    const hasDepartment = !!resolvedContext.departmentId;
    const derivedRosterId = selectedRosterId || safeContext.rosterId || (editMode ? existingShift?.roster_id : null);
    const hasRoster = !!derivedRosterId;

    const selectedRoster = useMemo(() => rosters.find(r => r.id === derivedRosterId), [rosters, derivedRosterId]);
    const isRosterActive = isTemplateMode || selectedRoster?.status === 'published' || selectedRoster?.status === 'draft';

    const isContextInherited = isGridLaunch || isEditModeSource;

    const isRosterLocked = isContextInherited && !!derivedRosterId;
    const isGroupLocked = (isContextInherited && (!!resolvedContext.groupId || !!resolvedContext.groupName || !!resolvedContext.group_type) && safeContext.mode === 'group')
        || (safeContext.mode === 'template' && (!!safeContext.groupName || !!safeContext.group_type));
    const isSubGroupLocked = (isContextInherited && (!!resolvedContext.subGroupId || !!resolvedContext.subGroupName) && safeContext.mode === 'group')
        || (safeContext.mode === 'template' && !!safeContext.subGroupName);
    const isRoleLocked = isContextInherited && safeContext.mode === 'roles' && !!safeContext.roleId;
    const isEmployeeLocked = isContextInherited && safeContext.mode === 'people' && !!safeContext.employeeId;

    const tabCompletion = useMemo(() => {
        if (isReadOnly) {
            return { schedule: true, role: true, requirements: true, notes: true, system: true };
        }
        return {
            schedule: isTemplateMode
                ? !!(watchStart && watchEnd && watchGroup && watchSubGroupName)
                : !!(watchStart && watchEnd && watchShiftDate && hasRoster && isRosterActive && watchGroup && watchSubGroupName),
            role: !!watchRoleId,
            requirements: (watchSkills?.length || 0) > 0 || (watchLicenses?.length || 0) > 0,
            notes: !!form.watch('notes'),
            system: true,
        };
    }, [isReadOnly, watchStart, watchEnd, watchRoleId, watchSkills, watchLicenses, watchShiftDate, form, isTemplateMode, hasRoster, isRosterActive, watchGroup, watchSubGroupName]);

    // ── Step navigation ──────────────────────────────────────────────────────
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
        isMinLengthValid: isReadOnly ? true : isMinLengthValid,
        watchRoleId: isReadOnly ? 'read-only' : watchRoleId,
        complianceHasRun: isReadOnly ? true : complianceHasRun,
        hardValidation,
        complianceResults,
    });

    // ── Save guard ───────────────────────────────────────────────────────────
    const canSave = useMemo(() => {
        const coreStepsValid = [1, 2].every(step => isStepValid(step));
        return coreStepsValid && hardValidation.passed && hasDepartment && (hasRoster || isTemplateMode);
    }, [isStepValid, hardValidation.passed, hasDepartment, hasRoster, isTemplateMode]);

    // ── Effects ──────────────────────────────────────────────────────────────

    // Invalidate compliance when key scheduling fields change
    useEffect(() => {
        setComplianceNeedsRerun(true);
        setComplianceHasRun(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        watchStart, watchEnd,
        watchShiftDate?.toISOString(),
        watchRoleId, watchEmployeeId,
        // stringify to avoid object identity issues
        JSON.stringify(watchSkills),
        JSON.stringify(watchLicenses),
    ]);

    // Auto-select remuneration level when the chosen role has a default
    useEffect(() => {
        if (watchRoleId && roles.length > 0) {
            const role = roles.find(r => r.id === watchRoleId);
            if (role?.remuneration_level_id) {
                form.setValue('remuneration_level_id', role.remuneration_level_id);
            }
        }
    }, [watchRoleId, roles, form]);

    // Late-sync: role data may arrive after context propagates defaultValues
    useEffect(() => {
        if (isOpen && !editMode && safeContext.roleId && !watchRoleId && roles.length > 0) {
            const match = roles.find(r => r.id === safeContext.roleId);
            if (match) {
                form.setValue('role_id', match.id);
                if (match.remuneration_level_id) {
                    form.setValue('remuneration_level_id', match.remuneration_level_id);
                }
            }
        }
    }, [isOpen, editMode, safeContext.roleId, watchRoleId, roles, form]);

    // Reset on open / mode change
    useEffect(() => {
        if (!isOpen) return;
        setCurrentStep(1);

        if (editMode && existingShift) {
            form.reset({
                group_type: (existingShift.group_type || existingShift.groupName?.toLowerCase().replace(/\s+/g, '_') || safeContext.group_type || safeContext.groupName?.toLowerCase().replace(/\s+/g, '_')) as FormValues['group_type'] || undefined,
                sub_group_name: existingShift.sub_group_name || existingShift.subGroupName || safeContext.sub_group_name || safeContext.subGroupName || '',
                role_id: existingShift.role_id || existingShift.roleId || '',
                remuneration_level_id: existingShift.remuneration_level_id || existingShift.remunerationLevelId || '',
                shift_date: existingShift.shift_date ? startOfDay(parse(existingShift.shift_date, 'yyyy-MM-dd', new Date())) : undefined,
                start_time: existingShift.start_time || existingShift.startTime || '',
                end_time: existingShift.end_time || existingShift.endTime || '',
                paid_break_minutes: existingShift.paid_break_minutes ?? existingShift.paidBreakDuration ?? undefined,
                unpaid_break_minutes: existingShift.unpaid_break_minutes ?? existingShift.unpaidBreakDuration ?? undefined,
                timezone: existingShift.timezone || SYDNEY_TZ,
                assigned_employee_id: existingShift.assigned_employee_id || existingShift.assignedEmployeeId || null,
                required_skills: existingShift.required_skills || existingShift.skills || [],
                required_licenses: existingShift.required_licenses || existingShift.licenses || [],
                event_ids: existingShift.event_ids || [],
                notes: existingShift.notes || '',
                is_training: existingShift.is_training || false,
            });
            if (!selectedRosterId && existingShift.roster_id) {
                setSelectedRosterId(existingShift.roster_id);
            }
        } else {
            form.reset({
                group_type: (context?.group_type || context?.groupName?.toLowerCase().replace(/\s+/g, '_')) as FormValues['group_type'],
                sub_group_name: context?.sub_group_name || context?.subGroupName || '',
                role_id: context?.roleId || '',
                remuneration_level_id: context?.remunerationLevelId || '',
                shift_date: context?.date ? startOfDay(parse(context.date, 'yyyy-MM-dd', new Date())) : undefined,
                start_time: context?.eventStartTime || '',
                end_time: context?.eventEndTime || '',
                paid_break_minutes: undefined,
                unpaid_break_minutes: undefined,
                timezone: SYDNEY_TZ,
                assigned_employee_id: context?.employeeId || null,
                required_skills: [],
                required_licenses: [],
                event_ids: [],
                notes: '',
                is_training: false,
            });
        }// eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, editMode, existingShift, context]);

    // ── Compliance ───────────────────────────────────────────────────────────
    const buildComplianceInput = useCallback(() => ({
        employee_id: watchEmployeeId || 'preview',
        action_type: 'add' as const,
        candidate_shift: {
            start_time: watchStart || '',
            end_time: watchEnd || '',
            shift_date: isTemplateMode
                ? formatInTimezone(new Date(), watchTimezone, 'yyyy-MM-dd')
                : (watchShiftDate ? format(watchShiftDate, 'yyyy-MM-dd') : formatInTimezone(new Date(), watchTimezone, 'yyyy-MM-dd')),
            unpaid_break_minutes: watchUnpaidBreak || 0,
        },
        existing_shifts: employeeExistingShifts,
        exclude_shift_id: existingShift?.id || undefined,
        overrideRoleId: watchRoleId || undefined,
        overrideSkillIds: watchSkills?.length ? watchSkills : undefined,
        overrideLicenseIds: watchLicenses?.length ? watchLicenses : undefined,
        candidate_is_training: watchIsTraining || false,
        student_visa_enforcement: studentVisaEnforcement,
    }), [watchEmployeeId, watchStart, watchEnd, watchShiftDate, watchUnpaidBreak, isTemplateMode, employeeExistingShifts, watchTimezone, existingShift?.id, watchRoleId, watchSkills, watchLicenses, watchIsTraining, studentVisaEnforcement]);

    const {
        runChecks,
        clearResults,
        isRunning: isComplianceRunning
    } = useComplianceRunner({
        buildComplianceInput,
        hardValidation,
        setComplianceResults,
        needsRerun: complianceNeedsRerun,
        setNeedsRerun: setComplianceNeedsRerun,
        setHasRun: setComplianceHasRun,
        shiftId: existingShift?.id,
    });

    // Debounced auto-run
    useEffect(() => {
        if (complianceNeedsRerun && !isTemplateMode && watchStart && watchEnd && watchRoleId) {
            const timer = setTimeout(() => { runChecks(); }, 500);
            return () => clearTimeout(timer);
        }
    }, [complianceNeedsRerun, isTemplateMode, watchStart, watchEnd, watchRoleId, runChecks]);

    // Auto-run all compliance checks whenever the user enters Step 2
    const prevStepRef = useRef<number>(currentStep);
    useEffect(() => {
        const prev = prevStepRef.current;
        prevStepRef.current = currentStep;
        if (currentStep === 2 && prev !== 2 && !isTemplateMode && watchStart && watchEnd && watchRoleId) {
            runChecks();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentStep]);

    // ── Handlers ─────────────────────────────────────────────────────────────
    const handleComplianceComplete = useCallback(() => {
        setComplianceHasRun(true);
        setComplianceNeedsRerun(false);
    }, []);

    const handleCancel = useCallback(() => {
        if (form.formState.isDirty) {
            setShowCancelConfirm(true);
        } else {
            onClose();
        }
    }, [form.formState.isDirty, onClose]);

    const unpublishMutation = useUnpublishShift();

    const handleUnpublish = useCallback(async () => {
        if (!existingShift?.id || !canUnpublish) {
            toast({
                title: 'Cannot Unpublish',
                description: 'This shift cannot be unpublished from its current state.',
                variant: 'destructive',
            });
            return;
        }

        try {
            await unpublishMutation.mutateAsync({ shiftId: existingShift.id, reason: 'Unpublished via Edit Modal' });
            toast({
                title: 'Shift Unpublished',
                description: 'The shift has been reverted to Draft.',
            });
            onSuccess?.();
            onClose();
        } catch (err: any) {
            toast({
                title: 'Unpublish Failed',
                description: err?.message || 'Failed to unpublish shift.',
                variant: 'destructive',
            });
        }
    }, [existingShift?.id, canUnpublish, unpublishMutation, toast, onSuccess, onClose]);

    const handleSubmit = useCallback(async (values: FormValues) => {
        if (!canSave) {
            if (!hardValidation.passed) {
                toast({
                    title: 'Validation Failed',
                    description: hardValidation.errors.join('. ') || 'Hard validation failed.',
                    variant: 'destructive',
                });
            } else {
                toast({
                    title: 'Validation Error',
                    description: `Please check: ${!hasDepartment ? 'Department ' : ''}${!hasRoster ? 'Roster ' : ''}${!watchRoleId ? 'Role' : ''}`.trim(),
                    variant: 'destructive',
                });
            }
            return;
        }

        if (!resolvedContext.departmentId) {
            toast({ title: 'Missing Context', description: 'Department is required.', variant: 'destructive' });
            return;
        }

        const rosterId = selectedRosterId || resolvedContext.rosterId || existingShift?.roster_id;
        if (!rosterId && !isTemplateMode) {
            toast({ title: 'Missing Roster', description: 'Please select a roster.', variant: 'destructive' });
            return;
        }

        if (!isTemplateMode && values.shift_date && !editMode) {
            if (isPastInTimezone(values.shift_date, watchTimezone)) {
                toast({ title: 'Invalid Date', description: 'Cannot create shifts on past dates.', variant: 'destructive' });
                return;
            }
        }

        const onMutationSuccess = () => {
            toast({
                title: editMode ? 'Shift Updated' : 'Shift Created',
                description: `Shift ${editMode ? 'updated' : 'created'} for ${format(values.shift_date!, 'dd MMM yyyy')}`,
            });
            onSuccess?.();
            form.reset();
            onClose();
        };

        const onMutationError = (error: unknown) => {
            toast({
                title: 'Error',
                description: (error as Error)?.message || `Failed to ${editMode ? 'update' : 'create'} shift`,
                variant: 'destructive',
            });
        };

        try {
            if (isTemplateMode && onShiftCreated) {
                const role = roles.find(r => r.id === values.role_id);
                const remLevel = remunerationLevels.find(r => r.id === values.remuneration_level_id);
                const assignedEmployee = employees.find(e => e.id === values.assigned_employee_id);

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
                    // Groups/SubGroups are inherited by TemplateEditor but we pass them for completeness/UI
                    group_type: values.group_type,
                    sub_group_name: values.sub_group_name,
                    shift_group_id: resolvedContext.groupId,
                    shift_subgroup_id: resolvedContext.subGroupId,
                });

                toast({ title: 'Shift Added' });
                onSuccess?.();
                form.reset();
                onClose();
            } else {
                const basePayload = {
                    roster_id: rosterId,
                    shift_date: format(values.shift_date!, 'yyyy-MM-dd'),
                    start_time: values.start_time,
                    end_time: values.end_time,
                    organization_id: resolvedContext.organizationId || null,
                    department_id: resolvedContext.departmentId,
                    sub_department_id: resolvedContext.subDepartmentId || null,
                    group_type: (values.group_type || (resolvedContext.groupName?.toLowerCase().replace(/\s+/g, '_') || null)) as FormValues['group_type'],
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
                    // Source tracking
                    creation_source: isTemplateMode ? 'template' : 'manual',
                    assignment_source: values.assigned_employee_id
                        ? (editMode ? 'manual' : 'direct')
                        : null,
                };
                // Only include lifecycle_status for new shifts — updateShift ignores it
                // and including it causes the optimistic cache to flash wrong status.
                const payload = editMode
                    ? basePayload
                    : { ...basePayload, lifecycle_status: 'Draft' as const, fulfillment_status: (values.assigned_employee_id ? 'scheduled' : 'none') as 'scheduled' | 'none' };

                if (editMode && existingShift?.id) {
                    updateShiftMutation.mutate(
                        { shiftId: existingShift.id, updates: payload },
                        { onSuccess: onMutationSuccess, onError: onMutationError },
                    );
                } else {
                    createShiftMutation.mutate(
                        payload,
                        { onSuccess: onMutationSuccess, onError: onMutationError },
                    );
                }
            }
        } catch (error: unknown) {
            if (!editMode && !createShiftMutation.isPending && !updateShiftMutation.isPending) {
                toast({
                    title: 'Error',
                    description: (error as Error)?.message || 'An unexpected error occurred',
                    variant: 'destructive',
                });
            }
        }
    }, [
        canSave, hardValidation, hasDepartment, hasRoster, watchRoleId,
        resolvedContext, selectedRosterId, isTemplateMode, editMode, watchTimezone,
        onShiftCreated, roles, remunerationLevels, employees, netLength,
        onSuccess, form, onClose, createShiftMutation, updateShiftMutation,
        existingShift, toast,
    ]);

    // ── Return ────────────────────────────────────────────────────────────────
    return {
        // Form
        form,
        isLoading,

        // UI state
        showCancelConfirm,
        setShowCancelConfirm,

        // Data
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

        // Resolved context for step props + header
        resolvedContext,
        safeContext,

        // Step navigation
        currentStep,
        completedSteps,
        handleNextStep,
        handlePrevStep,
        handleStepClick,
        isStepValid,
        hasBlockingComplianceFailures,

        // Computed values
        shiftLength,
        netLength,
        minShiftHours,
        isMinLengthValid,
        selectedRemLevel,

        // Lock state
        isRosterLocked,
        isGroupLocked,
        isSubGroupLocked,
        isRoleLocked,
        isEmployeeLocked,

        // Read-only
        isPast,
        isStarted,
        isPublished,
        isReadOnly,

        // Roster
        selectedRosterId,
        setSelectedRosterId,
        derivedRosterId,

        // Validation
        canSave,
        hardValidation,
        studentVisaEnforcement,

        // Compliance
        complianceResults,
        setComplianceResults,
        complianceHasRun,
        complianceNeedsRerun,
        isComplianceRunning,
        runChecks,
        clearResults,
        buildComplianceInput,
        handleComplianceComplete,

        // Watched fields passed to steps
        watchEmployeeId,
        watchTimezone,

        // Handlers
        handleSubmit,
        handleCancel,
        handleUnpublish,
        canUnpublish,
    };
}
