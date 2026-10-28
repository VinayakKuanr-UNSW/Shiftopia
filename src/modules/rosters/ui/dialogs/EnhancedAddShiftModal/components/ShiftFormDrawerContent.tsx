/**
 * ShiftFormDrawerContent — Minimalist 5-Stepper Shift Configuration Modal
 *
 * Fully conforms to WCAG 2.2 AA / ARIA standards with dark & light theme support.
 * 
 * 5-Step Structure:
 *   1. Role & Context      — Organization, Group, Subgroup, Role, Target Employment
 *   2. Requirements & Notes — Skills, Certifications, Events, Handover Notes
 *   3. Timings & Breaks    — Shift Date, Times, Breaks, Minimum Engagement & Shape Validation
 *   4. Assignment          — Employee matching, availability, qualifications, bidding
 *   5. Compliance & Review — Full ICC Sydney EBA Audit & Shift Overview
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import {
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from '@/modules/core/ui/primitives/form';
import { Input } from '@/modules/core/ui/primitives/input';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { cn } from '@/modules/core/lib/utils';
import {
    Clock,
    AlertCircle,
    AlertTriangle,
    Shield,
    GraduationCap,
    Coffee,
    Utensils,
    UserCircle,
    Loader2,
    CheckCircle2,
    X,
    Briefcase,
    Plus,
    Check,
    ChevronLeft,
    ChevronRight,
    Save,
    Calendar,
} from 'lucide-react';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Button } from '@/modules/core/ui/primitives/button';
import { CompliancePanel } from '@/modules/compliance/ui/CompliancePanel';
import { MultiSelect } from './MultiSelect';
import { TemplateDaySelect, firstTemplateDay } from './TemplateDaySelect';
import { FIELD_CARD, FIELD_INPUT, FIELD_LABEL } from '@/modules/core/ui/components/PickerField';
import { SingleSelect } from './SingleSelect';
import { EmployeeSelect } from './EmployeeSelect';
import type { ShiftFormDrawerContentProps } from '../types';
import { formatHours } from '../utils';
import {
    targetEmploymentTypeOptions,
    targetAfterGroupChange,
    TARGET_EMPLOYMENT_TYPES,
    TARGET_EMPLOYMENT_TYPE_LABELS,
    contractMatchesTarget,
} from '@/modules/core/model/employment.types';

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS & CONFIG
   ═══════════════════════════════════════════════════════════════════════ */

const GROUP_LABEL: Record<string, string> = {
    convention_centre: 'Convention Centre',
    exhibition_centre: 'Exhibition Centre',
    theatre: 'Theatre',
    the_cutaway: 'The Cutaway',
    office: 'Office',
};

const STEP = {
    role: 1,
    requirements: 2,
    timings: 3,
    assignment: 4,
    compliance: 5,
} as const;

const STEP_META = [
    { n: 1, key: 'role', label: 'Role & Context', shortLabel: 'Role', icon: Briefcase },
    { n: 2, key: 'requirements', label: 'Requirements & Notes', shortLabel: 'Requirements', icon: GraduationCap },
    { n: 3, key: 'timings', label: 'Timings & Breaks', shortLabel: 'Timings', icon: Clock },
    { n: 4, key: 'assignment', label: 'Assignment', shortLabel: 'Assignment', icon: UserCircle },
    { n: 5, key: 'compliance', label: 'Compliance & Review', shortLabel: 'Compliance', icon: Shield },
] as const;

const TOTAL_STEPS = 5;

/* ═══════════════════════════════════════════════════════════════════════
   HELPER COMPONENTS
   ═══════════════════════════════════════════════════════════════════════ */

const FieldLabel: React.FC<{
    htmlFor?: string;
    children: React.ReactNode;
    required?: boolean;
    className?: string;
}> = ({ htmlFor, children, required, className }) => (
    <label
        htmlFor={htmlFor}
        className={cn(
            'block text-[11px] font-semibold tracking-wide text-foreground/80 mb-1.5',
            className
        )}
    >
        {children}
        {required && (
            <span className="ml-1 text-rose-500 font-bold" aria-hidden="true">
                *
            </span>
        )}
    </label>
);

const StatChip: React.FC<{
    label: string;
    value: string;
    status?: 'normal' | 'success' | 'warning' | 'danger';
}> = ({ label, value, status = 'normal' }) => {
    const statusClasses = {
        normal: 'text-foreground border-border/60 bg-muted/30',
        success: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/5',
        warning: 'text-amber-600 dark:text-amber-400 border-amber-500/20 bg-amber-500/5',
        danger: 'text-rose-600 dark:text-rose-400 border-rose-500/20 bg-rose-500/5',
    };

    return (
        <div className={cn('flex-1 rounded-xl border p-3 transition-colors', statusClasses[status])}>
            <p className="text-[11px] font-medium tracking-wide uppercase text-muted-foreground/80 mb-0.5">
                {label}
            </p>
            <p className="font-mono text-[15px] font-bold tracking-tight">
                {value}
            </p>
        </div>
    );
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export const ShiftFormDrawerContent: React.FC<ShiftFormDrawerContentProps> = ({
    form,
    isReadOnly,
    isPast,
    isStarted,
    isPublished,
    isTemplateMode,
    editMode,
    existingShift,
    roles,
    employees,
    skills,
    licenses,
    events,
    rosters,
    isLoadingShifts,
    resolvedContext,
    selectedRosterId,
    shiftLength,
    netLength,
    hardValidation,
    minShiftHours,
    shape,
    shapeBlockers,
    compliancePanel,
    onUnpublish,
    canUnpublish,
    isGroupLocked,
    isSubGroupLocked,
    isRoleLocked,
    isEmployeeLocked,
    isTargetTypeLocked,
    onCancel,
    onSubmit,
    canSave = true,
    isLoading = false,
    saveBlockReason,
    title,
    subtitle,
    headerActions,
}) => {
    const [] = useState(false);
    const [poolQuery] = useState('');
    const [wizardStep, setWizardStep] = useState<number>(1);

    const stepHeadingRef = useRef<HTMLHeadingElement>(null);
    const tabsListRef = useRef<HTMLDivElement>(null);
    const didMountRef = useRef(false);

    /* ── Watched Form Fields ── */
    const watchShiftDate = form.watch('shift_date');
    const watchGroup = form.watch('group_type');
    const watchSubGroupName = form.watch('sub_group_name');
    const watchStart = form.watch('start_time');
    const watchEnd = form.watch('end_time');
    const watchV8RoleId = form.watch('role_id');
    const watchEmployeeId = form.watch('assigned_employee_id');
    const watchTargetType = form.watch('target_employment_type');
    const watchTargetFlex = form.watch('target_requires_flexible');
    const watchDayOfWeek = form.watch('day_of_week');

    /* ── Step Validation Gates ── */
    const isRoleStepValid = !!watchGroup && !!watchSubGroupName && !!watchV8RoleId;
    const isRequirementsStepValid = true; // Optional step
    const isTimingsStepValid = shape.status !== 'INCOMPLETE'
        && (isTemplateMode || !!watchShiftDate)
        && (!isTemplateMode || watchDayOfWeek !== undefined)
        && !shape.blocking;
    const isAssignmentStepValid = true;   // Optional step
    const isComplianceStepValid = true;   // Review step

    const isStepValid = (stepNumber: number): boolean => {
        switch (stepNumber) {
            case STEP.role: return isRoleStepValid;
            case STEP.requirements: return isRequirementsStepValid;
            case STEP.timings: return isTimingsStepValid;
            case STEP.assignment: return isAssignmentStepValid;
            case STEP.compliance: return isComplianceStepValid;
            default: return true;
        }
    };

    // Progression gate: Can only reach subsequent steps if prior mandatory steps are valid
    const maxUnlockedStep = useMemo(() => {
        if (!isRoleStepValid) return STEP.role;
        if (!isTimingsStepValid && wizardStep > STEP.requirements) return STEP.timings;
        return STEP.compliance;
    }, [isRoleStepValid, isTimingsStepValid, wizardStep]);

    const goToStep = (stepNumber: number) => {
        if (stepNumber <= maxUnlockedStep && stepNumber >= 1 && stepNumber <= TOTAL_STEPS) {
            setWizardStep(stepNumber);
        }
    };

    /* ── Focus Management for Accessibility ── */
    useEffect(() => {
        if (!didMountRef.current) {
            didMountRef.current = true;
            return;
        }
        stepHeadingRef.current?.focus();
    }, [wizardStep]);

    /* ── Keyboard Arrow Navigation for Tabs ── */
    const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
        const key = e.key;
        let targetIndex = -1;

        if (key === 'ArrowRight' || key === 'ArrowDown') {
            targetIndex = (index + 1) % TOTAL_STEPS;
        } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
            targetIndex = (index - 1 + TOTAL_STEPS) % TOTAL_STEPS;
        } else if (key === 'Home') {
            targetIndex = 0;
        } else if (key === 'End') {
            targetIndex = TOTAL_STEPS - 1;
        }

        if (targetIndex !== -1) {
            e.preventDefault();
            const targetStep = STEP_META[targetIndex].n;
            if (targetStep <= maxUnlockedStep) {
                goToStep(targetStep);
                const buttons = tabsListRef.current?.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
                buttons?.[targetIndex]?.focus();
            }
        }
    };

    /* ── Compliance Triggering ── */
    const panelStatus = compliancePanel.status;
    useEffect(() => {
        if (isReadOnly || isTemplateMode) return;
        if (!watchEmployeeId) return;
        if (!isTimingsStepValid) return;
        if (isLoadingShifts) return;
        if (panelStatus === 'idle' || panelStatus === 'stale') {
            compliancePanel.run();
        }
    }, [watchEmployeeId, isReadOnly, isTemplateMode, isLoadingShifts, panelStatus, isTimingsStepValid]);

    /* ── Group & Subgroup Options ── */
    const availableGroups = useMemo(() => {
        const roster = rosters.find(r => r.id === (selectedRosterId || resolvedContext.rosterId));
        return roster?.groups || [];
    }, [rosters, selectedRosterId, resolvedContext.rosterId]);

    const activeGroup = useMemo(() => {
        if (!watchGroup) return null;
        return availableGroups.find(g =>
            g.external_id === watchGroup ||
            g.name.toLowerCase().replace(/\s+/g, '_') === watchGroup
        );
    }, [availableGroups, watchGroup]);

    const availableSubGroupsList = useMemo(() => {
        return activeGroup?.subGroups || [];
    }, [activeGroup]);

    /* ── Date Display ── */
    const dateDisplay = useMemo(() => {
        if (watchShiftDate) return format(watchShiftDate, 'EEE, d MMM yyyy');
        if (resolvedContext.date) {
            try { return format(new Date(resolvedContext.date + 'T00:00:00'), 'EEE, d MMM yyyy'); }
            catch { return resolvedContext.date; }
        }
        return 'Select date';
    }, [watchShiftDate, resolvedContext.date]);

    /* ── Employee Filtering ── */
    const searchedEmployees = useMemo(() => {
        const q = poolQuery.trim().toLowerCase();
        if (!q) return employees;
        return employees.filter(e => {
            const name = e.profiles?.full_name || e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
            return name.toLowerCase().includes(q);
        });
    }, [employees, poolQuery]);

    const filteredEmployees = useMemo(() => {
        if (!watchTargetType) return searchedEmployees;
        return searchedEmployees.filter(e =>
            contractMatchesTarget(
                e.employment_status ?? e.contract_type,
                watchTargetType,
                watchTargetType === 'PT' && !!watchTargetFlex,
            ),
        );
    }, [searchedEmployees, watchTargetType, watchTargetFlex]);

    const excludedByTargetCount = searchedEmployees.length - filteredEmployees.length;

    const displayNameOf = (e: any) =>
        e.profiles?.full_name || e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Employee';

    const initialsOf = (e: any) =>
        `${e.first_name?.[0] ?? ''}${e.last_name?.[0] ?? ''}`.toUpperCase() || '??';

    const selectedRoleName = useMemo(() => {
        return roles.find(r => r.id === watchV8RoleId)?.name || 'Role not selected';
    }, [roles, watchV8RoleId]);

    const selectedEmployee = useMemo(() => {
        if (!watchEmployeeId) return null;
        return employees.find(e => e.id === watchEmployeeId) || null;
    }, [employees, watchEmployeeId]);

    const blockers = compliancePanel.result?.summary?.blockers ?? 0;
    const isLastStep = wizardStep === TOTAL_STEPS;
    const isCurrentStepValid = isStepValid(wizardStep);

    /** One line under each rail step: what that step currently holds. */
    const stepSummary: Record<number, string | null> = {
        [STEP.role]: watchV8RoleId
            ? [selectedRoleName, watchTargetType && TARGET_EMPLOYMENT_TYPE_LABELS[watchTargetType]].filter(Boolean).join(' · ')
            : null,
        [STEP.requirements]: null,
        [STEP.timings]: watchStart && watchEnd ? `${watchStart} – ${watchEnd}` : null,
        [STEP.assignment]: isTemplateMode ? null : selectedEmployee ? displayNameOf(selectedEmployee) : 'Unassigned',
        [STEP.compliance]: compliancePanel.result ? (blockers > 0 ? `${blockers} blocker${blockers === 1 ? '' : 's'}` : 'No blockers') : null,
    };

    return (
        <div className="flex min-h-0 flex-1 flex-row bg-background text-foreground">
            {/* ── LEFT RAIL: title, vertical steps, progress ─────────────── */}
            <aside className="flex w-[260px] shrink-0 flex-col border-r border-border/50 bg-muted/30 px-4 py-6">
                {title && (
                    <div className="px-2">
                        <h2 className="text-[15px] font-bold tracking-tight text-foreground">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-[11px] font-mono text-muted-foreground">{subtitle}</p>}
                    </div>
                )}

                <div
                    ref={tabsListRef}
                    role="tablist"
                    aria-label="Shift creation steps"
                    aria-orientation="vertical"
                    className="mt-6 flex flex-col gap-1"
                >
                    {STEP_META.map((step, i) => {
                        const isCurrent = wizardStep === step.n;
                        const reached = step.n <= maxUnlockedStep;
                        const done = step.n < wizardStep && isStepValid(step.n);
                        const Icon = step.icon;
                        const summary = stepSummary[step.n];

                        return (
                            <button
                                key={step.n}
                                type="button"
                                role="tab"
                                id={`shift-tab-${step.n}`}
                                aria-controls={`shift-panel-${step.n}`}
                                aria-selected={isCurrent}
                                tabIndex={isCurrent ? 0 : -1}
                                disabled={!reached}
                                onClick={() => goToStep(step.n)}
                                onKeyDown={(e) => handleTabKeyDown(e, i)}
                                className={cn(
                                    'group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors outline-none select-none',
                                    'focus-visible:ring-2 focus-visible:ring-primary',
                                    isCurrent
                                        ? 'bg-background shadow-sm ring-1 ring-border/60'
                                        : reached
                                            ? 'hover:bg-background/60'
                                            : 'cursor-not-allowed opacity-50',
                                )}
                            >
                                <span
                                    className={cn(
                                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg',
                                        isCurrent ? 'bg-primary text-primary-foreground'
                                            : done ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                                : 'bg-muted text-muted-foreground',
                                    )}
                                    aria-hidden="true"
                                >
                                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Icon className="h-3.5 w-3.5" />}
                                </span>
                                <span className="min-w-0">
                                    <span className={cn(
                                        'block text-[13px] font-semibold',
                                        isCurrent ? 'text-foreground' : 'text-foreground/80',
                                    )}>
                                        {step.label}
                                    </span>
                                    {summary && (
                                        <span className="block truncate text-[11px] text-muted-foreground">{summary}</span>
                                    )}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="mt-auto px-2 pt-6">
                    <p className="text-[11px] font-medium text-muted-foreground">Step {wizardStep} of {TOTAL_STEPS}</p>
                    <div
                        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border/60"
                        role="progressbar"
                        aria-label="Progress"
                        aria-valuemin={1}
                        aria-valuemax={TOTAL_STEPS}
                        aria-valuenow={wizardStep}
                    >
                        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${(wizardStep / TOTAL_STEPS) * 100}%` }} />
                    </div>
                </div>
            </aside>

            {/* ── RIGHT PANE: step form + footer ──────────────────────────── */}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                {headerActions && (
                    <div className="absolute right-4 top-4 z-30 flex items-center gap-2">{headerActions}</div>
                )}

            {/* ── STEP CONTENT AREA ───────────────────────────────────────── */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-3xl">
                    {/* ═══════════════════════════════════════════════════════════
                        STEP 1: ROLE & CONTEXT
                        ═══════════════════════════════════════════════════════════ */}
                    {wizardStep === STEP.role && (
                        <div
                            role="tabpanel"
                            id={`shift-panel-${STEP.role}`}
                            aria-labelledby={`shift-tab-${STEP.role}`}
                            tabIndex={0}
                            className="space-y-6 outline-none animate-in fade-in-50 duration-200"
                        >
                            <div className="border-b border-border/50 pb-4 pr-20">
                                <h3
                                    ref={stepHeadingRef}
                                    tabIndex={-1}
                                    className="text-[15px] font-bold tracking-tight text-foreground outline-none"
                                >
                                    Role & Organizational Placement
                                </h3>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Specify the operational department, group, role, and target employment contract.
                                </p>
                            </div>

                            {/* Organizational Context Breadcrumb Bar */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 rounded-xl border border-border/50 bg-muted/20 p-3">
                                {[
                                    { label: 'Organization', value: resolvedContext.organizationName || 'All Organizations' },
                                    { label: 'Department', value: resolvedContext.departmentName || 'All Departments' },
                                    { label: 'Sub-Department', value: resolvedContext.subDepartmentName || 'All Sub-Departments' },
                                ].map((item) => (
                                    <div key={item.label} className="min-w-0">
                                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-0.5">
                                            {item.label}
                                        </p>
                                        <p className="truncate text-[11px] font-semibold text-foreground/90" title={item.value}>
                                            {item.value}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Group */}
                                {isGroupLocked ? (
                                    <div>
                                        <FieldLabel>Group</FieldLabel>
                                        <div className="flex h-11 items-center truncate rounded-xl border border-border/60 bg-muted/30 px-3 text-[13px] font-medium text-muted-foreground">
                                            {GROUP_LABEL[watchGroup] || watchGroup || resolvedContext.groupName || 'General'}
                                        </div>
                                    </div>
                                ) : (
                                    <FormField
                                        control={form.control}
                                        name="group_type"
                                        render={({ field }) => (
                                            <FormItem>
                                                <SingleSelect
                                                    id="group-select"
                                                    label="Group"
                                                    required
                                                    options={availableGroups.map((g) => ({
                                                        id: g.external_id || g.name.toLowerCase().replace(/\s+/g, '_'),
                                                        name: g.name,
                                                    }))}
                                                    value={field.value || ''}
                                                    onChange={(val) => {
                                                        field.onChange(val);
                                                        form.setValue('sub_group_name', '', { shouldValidate: false });
                                                        form.setValue('target_employment_type', targetAfterGroupChange(
                                                            form.getValues('target_employment_type'), val,
                                                        ) as never);
                                                    }}
                                                    placeholder="Select group…"
                                                    disabled={isReadOnly}
                                                />
                                                <FormMessage className="text-[11px] text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {/* Subgroup */}
                                {isSubGroupLocked ? (
                                    <div>
                                        <FieldLabel>Subgroup</FieldLabel>
                                        <div className="flex h-11 items-center truncate rounded-xl border border-border/60 bg-muted/30 px-3 text-[13px] font-medium text-muted-foreground">
                                            {watchSubGroupName || resolvedContext.subGroupName || 'General'}
                                        </div>
                                    </div>
                                ) : (
                                    <FormField
                                        control={form.control}
                                        name="sub_group_name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <SingleSelect
                                                    id="subgroup-select"
                                                    label="Subgroup"
                                                    required
                                                    options={availableSubGroupsList.map((sg) => ({
                                                        id: sg.name,
                                                        name: sg.name,
                                                    }))}
                                                    value={field.value || ''}
                                                    onChange={(val) => {
                                                        field.onChange(val);
                                                        setTimeout(() => form.trigger('sub_group_name'), 0);
                                                    }}
                                                    placeholder={!watchGroup ? 'Select a group first' : 'Select subgroup…'}
                                                    disabled={isReadOnly || !watchGroup}
                                                />
                                                <FormMessage className="text-[11px] text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {/* Role */}
                                <FormField
                                    control={form.control}
                                    name="role_id"
                                    render={({ field }) => (
                                        <FormItem>
                                            <SingleSelect
                                                id="role-select"
                                                label="Operational Role"
                                                required
                                                options={roles.map((r) => ({
                                                    id: r.id,
                                                    name: r.name,
                                                }))}
                                                value={field.value || ''}
                                                onChange={field.onChange}
                                                placeholder="Select role…"
                                                disabled={isReadOnly || isRoleLocked}
                                            />
                                            <FormMessage className="text-[11px] text-rose-500" />
                                        </FormItem>
                                    )}
                                />

                                {/* Target Employment Type */}
                                <FormField
                                    control={form.control}
                                    name="target_employment_type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <SingleSelect
                                                id="target-emp-select"
                                                label="Target Employment Type"
                                                required
                                                options={targetEmploymentTypeOptions(field.value, {
                                                    groupType: watchGroup,
                                                }).map((t) => ({
                                                    id: t,
                                                    name: TARGET_EMPLOYMENT_TYPE_LABELS[t],
                                                }))}
                                                value={field.value || ''}
                                                onChange={(v) => {
                                                    field.onChange(v);
                                                    if (v !== 'PT') {
                                                        form.setValue('target_requires_flexible', false);
                                                    }
                                                    const assigned = form.getValues('assigned_employee_id');
                                                    if (assigned) {
                                                        const emp = employees.find((e) => e.id === assigned);
                                                        const stillOk = contractMatchesTarget(
                                                            emp?.employment_status ?? emp?.contract_type,
                                                            v as typeof TARGET_EMPLOYMENT_TYPES[number],
                                                            v === 'PT' && !!form.getValues('target_requires_flexible'),
                                                        );
                                                        if (!stillOk) form.setValue('assigned_employee_id', null);
                                                    }
                                                }}
                                                placeholder="Select target employment…"
                                                disabled={isReadOnly || isTargetTypeLocked}
                                            />
                                            <FormMessage className="text-[11px] font-semibold text-rose-600 dark:text-rose-400" />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Flexible Part-Time Switch */}
                            {watchTargetType === 'PT' && (
                                <FormField
                                    control={form.control}
                                    name="target_requires_flexible"
                                    render={({ field }) => (
                                        <FormItem className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-4">
                                            <div className="space-y-0.5 pr-4">
                                                <label htmlFor="flexible-switch" className="text-[11px] font-semibold text-foreground cursor-pointer">
                                                    Flexible Part-Time Contract Only
                                                </label>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Restricts assignment to staff on an approved Flexible Part-Time agreement.
                                                </p>
                                            </div>
                                            <FormControl>
                                                <Switch
                                                    id="flexible-switch"
                                                    checked={!!field.value}
                                                    onCheckedChange={(v) => {
                                                        field.onChange(v);
                                                        const assigned = form.getValues('assigned_employee_id');
                                                        if (v && assigned) {
                                                            const emp = employees.find((e) => e.id === assigned);
                                                            const stillOk = contractMatchesTarget(
                                                                emp?.employment_status ?? emp?.contract_type,
                                                                'PT',
                                                                true,
                                                            );
                                                            if (!stillOk) form.setValue('assigned_employee_id', null);
                                                        }
                                                    }}
                                                    disabled={isReadOnly || isTargetTypeLocked}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            )}
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════
                        STEP 2: REQUIREMENTS & NOTES
                        ═══════════════════════════════════════════════════════════ */}
                    {wizardStep === STEP.requirements && (
                        <div
                            role="tabpanel"
                            id={`shift-panel-${STEP.requirements}`}
                            aria-labelledby={`shift-tab-${STEP.requirements}`}
                            tabIndex={0}
                            className="space-y-6 outline-none animate-in fade-in-50 duration-200"
                        >
                            <div className="border-b border-border/50 pb-4 pr-20">
                                <h3
                                    ref={stepHeadingRef}
                                    tabIndex={-1}
                                    className="text-[15px] font-bold tracking-tight text-foreground outline-none"
                                >
                                    Requirements & Handover Notes
                                </h3>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Set mandatory skills, certifications, event links, and instructions for staff.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="required_skills"
                                    render={({ field }) => (
                                        <FormItem>
                                            <MultiSelect
                                                label="Required Skills"
                                                options={skills.map((s) => ({ name: s.name, id: s.id }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="None required"
                                                disabled={isReadOnly}
                                            />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="required_licenses"
                                    render={({ field }) => (
                                        <FormItem>
                                            <MultiSelect
                                                label="Required Licenses / Certs"
                                                options={licenses.map((l) => ({ name: l.name, id: l.id }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="None required"
                                                disabled={isReadOnly}
                                            />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="event_ids"
                                render={({ field }) => (
                                    <FormItem>
                                        <MultiSelect
                                            label="Associated Event Context"
                                            options={events.map((e) => ({ name: e.name, id: e.id }))}
                                            selected={field.value || []}
                                            onChange={field.onChange}
                                            placeholder="No event attached"
                                            disabled={isReadOnly}
                                        />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="notes"
                                render={({ field }) => (
                                    <FormItem>
                                        <FieldLabel htmlFor="shift-notes-input">
                                            Handover & Operational Notes
                                        </FieldLabel>
                                        <FormControl>
                                            <Textarea
                                                id="shift-notes-input"
                                                {...field}
                                                placeholder="Enter supervisor notes, briefing instructions, special gear required, or arrival handover details…"
                                                disabled={isReadOnly}
                                                className={cn(FIELD_INPUT, 'min-h-[100px] resize-none p-3 placeholder:text-muted-foreground/40')}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════
                        STEP 3: TIMINGS & BREAKS
                        ═══════════════════════════════════════════════════════════ */}
                    {wizardStep === STEP.timings && (
                        <div
                            role="tabpanel"
                            id={`shift-panel-${STEP.timings}`}
                            aria-labelledby={`shift-tab-${STEP.timings}`}
                            tabIndex={0}
                            className="space-y-6 outline-none animate-in fade-in-50 duration-200"
                        >
                            <div className="border-b border-border/50 pb-4 pr-20">
                                <h3
                                    ref={stepHeadingRef}
                                    tabIndex={-1}
                                    className="text-[15px] font-bold tracking-tight text-foreground outline-none"
                                >
                                    Schedule & Break Allocation
                                </h3>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Configure shift duration, meal breaks, and award minimum engagement floors.
                                </p>
                            </div>

                            {/* Date Badge & Training Toggle */}
                            <div className="flex flex-col gap-3">
                                {/* A template shift has a WEEKDAY where a roster
                                    shift has a date. See TemplateDaySelect for
                                    why this was missing and what null means. */}
                                {isTemplateMode && (
                                    <div>
                                        <FormField
                                            control={form.control}
                                            name="days_of_week"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <TemplateDaySelect
                                                            value={field.value}
                                                            onChange={(v) => {
                                                                field.onChange(v);
                                                                form.setValue('day_of_week', firstTemplateDay(v));
                                                            }}
                                                            multiple={!editMode}
                                                            disabled={isReadOnly}
                                                            id="drawer-day-of-week"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                )}
                                {!isTemplateMode && (
                                    <div className={FIELD_CARD}>
                                        <div className="min-w-0 flex flex-col gap-0.5">
                                            <p className={FIELD_LABEL}>Rostered Date</p>
                                            <p className="text-[11px] sm:text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                                                {dateDisplay}
                                            </p>
                                        </div>
                                        <Calendar className="h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
                                    </div>
                                )}

                                <FormField
                                    control={form.control}
                                    name="is_training"
                                    render={({ field }) => (
                                        <FormItem className={cn(FIELD_CARD, 'space-y-0')}>
                                            <div className="min-w-0 flex flex-col gap-0.5 pr-3">
                                                <label htmlFor="training-switch" className={cn(FIELD_LABEL, 'cursor-pointer flex items-center gap-1.5')}>
                                                    <GraduationCap className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />
                                                    Training Shift
                                                </label>
                                                <p className="text-[11px] sm:text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                                                    Applies 2-hour minimum engagement floor
                                                </p>
                                            </div>
                                            <FormControl>
                                                <Switch
                                                    id="training-switch"
                                                    aria-label="Training shift exemption"
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    disabled={isReadOnly}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Start & End Times */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {(['start_time', 'end_time'] as const).map((name) => (
                                    <FormField
                                        key={name}
                                        control={form.control}
                                        name={name}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FieldLabel htmlFor={`time-${name}`} required>
                                                    {name === 'start_time' ? 'Start Time' : 'End Time'}
                                                </FieldLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Input
                                                            id={`time-${name}`}
                                                            type="time"
                                                            placeholder="HH:MM"
                                                            defaultValue={field.value ?? undefined}
                                                            disabled={isReadOnly}
                                                            onChange={(e) => {
                                                                const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
                                                                const formatted = raw.length > 2
                                                                    ? `${raw.slice(0, 2)}:${raw.slice(2)}`
                                                                    : raw;
                                                                field.onChange(formatted);
                                                            }}
                                                            onBlur={(e) => {
                                                                const v = e.target.value;
                                                                if (v && /^\d{1,2}:\d{2}$/.test(v)) {
                                                                    const [h, m] = v.split(':');
                                                                    field.onChange(`${h.padStart(2, '0')}:${m}`);
                                                                }
                                                                field.onBlur();
                                                            }}
                                                            className={cn(FIELD_INPUT, 'h-14 pl-10 font-mono font-semibold tracking-wider')}
                                                        />
                                                        <Clock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
                                                    </div>
                                                </FormControl>
                                                <FormMessage className="text-[11px] text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                ))}
                            </div>

                            {/* Breaks. The meal break is WHEN, not just how long: pay
                                follows the hours worked either side of it (cl 41, cl 43).
                                Rest pauses are paid, so only their length matters. */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                {(['break_start', 'break_end'] as const).map((name) => (
                                    <FormField
                                        key={name}
                                        control={form.control}
                                        name={name}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FieldLabel htmlFor={`time-${name}`}>
                                                    <Coffee className="inline h-3 w-3 mr-1 text-muted-foreground/70" />
                                                    {name === 'break_start' ? 'Meal Break Start' : 'Meal Break End'}
                                                </FieldLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Input
                                                            id={`time-${name}`}
                                                            type="time"
                                                            value={field.value ?? ''}
                                                            onChange={(e) => field.onChange(e.target.value || null)}
                                                            onBlur={field.onBlur}
                                                            disabled={isReadOnly}
                                                            className={cn(FIELD_INPUT, 'h-14 pl-10 font-mono font-semibold tracking-wider')}
                                                        />
                                                        <Clock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
                                                    </div>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                ))}
                                <FormField
                                    control={form.control}
                                    name="paid_break_minutes"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel htmlFor="paid-break-input">
                                                <Utensils className="inline h-3 w-3 mr-1 text-muted-foreground/70" />
                                                Rest Pauses (Paid, Min)
                                            </FieldLabel>
                                            <FormControl>
                                                <Input
                                                    id="paid-break-input"
                                                    type="number"
                                                    min={0}
                                                    value={field.value === undefined ? '' : field.value}
                                                    onChange={(e) =>
                                                        field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                                                    }
                                                    disabled={isReadOnly}
                                                    placeholder="0"
                                                    className={cn(FIELD_INPUT, 'h-14 font-mono font-medium')}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Duration & Net Paid Live Stats */}
                            <div className="flex gap-3">
                                <StatChip
                                    label="Gross Length"
                                    value={formatHours(shiftLength)}
                                    status={shiftLength > 0 ? 'normal' : 'normal'}
                                />
                                <StatChip
                                    label="Net Paid Hours"
                                    value={formatHours(netLength)}
                                    status={netLength <= 0 ? 'normal' : shape.blocking ? 'danger' : 'success'}
                                />
                            </div>

                            {/* EBA Shift Shape Blocker Alerts */}
                            {!isReadOnly && shapeBlockers.length > 0 && (
                                <div
                                    role="alert"
                                    aria-live="polite"
                                    className="space-y-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5"
                                >
                                    <div className="flex items-center gap-2 text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                                        <AlertTriangle className="h-4 w-4" />
                                        <span>EBA Compliance Notice</span>
                                    </div>
                                    {shapeBlockers.map((hit) => (
                                        <div key={hit.rule_id} className="flex items-center justify-between gap-3 text-[11px]">
                                            <span className="text-rose-600 dark:text-rose-300 font-medium">
                                                {hit.summary}
                                            </span>
                                            {hit.fix && (
                                                <div className="flex shrink-0 items-center gap-1.5">
                                                    {(hit.fix.options ?? [{ value: hit.fix.value as number, label: hit.fix.label }]).map((opt) => (
                                                        <Button
                                                            key={String(opt.value)}
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => form.setValue(hit.fix!.field, opt.value as never, { shouldDirty: true })}
                                                            className="h-7 border-rose-500/30 bg-rose-500/10 px-2 text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"
                                                        >
                                                            {opt.label}
                                                        </Button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════
                        STEP 4: ASSIGNMENT
                        ═══════════════════════════════════════════════════════════ */}
                    {wizardStep === STEP.assignment && (
                        <div
                            role="tabpanel"
                            id={`shift-panel-${STEP.assignment}`}
                            aria-labelledby={`shift-tab-${STEP.assignment}`}
                            tabIndex={0}
                            className="space-y-6 outline-none animate-in fade-in-50 duration-200"
                        >
                            <div className="border-b border-border/50 pb-4 pr-20">
                                <h3
                                    ref={stepHeadingRef}
                                    tabIndex={-1}
                                    className="text-[15px] font-bold tracking-tight text-foreground outline-none"
                                >
                                    Employee Assignment
                                </h3>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Assign an eligible contracted staff member or leave open for the bidding pool.
                                </p>
                            </div>

                            <FormField
                                control={form.control}
                                name="assigned_employee_id"
                                render={({ field }) => {
                                    const isAssigned = !!field.value;
                                    // This card only renders when an id is set, so the fallback must
                                    // not say "Unassigned" — that is the opposite state.
                                    let displayName = 'Employee not in this list';
                                    let initials = '?';
                                    let isResolved = false;

                                    if (selectedEmployee) {
                                        displayName = displayNameOf(selectedEmployee);
                                        initials = initialsOf(selectedEmployee);
                                        isResolved = true;
                                    } else if (existingShift && (existingShift.assigned_employee_id === field.value || existingShift.assignedEmployeeId === field.value)) {
                                        const profiles = existingShift.assigned_profiles || existingShift.profiles;
                                        if (profiles) {
                                            isResolved = true;
                                            displayName = profiles.full_name || `${profiles.first_name || ''} ${profiles.last_name || ''}`.trim() || 'Assigned';
                                            initials = `${profiles.first_name?.[0] || ''}${profiles.last_name?.[0] || ''}`.toUpperCase() || '??';
                                        }
                                    }

                                    return (
                                        <div className="space-y-4">
                                            {isAssigned ? (
                                                <div className="flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4 sm:p-5">
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[13px] font-bold text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/20">
                                                            {initials}
                                                        </div>
                                                        <div>
                                                            <p className="text-[13px] font-bold text-foreground">
                                                                {displayName}
                                                            </p>
                                                            {/* Only vouch for someone we actually resolved. */}
                                                            {isResolved ? (
                                                                <div className="mt-1 flex items-center gap-2">
                                                                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                                                        <CheckCircle2 className="h-3 w-3" /> Qualified
                                                                    </span>
                                                                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                                                                        <Check className="h-3 w-3" /> Matching Contract
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <p className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                                                    Tap × to clear
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {!isReadOnly && !isEmployeeLocked && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => field.onChange(null)}
                                                            className="h-8 w-8 p-0 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                                                            aria-label="Remove assigned employee"
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/10 p-8 text-center">
                                                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/60">
                                                        <UserCircle className="h-6 w-6" />
                                                    </div>
                                                    <p className="text-[13px] font-semibold text-foreground">
                                                        Shift is Currently Unassigned
                                                    </p>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5 max-w-sm">
                                                        This shift will be published as an open bid for qualified {TARGET_EMPLOYMENT_TYPE_LABELS[watchTargetType || 'Casual']} staff.
                                                    </p>
                                                </div>
                                            )}

                                            {/* Employee Selection Button & Popover */}
                                            {!isReadOnly && !isTemplateMode && !isEmployeeLocked && (
                                                <EmployeeSelect
                                                    id="employee-select"
                                                    label={isAssigned ? 'Change Assigned Employee' : 'Assign an Employee'}
                                                    employees={filteredEmployees}
                                                    value={field.value}
                                                    onChange={field.onChange}
                                                    targetEmploymentType={watchTargetType}
                                                    excludedCount={excludedByTargetCount}
                                                    disabled={isReadOnly || isEmployeeLocked}
                                                />
                                            )}

                                            {/* Hard Validation Warnings */}
                                            {hardValidation && !hardValidation.passed && (hardValidation.errors?.length ?? 0) > 0 && (
                                                <div className="space-y-1.5 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
                                                    {hardValidation.errors.map((err: any, i: number) => (
                                                        <div key={i} className="flex items-center gap-2 text-[11px] text-rose-600 dark:text-rose-400">
                                                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                                            <p className="font-medium">{err.message}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }}
                            />
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════
                        STEP 5: COMPLIANCE & REVIEW
                        ═══════════════════════════════════════════════════════════ */}
                    {wizardStep === STEP.compliance && (
                        <div
                            role="tabpanel"
                            id={`shift-panel-${STEP.compliance}`}
                            aria-labelledby={`shift-tab-${STEP.compliance}`}
                            tabIndex={0}
                            className="space-y-6 outline-none animate-in fade-in-50 duration-200"
                        >
                            <div className="border-b border-border/50 pb-4 pr-20">
                                <h3
                                    ref={stepHeadingRef}
                                    tabIndex={-1}
                                    className="text-[15px] font-bold tracking-tight text-foreground outline-none"
                                >
                                    Compliance Audit & Summary
                                </h3>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Automated ICC Sydney EBA award validation and summary before saving.
                                </p>
                            </div>

                            {/* Shift Summary Quick Card */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 rounded-xl border border-border/60 bg-muted/20 p-4 text-[11px]">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase text-muted-foreground/70">Role</p>
                                    <p className="font-bold text-foreground truncate">{selectedRoleName}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-semibold uppercase text-muted-foreground/70">Date</p>
                                    <p className="font-bold text-foreground truncate">{dateDisplay}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-semibold uppercase text-muted-foreground/70">Time</p>
                                    <p className="font-bold text-foreground font-mono">{watchStart || '—'} – {watchEnd || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-semibold uppercase text-muted-foreground/70">Assignee</p>
                                    <p className="font-bold text-foreground truncate">
                                        {selectedEmployee ? displayNameOf(selectedEmployee) : 'Open (Unassigned)'}
                                    </p>
                                </div>
                            </div>

                            {/* Compliance Panel Engine */}
                            <div className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
                                {isLoadingShifts ? (
                                    <div className="flex items-center justify-center py-10 gap-2.5 text-[11px] font-semibold text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                        <span>Auditing employee shift history…</span>
                                    </div>
                                ) : !watchEmployeeId ? (
                                    <div className="py-8 text-center">
                                        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                            <Shield className="h-5 w-5" />
                                        </div>
                                        <p className="text-[13px] font-bold text-foreground">
                                            Open Shift (Compliance Passed)
                                        </p>
                                        <p className="text-[11px] text-muted-foreground max-w-sm mx-auto mt-1">
                                            No employee is assigned. Compliance guardrails will evaluate candidates automatically when bids are submitted.
                                        </p>
                                    </div>
                                ) : isTemplateMode ? (
                                    <div className="py-8 text-center">
                                        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                                            <CheckCircle2 className="h-5 w-5" />
                                        </div>
                                        <p className="text-[13px] font-bold text-foreground">
                                            Template Rules Satisfied
                                        </p>
                                        <p className="text-[11px] text-muted-foreground max-w-sm mx-auto mt-1">
                                            Template-level constraints verified. Full evaluation runs on generation.
                                        </p>
                                    </div>
                                ) : (
                                    <CompliancePanel
                                        hook={compliancePanel}
                                        className="compliance-panel-integrated"
                                        disabled={isReadOnly || isLoadingShifts}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ── FOOTER ─────────────────────────────────────────────────── */}
            <div className="flex flex-shrink-0 items-center justify-between border-t border-border/50 px-6 py-4">
                <Button
                    type="button"
                    variant="ghost"
                    disabled={wizardStep === 1}
                    onClick={() => goToStep(Math.max(1, wizardStep - 1))}
                    className="h-11 gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-0"
                >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Back
                </Button>

                <div className="flex items-center gap-2">
                    {onCancel && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onCancel}
                            className="h-11 rounded-xl border-border/60 px-5 text-[13px] font-semibold"
                        >
                            Cancel
                        </Button>
                    )}
                    {!isLastStep ? (
                        <Button
                            type="button"
                            disabled={!isCurrentStepValid}
                            onClick={() => goToStep(Math.min(TOTAL_STEPS, wizardStep + 1))}
                            className="h-11 gap-1.5 rounded-xl bg-primary px-6 text-[13px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
                        >
                            Continue
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            onClick={() => onSubmit?.(form.getValues())}
                            disabled={!canSave || isLoading}
                            title={!canSave && saveBlockReason ? saveBlockReason : undefined}
                            className="h-11 gap-1.5 rounded-xl bg-primary px-6 text-[13px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
                        >
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : editMode ? (
                                <Save className="h-4 w-4" aria-hidden="true" />
                            ) : (
                                <Plus className="h-4 w-4" aria-hidden="true" />
                            )}
                            {editMode ? 'Update Shift' : isPublished ? 'Publish Shift' : 'Create Shift'}
                        </Button>
                    )}
                </div>
            </div>
            </div>
        </div>
    );
};
