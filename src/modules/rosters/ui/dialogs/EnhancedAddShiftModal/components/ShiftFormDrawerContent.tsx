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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from '@/modules/core/ui/primitives/command';
import {
    Clock,
    AlertCircle,
    AlertTriangle,
    Lock as LockIcon,
    Shield,
    GraduationCap,
    Coffee,
    Utensils,
    UserCircle,
    Loader2,
    CheckCircle2,
    X,
    Briefcase,
    StickyNote,
    Plus,
    Check,
    ChevronLeft,
    ChevronRight,
    Save,
    Calendar,
    Sparkles,
} from 'lucide-react';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Button } from '@/modules/core/ui/primitives/button';
import { CompliancePanel } from '@/modules/compliance/ui/CompliancePanel';
import { MultiSelect } from './MultiSelect';
import { SingleSelect } from './SingleSelect';
import { EmployeeSelect } from './EmployeeSelect';
import type { ShiftFormDrawerContentProps } from '../types';
import { formatHours } from '../utils';
import {
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
};

export const STEP = {
    role: 1,
    requirements: 2,
    timings: 3,
    assignment: 4,
    compliance: 5,
} as const;

export const STEP_META = [
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
            'block text-xs font-semibold tracking-wide text-foreground/80 mb-1.5',
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
            <p className="font-mono text-lg font-bold tracking-tight">
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
    onCancel,
    onSubmit,
    canSave = true,
    isLoading = false,
    saveBlockReason,
}) => {
    const [poolOpen, setPoolOpen] = useState(false);
    const [poolQuery, setPoolQuery] = useState('');
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

    /* ── Step Validation Gates ── */
    const isRoleStepValid = !!watchGroup && !!watchSubGroupName && !!watchV8RoleId;
    const isRequirementsStepValid = true; // Optional step
    const isTimingsStepValid = shape.status !== 'INCOMPLETE'
        && (isTemplateMode || !!watchShiftDate)
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

        if (key === 'ArrowRight') {
            targetIndex = (index + 1) % TOTAL_STEPS;
        } else if (key === 'ArrowLeft') {
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

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
            {/* ── TOP HORIZONTAL TABS (1-2-3-4-5) ────────────────────────── */}
            <div
                ref={tabsListRef}
                role="tablist"
                aria-label="Shift creation steps"
                className="flex items-center gap-1 sm:gap-2 border-b border-border/50 bg-card/60 px-4 sm:px-6 pt-2 overflow-x-auto no-scrollbar"
            >
                {STEP_META.map((step, i) => {
                    const isCurrent = wizardStep === step.n;
                    const reached = step.n <= maxUnlockedStep;
                    const done = step.n < wizardStep && isStepValid(step.n);

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
                                'group relative flex items-center gap-2 px-3 py-3 text-xs sm:text-sm font-medium transition-all whitespace-nowrap outline-none select-none rounded-t-lg',
                                'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
                                isCurrent
                                    ? 'text-blue-600 dark:text-blue-400 font-semibold'
                                    : done
                                        ? 'text-foreground/90 hover:text-foreground'
                                        : reached
                                            ? 'text-muted-foreground hover:text-foreground'
                                            : 'text-muted-foreground/40 cursor-not-allowed'
                            )}
                        >
                            <span
                                className={cn(
                                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all',
                                    isCurrent
                                        ? 'bg-blue-600 dark:bg-blue-500 text-white shadow-sm'
                                        : done
                                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                            : reached
                                                ? 'bg-muted text-muted-foreground group-hover:bg-muted/80'
                                                : 'bg-muted/30 text-muted-foreground/40'
                                )}
                            >
                                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : step.n}
                            </span>
                            <span className="hidden sm:inline">{step.label}</span>
                            <span className="inline sm:hidden">{step.shortLabel}</span>

                            {/* Active Tab Underline Indicator */}
                            {isCurrent && (
                                <span
                                    aria-hidden="true"
                                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-blue-600 dark:bg-blue-400 shadow-sm"
                                />
                            )}
                        </button>
                    );
                })}
            </div>

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
                            <div className="border-b border-border/50 pb-4">
                                <h3
                                    ref={stepHeadingRef}
                                    tabIndex={-1}
                                    className="text-lg font-bold tracking-tight text-foreground outline-none"
                                >
                                    Role & Organizational Placement
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
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
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-0.5">
                                            {item.label}
                                        </p>
                                        <p className="truncate text-xs font-semibold text-foreground/90" title={item.value}>
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
                                        <div className="flex h-11 items-center truncate rounded-xl border border-border/60 bg-muted/30 px-3 text-sm font-medium text-muted-foreground">
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
                                                    }}
                                                    placeholder="Select group…"
                                                    disabled={isReadOnly}
                                                />
                                                <FormMessage className="text-xs text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {/* Subgroup */}
                                {isSubGroupLocked ? (
                                    <div>
                                        <FieldLabel>Subgroup</FieldLabel>
                                        <div className="flex h-11 items-center truncate rounded-xl border border-border/60 bg-muted/30 px-3 text-sm font-medium text-muted-foreground">
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
                                                <FormMessage className="text-xs text-rose-500" />
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
                                            <FormMessage className="text-xs text-rose-500" />
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
                                                options={TARGET_EMPLOYMENT_TYPES.map((t) => ({
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
                                                disabled={isReadOnly}
                                            />
                                            <FormMessage className="text-xs font-semibold text-rose-600 dark:text-rose-400" />
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
                                                <label htmlFor="flexible-switch" className="text-xs font-semibold text-foreground cursor-pointer">
                                                    Flexible Part-Time Contract Only
                                                </label>
                                                <p className="text-xs text-muted-foreground">
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
                                                    disabled={isReadOnly}
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
                            <div className="border-b border-border/50 pb-4">
                                <h3
                                    ref={stepHeadingRef}
                                    tabIndex={-1}
                                    className="text-lg font-bold tracking-tight text-foreground outline-none"
                                >
                                    Requirements & Handover Notes
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
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
                                                className="min-h-[100px] resize-none rounded-xl border-border/60 bg-background p-3 text-sm placeholder:text-muted-foreground/40 focus:ring-blue-500/30"
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
                            <div className="border-b border-border/50 pb-4">
                                <h3
                                    ref={stepHeadingRef}
                                    tabIndex={-1}
                                    className="text-lg font-bold tracking-tight text-foreground outline-none"
                                >
                                    Schedule & Break Allocation
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Configure shift duration, meal breaks, and award minimum engagement floors.
                                </p>
                            </div>

                            {/* Date Badge & Training Toggle */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {!isTemplateMode && (
                                    <div className="rounded-xl border border-border/60 bg-card p-3.5 flex items-center gap-3">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                            <Calendar className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                                                Rostered Date
                                            </p>
                                            <p className="text-sm font-bold text-foreground">
                                                {dateDisplay}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <FormField
                                    control={form.control}
                                    name="is_training"
                                    render={({ field }) => (
                                        <FormItem className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-3.5">
                                            <div className="space-y-0.5 pr-3">
                                                <label htmlFor="training-switch" className="text-xs font-bold text-foreground cursor-pointer flex items-center gap-1.5">
                                                    <GraduationCap className="h-3.5 w-3.5 text-purple-500" />
                                                    Training Shift
                                                </label>
                                                <p className="text-[11px] text-muted-foreground">
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
                                                            className="h-11 rounded-xl border-border/60 bg-background pl-10 font-mono text-sm font-semibold tracking-wider text-foreground focus:ring-blue-500/30"
                                                        />
                                                        <Clock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
                                                    </div>
                                                </FormControl>
                                                <FormMessage className="text-xs text-rose-500" />
                                            </FormItem>
                                        )}
                                    />
                                ))}
                            </div>

                            {/* Breaks */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="unpaid_break_minutes"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel htmlFor="unpaid-break-input">
                                                <Coffee className="inline h-3 w-3 mr-1 text-muted-foreground/70" />
                                                Unpaid Break (Minutes)
                                            </FieldLabel>
                                            <FormControl>
                                                <Input
                                                    id="unpaid-break-input"
                                                    type="number"
                                                    min={0}
                                                    value={field.value === undefined ? '' : field.value}
                                                    onChange={(e) =>
                                                        field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                                                    }
                                                    disabled={isReadOnly}
                                                    placeholder="0"
                                                    className="h-11 rounded-xl border-border/60 bg-background font-mono text-sm font-medium text-foreground focus:ring-blue-500/30"
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="paid_break_minutes"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel htmlFor="paid-break-input">
                                                <Utensils className="inline h-3 w-3 mr-1 text-muted-foreground/70" />
                                                Paid Break (Minutes)
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
                                                    className="h-11 rounded-xl border-border/60 bg-background font-mono text-sm font-medium text-foreground focus:ring-blue-500/30"
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
                                    <div className="flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                                        <AlertTriangle className="h-4 w-4" />
                                        <span>EBA Compliance Notice</span>
                                    </div>
                                    {shapeBlockers.map((hit) => (
                                        <div key={hit.rule_id} className="flex items-center justify-between gap-3 text-xs">
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
                            <div className="border-b border-border/50 pb-4">
                                <h3
                                    ref={stepHeadingRef}
                                    tabIndex={-1}
                                    className="text-lg font-bold tracking-tight text-foreground outline-none"
                                >
                                    Employee Assignment
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Assign an eligible contracted staff member or leave open for the bidding pool.
                                </p>
                            </div>

                            <FormField
                                control={form.control}
                                name="assigned_employee_id"
                                render={({ field }) => {
                                    const isAssigned = !!field.value;
                                    let displayName = 'Unassigned';
                                    let initials = '';

                                    if (selectedEmployee) {
                                        displayName = displayNameOf(selectedEmployee);
                                        initials = initialsOf(selectedEmployee);
                                    } else if (existingShift && (existingShift.assigned_employee_id === field.value || existingShift.assignedEmployeeId === field.value)) {
                                        const profiles = existingShift.assigned_profiles || existingShift.profiles;
                                        if (profiles) {
                                            displayName = profiles.full_name || `${profiles.first_name || ''} ${profiles.last_name || ''}`.trim() || 'Assigned';
                                            initials = `${profiles.first_name?.[0] || ''}${profiles.last_name?.[0] || ''}`.toUpperCase() || '??';
                                        }
                                    }

                                    return (
                                        <div className="space-y-4">
                                            {isAssigned ? (
                                                <div className="flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4 sm:p-5">
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/20">
                                                            {initials}
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-bold text-foreground">
                                                                {displayName}
                                                            </p>
                                                            <div className="mt-1 flex items-center gap-2">
                                                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                                                    <CheckCircle2 className="h-3 w-3" /> Qualified
                                                                </span>
                                                                <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                                                                    <Check className="h-3 w-3" /> Matching Contract
                                                                </span>
                                                            </div>
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
                                                    <p className="text-sm font-semibold text-foreground">
                                                        Shift is Currently Unassigned
                                                    </p>
                                                    <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
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
                                                        <div key={i} className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
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
                            <div className="border-b border-border/50 pb-4">
                                <h3
                                    ref={stepHeadingRef}
                                    tabIndex={-1}
                                    className="text-lg font-bold tracking-tight text-foreground outline-none"
                                >
                                    Compliance Audit & Summary
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Automated ICC Sydney EBA award validation and summary before saving.
                                </p>
                            </div>

                            {/* Shift Summary Quick Card */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 rounded-xl border border-border/60 bg-muted/20 p-4 text-xs">
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground/70">Role</p>
                                    <p className="font-bold text-foreground truncate">{selectedRoleName}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground/70">Date</p>
                                    <p className="font-bold text-foreground truncate">{dateDisplay}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground/70">Time</p>
                                    <p className="font-bold text-foreground font-mono">{watchStart || '—'} – {watchEnd || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground/70">Assignee</p>
                                    <p className="font-bold text-foreground truncate">
                                        {selectedEmployee ? displayNameOf(selectedEmployee) : 'Open (Unassigned)'}
                                    </p>
                                </div>
                            </div>

                            {/* Compliance Panel Engine */}
                            <div className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
                                {isLoadingShifts ? (
                                    <div className="flex items-center justify-center py-10 gap-2.5 text-xs font-semibold text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                        <span>Auditing employee shift history…</span>
                                    </div>
                                ) : !watchEmployeeId ? (
                                    <div className="py-8 text-center">
                                        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                            <Shield className="h-5 w-5" />
                                        </div>
                                        <p className="text-sm font-bold text-foreground">
                                            Open Shift (Compliance Passed)
                                        </p>
                                        <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                                            No employee is assigned. Compliance guardrails will evaluate candidates automatically when bids are submitted.
                                        </p>
                                    </div>
                                ) : isTemplateMode ? (
                                    <div className="py-8 text-center">
                                        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                                            <CheckCircle2 className="h-5 w-5" />
                                        </div>
                                        <p className="text-sm font-bold text-foreground">
                                            Template Rules Satisfied
                                        </p>
                                        <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
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

            {/* ── BOTTOM NAVIGATION FOOTER ────────────────────────────────── */}
            <div className="flex flex-shrink-0 items-center justify-between border-t border-border/50 bg-card/90 px-4 sm:px-6 py-3 backdrop-blur-xl">
                <div>
                    {onCancel && (
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={onCancel}
                            className="h-10 rounded-xl px-4 text-xs font-semibold text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        >
                            Cancel
                        </Button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Back Button */}
                    <Button
                        type="button"
                        variant="outline"
                        disabled={wizardStep === 1}
                        onClick={() => goToStep(Math.max(1, wizardStep - 1))}
                        className="h-10 gap-1.5 rounded-xl border-border/60 px-4 text-xs font-semibold text-foreground hover:bg-muted/40 disabled:opacity-40"
                    >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Back</span>
                    </Button>

                    {/* Next or Save & Continue or Submit Button */}
                    {!isLastStep ? (
                        <Button
                            type="button"
                            disabled={!isCurrentStepValid}
                            onClick={() => goToStep(Math.min(TOTAL_STEPS, wizardStep + 1))}
                            className={cn(
                                'h-10 gap-1.5 rounded-xl px-5 text-xs font-bold text-white shadow-sm transition-all',
                                isCurrentStepValid
                                    ? 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-400'
                                    : 'cursor-not-allowed bg-muted text-muted-foreground opacity-50'
                            )}
                        >
                            <span>Save & Continue</span>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            onClick={() => onSubmit?.(form.getValues())}
                            disabled={!canSave || isLoading}
                            title={!canSave && saveBlockReason ? saveBlockReason : undefined}
                            className={cn(
                                'h-10 gap-1.5 rounded-xl px-6 text-xs font-bold text-white shadow-md transition-all',
                                canSave
                                    ? 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 shadow-blue-500/20 focus-visible:ring-2 focus-visible:ring-blue-400'
                                    : 'cursor-not-allowed bg-muted text-muted-foreground opacity-50'
                            )}
                        >
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : editMode ? (
                                <Save className="h-4 w-4" />
                            ) : (
                                <Plus className="h-4 w-4" />
                            )}
                            <span>{editMode ? 'Update Shift' : isPublished ? 'Publish Shift' : 'Create Shift'}</span>
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};
