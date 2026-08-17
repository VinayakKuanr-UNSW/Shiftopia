/**
 * ShiftFormSheet — mobile Add / Edit Shift, as one form in a bottom sheet.
 *
 * The desktop wizard (ShiftFormDrawerContent) gates five steps behind Next
 * buttons, which on a phone means five taps and a hidden submit before anyone
 * can create a 4-hour shift. Here every field lives in one vertical scroll:
 * context → when → who → details → compliance, with the primary action pinned
 * to the bottom so it is always reachable.
 *
 * Same orchestrator, same schema, same submit path as desktop — this file is a
 * render layer only. Nothing here may decide whether a shift is legal; that is
 * `canSave` + the compliance panel, both computed upstream.
 *
 * Compliance runs BEFORE submission (auto, as soon as an assigned shift is
 * fully scheduled) rather than as a post-save surprise, and blockers/warnings
 * are surfaced directly above the button that would commit them.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
    FormControl,
    FormField,
    FormItem,
    FormMessage,
    Form,
} from '@/modules/core/ui/primitives/form';
import { Input } from '@/modules/core/ui/primitives/input';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Button } from '@/modules/core/ui/primitives/button';
import { Switch } from '@/modules/core/ui/primitives/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { cn } from '@/modules/core/lib/utils';
import {
    AlertCircle,
    AlertTriangle,
    Calendar,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock,
    GraduationCap,
    Loader2,
    Lock as LockIcon,
    MapPin,
    Plus,
    Save,
    Search,
    Shield,
    Undo2,
    UserCircle,
    Users,
    X,
} from 'lucide-react';

import { MultiSelect } from './MultiSelect';
import { ShiftBottomSheet } from './ShiftBottomSheet';
import { formatHours, calculateShiftLength } from '../utils';
import type { ShiftFormSheetProps } from '../types';
import {
    TARGET_EMPLOYMENT_TYPES,
    TARGET_EMPLOYMENT_TYPE_LABELS,
    contractMatchesTarget,
} from '@/modules/core/model/employment.types';

const GROUP_LABEL: Record<string, string> = {
    convention_centre: 'Convention Centre',
    exhibition_centre: 'Exhibition Centre',
    theatre: 'Theatre',
    the_cutaway: 'The Cutaway',
};

/* ═══════════════════════════════════════════════════════════════════════
   PRIMITIVES — sized for touch: 48px controls, 44px minimum hit areas
   ═══════════════════════════════════════════════════════════════════════ */

const Section: React.FC<{
    icon: React.ElementType;
    title: string;
    hint?: React.ReactNode;
    children: React.ReactNode;
}> = ({ icon: Icon, title, hint, children }) => (
    <section className="rounded-2xl border border-border/50 bg-muted/20 p-3.5 dark:bg-white/[0.02]">
        <header className="mb-3 flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-foreground/80">
                {title}
            </h3>
            {hint && (
                <span className="ml-auto text-[10px] font-semibold text-muted-foreground/60">
                    {hint}
                </span>
            )}
        </header>
        <div className="space-y-3">{children}</div>
    </section>
);

const FieldLabel: React.FC<{ children: React.ReactNode; required?: boolean }> = ({
    children,
    required,
}) => (
    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/80">
        {children}
        {required && <span className="ml-0.5 text-amber-500">*</span>}
    </p>
);

/** Locked context value — what the grid cell already decided for this shift. */
const ReadOnlyField: React.FC<{ label?: string; value: string; icon?: React.ElementType }> = ({
    label,
    value,
    icon: Icon,
}) => (
    <div>
        {label && <FieldLabel>{label}</FieldLabel>}
        <div className="flex h-12 items-center gap-2 truncate rounded-xl border border-border/40 bg-muted/40 px-3">
            {Icon ? (
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            ) : (
                <LockIcon className="h-3 w-3 shrink-0 text-muted-foreground/40" />
            )}
            <span className="truncate text-sm font-semibold text-foreground/75">{value}</span>
        </div>
    </div>
);

const SELECT_CLS =
    'h-12 rounded-xl border-border/60 bg-background text-sm font-medium data-[placeholder]:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-purple-500/30';
const INPUT_CLS =
    'h-12 rounded-xl border-border/60 bg-background text-base font-medium text-foreground focus-visible:ring-2 focus-visible:ring-purple-500/30 focus-visible:border-purple-500/50';

/* ═══════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════ */

export const ShiftFormSheet: React.FC<ShiftFormSheetProps> = ({
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
    isLoadingData,
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
    isGroupLocked,
    isSubGroupLocked,
    isRoleLocked,
    isEmployeeLocked,
    canUnpublish,
    onUnpublish,
    canSave,
    saveBlockReason,
    isLoading,
    onSubmit,
    onCancel,
    containerRef,
}) => {
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState('');
    const [showDetails, setShowDetails] = useState(false);

    /* ── Watched fields ── */
    const watchShiftDate    = form.watch('shift_date');
    const watchGroup        = form.watch('group_type');
    const watchSubGroupName = form.watch('sub_group_name');
    const watchUnpaidBreak  = form.watch('unpaid_break_minutes');
    const watchStart        = form.watch('start_time');
    const watchEnd          = form.watch('end_time');
    const watchRoleId       = form.watch('role_id');
    const watchEmployeeId   = form.watch('assigned_employee_id');
    const watchTargetType   = form.watch('target_employment_type');
    const watchTargetFlex   = form.watch('target_requires_flexible');

    /* ── Roster-derived group / sub-group options ── */
    const availableGroups = useMemo(() => {
        const roster = rosters.find(
            (r: any) => r.id === (selectedRosterId || resolvedContext.rosterId),
        );
        return roster?.groups || [];
    }, [rosters, selectedRosterId, resolvedContext.rosterId]);

    const availableSubGroups = useMemo(() => {
        if (!watchGroup) return [];
        const g = availableGroups.find(
            (x: any) =>
                x.external_id === watchGroup ||
                x.name.toLowerCase().replace(/\s+/g, '_') === watchGroup,
        );
        return g?.subGroups || [];
    }, [availableGroups, watchGroup]);

    const dateDisplay = useMemo(() => {
        if (watchShiftDate) return format(watchShiftDate, 'EEE, d MMM yyyy');
        if (resolvedContext.date) {
            try {
                return format(new Date(resolvedContext.date + 'T00:00:00'), 'EEE, d MMM yyyy');
            } catch {
                return resolvedContext.date;
            }
        }
        return 'No date';
    }, [watchShiftDate, resolvedContext.date]);

    /* ── Employee pool ──
       The employment target is a HARD requirement (V8 rule + solver + DB
       trigger), so mismatched staff are excluded outright rather than shown and
       then rejected on save. */
    const targetedEmployees = useMemo(() => {
        if (!watchTargetType) return employees;
        return employees.filter((e: any) =>
            contractMatchesTarget(
                e.employment_status ?? e.contract_type,
                watchTargetType,
                watchTargetType === 'PT' && !!watchTargetFlex,
            ),
        );
    }, [employees, watchTargetType, watchTargetFlex]);

    const displayNameOf = (e: any) =>
        e?.profiles?.full_name ||
        e?.full_name ||
        `${e?.first_name ?? ''} ${e?.last_name ?? ''}`.trim() ||
        'Employee';

    const initialsOf = (e: any) =>
        `${e?.first_name?.[0] ?? ''}${e?.last_name?.[0] ?? ''}`.toUpperCase() || '??';

    const searchedEmployees = useMemo(() => {
        const q = pickerQuery.trim().toLowerCase();
        if (!q) return targetedEmployees;
        return targetedEmployees.filter((e: any) =>
            displayNameOf(e).toLowerCase().includes(q),
        );
    }, [targetedEmployees, pickerQuery]);

    const excludedByTarget = employees.length - targetedEmployees.length;

    const assignedEmployee = useMemo(
        () => employees.find((e: any) => e.id === watchEmployeeId),
        [employees, watchEmployeeId],
    );

    /** Falls back to the shift's own joined profile so an employee who is no
     *  longer in the fetched pool still renders as a name, not a blank card. */
    const assignedName = useMemo(() => {
        if (assignedEmployee) return displayNameOf(assignedEmployee);
        const p = existingShift?.assigned_profiles || existingShift?.profiles;
        if (watchEmployeeId && p) {
            return p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Assigned';
        }
        return null;
    }, [assignedEmployee, existingShift, watchEmployeeId]);

    /* ── Break recommendation ── */
    const localLength = useMemo(
        () => calculateShiftLength(watchStart, watchEnd),
        [watchStart, watchEnd],
    );

    /* ── Compliance: run before submission, not after ──
       Mirrors the desktop step-5 auto-run. Guarded on status so the panel's own
       runningRef never sees a re-entrant call. */
    const panelStatus = compliancePanel.status;
    const scheduleDefined =
        !!watchRoleId && (!!watchShiftDate || isTemplateMode) && !!watchStart && !!watchEnd;

    useEffect(() => {
        if (isReadOnly || isTemplateMode) return;
        if (!watchEmployeeId) return;          // unassigned → nothing employee-specific to check
        if (!scheduleDefined) return;          // incomplete → would only produce noise
        if (isLoadingShifts) return;           // wait for the shift history the rules need
        if (panelStatus === 'idle' || panelStatus === 'stale') {
            compliancePanel.run();
        }
        // compliancePanel.run is recreated every render; listing it would fire this
        // on every render. The status guard makes the current closure safe.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [watchEmployeeId, scheduleDefined, isReadOnly, isTemplateMode, isLoadingShifts, panelStatus]);

    const blockers = compliancePanel.result?.buckets.A ?? [];
    const warnings = compliancePanel.result?.buckets.B ?? [];
    const systemFails = (compliancePanel.result?.buckets.D ?? []).filter(
        (h: any) => h.status === 'BLOCKING',
    );

    /* ── Why is the button disabled? ──
       A greyed-out primary action with no reason is the single worst mobile form
       failure mode — the planner cannot see the step rail that would have told
       them, so name the gap explicitly. */
    const missing = useMemo(() => {
        const m: string[] = [];
        // Mirrors the orchestrator's `hasDepartment` gate. It is not editable
        // here — it comes from the launch context — but an unexplained dead
        // button is worse than an odd-looking one.
        if (!resolvedContext.departmentId) m.push('Department');
        if (!watchGroup) m.push('Group');
        if (!watchSubGroupName) m.push('Sub-group');
        if (!isTemplateMode && !watchShiftDate) m.push('Date');
        if (!watchStart) m.push('Start time');
        if (!watchEnd) m.push('End time');
        if (!watchRoleId) m.push('Role');
        if (!watchTargetType) m.push('Employment target');
        return m;
    }, [
        watchGroup, watchSubGroupName, watchShiftDate, watchStart,
        watchEnd, watchRoleId, watchTargetType, isTemplateMode,
        resolvedContext.departmentId,
    ]);

    const hardErrors: any[] = hardValidation?.passed ? [] : hardValidation?.errors ?? [];

    const selectEmployee = useCallback(
        (id: string | null) => {
            form.setValue('assigned_employee_id', id, { shouldDirty: true, shouldValidate: true });
            setPickerOpen(false);
            setPickerQuery('');
        },
        [form],
    );

    const readOnlyBanner = isPublished
        ? { title: 'Published — read only', body: 'Unpublish to edit.' }
        : isStarted
        ? { title: 'In progress — read only', body: 'This shift has started.' }
        : isPast
        ? { title: 'Past — read only', body: 'Past shifts cannot be edited.' }
        : null;

    const primaryLabel = editMode ? 'Update Shift' : isPublished ? 'Publish Shift' : 'Add Shift';

    /* ═══════════════════════════════════════════════════════════════════
       HEADER
       ═══════════════════════════════════════════════════════════════════ */
    const header = (
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1">
            <div className="min-w-0">
                <h2 className="text-lg font-black leading-tight tracking-tight text-foreground">
                    {editMode ? 'Edit Shift' : 'Add Shift'}
                </h2>
                {/* Keeps the roster context visible: which day, which group. */}
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate">{isTemplateMode ? 'Template' : dateDisplay}</span>
                    {(watchSubGroupName || resolvedContext.subGroupName) && (
                        <>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="truncate font-semibold text-foreground/80">
                                {watchSubGroupName || resolvedContext.subGroupName}
                            </span>
                        </>
                    )}
                </p>
            </div>
            <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                aria-label="Close"
                className="-mr-1 h-11 w-11 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-muted/40 hover:text-foreground active:scale-95 transition-all"
            >
                <X className="h-5 w-5" />
            </Button>
        </div>
    );

    /* ═══════════════════════════════════════════════════════════════════
       FOOTER — status line + primary action
       ═══════════════════════════════════════════════════════════════════ */
    const complianceRunning = panelStatus === 'running';
    const needsAck = warnings.length > 0 && !compliancePanel.warningsAcknowledged;

    let footerStatus: React.ReactNode = null;
    if (isReadOnly) {
        footerStatus = null;
    } else if (missing.length > 0) {
        footerStatus = (
            <p className="text-[11px] font-medium text-muted-foreground">
                Still needed: <span className="font-bold text-foreground/80">{missing.join(', ')}</span>
            </p>
        );
    } else if (hardErrors.length > 0) {
        footerStatus = (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-500">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {hardErrors[0]?.message ?? 'Fix the highlighted errors'}
            </p>
        );
    } else if (watchEmployeeId && !isTemplateMode) {
        if (complianceRunning || isLoadingShifts) {
            footerStatus = (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-400">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    Checking compliance…
                </p>
            );
        } else if (blockers.length > 0 || systemFails.length > 0) {
            footerStatus = (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-500">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {blockers.length + systemFails.length} compliance blocker
                    {blockers.length + systemFails.length > 1 ? 's' : ''} — see below
                </p>
            );
        } else if (needsAck) {
            footerStatus = (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-500">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Acknowledge {warnings.length} warning{warnings.length > 1 ? 's' : ''} to continue
                </p>
            );
        } else if (panelStatus === 'results') {
            footerStatus = null;
        } else if (panelStatus === 'error') {
            footerStatus = (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-500">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {compliancePanel.error ?? 'Compliance check failed'}
                </p>
            );
        }
    }

    const footer = (
        <div className="space-y-2.5 px-4 pb-3 pt-3">
            {footerStatus}

            {isReadOnly ? (
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={onCancel}
                        className="h-12 flex-1 rounded-xl border border-border/60 text-sm font-bold"
                    >
                        Close
                    </Button>
                    {canUnpublish && (
                        <Button
                            type="button"
                            onClick={onUnpublish}
                            className="h-12 flex-1 gap-2 rounded-xl border border-purple-500/25 bg-purple-500/10 text-sm font-bold text-purple-400 hover:bg-purple-500/20"
                        >
                            <Undo2 className="h-4 w-4" />
                            Unpublish
                        </Button>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {/* On a phone the button is pinned to the bottom and the failing
                        field may be scrolled far above it. Naming the next required
                        action here is the only way the state is diagnosable. */}
                    {!canSave && saveBlockReason && !isLoading && (
                        <p
                            id="sheet-save-block-reason"
                            aria-live="polite"
                            className="text-center text-[12px] font-semibold text-muted-foreground"
                        >
                            {saveBlockReason}
                        </p>
                    )}
                    <Button
                        type="button"
                        onClick={() => onSubmit(form.getValues())}
                        disabled={!canSave || isLoading}
                        aria-describedby={!canSave && saveBlockReason ? 'sheet-save-block-reason' : undefined}
                        className={cn(
                            'h-12 w-full gap-2 rounded-xl text-[13px] font-black uppercase tracking-[0.12em] shadow-lg transition-all',
                            canSave
                                ? 'bg-purple-600 text-white shadow-purple-500/20 hover:bg-purple-500 active:bg-purple-700 focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:outline-none'
                                : 'cursor-not-allowed bg-muted text-muted-foreground opacity-60 shadow-none',
                        )}
                    >
                        {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : editMode ? (
                            <Save className="h-4 w-4" />
                        ) : (
                            <Plus className="h-4 w-4" />
                        )}
                        {primaryLabel}
                    </Button>
                </div>
            )}
        </div>
    );

    /* ═══════════════════════════════════════════════════════════════════
       EMPLOYEE PICKER — a drill-down layer, not a popover.
       A 300px Command popover anchored inside a scrolling sheet is unusable on
       a phone once the keyboard covers two thirds of it.
       ═══════════════════════════════════════════════════════════════════ */
    const picker = pickerOpen ? (
        <div className="absolute inset-0 z-30 flex flex-col bg-card animate-in slide-in-from-right-4 duration-200 dark:bg-[#0a0c10]">
            <div className="flex flex-shrink-0 items-center gap-1 border-b border-border/50 px-2 py-2">
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setPickerOpen(false)}
                    aria-label="Back to shift form"
                    className="h-11 w-11 shrink-0 rounded-full p-0 text-muted-foreground"
                >
                    <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-black leading-tight text-foreground">
                        Assign Employee
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                        {targetedEmployees.length} available
                        {watchTargetType && ` · ${TARGET_EMPLOYMENT_TYPE_LABELS[watchTargetType]}`}
                    </p>
                </div>
            </div>

            <div className="flex-shrink-0 px-4 py-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                    <Input
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                        placeholder="Search employees…"
                        // 16px minimum, or iOS Safari zooms the whole sheet on focus.
                        className={cn(INPUT_CLS, 'pl-9')}
                        autoFocus
                    />
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
                <button
                    type="button"
                    onClick={() => selectEmployee(null)}
                    className="mb-2 flex w-full items-center gap-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-3 text-left active:scale-[0.99]"
                >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground/70">
                        —
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-foreground">Leave unassigned</p>
                        <p className="text-[11px] text-muted-foreground">Opens the shift for bidding</p>
                    </div>
                    {!watchEmployeeId && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                </button>

                {isLoadingData ? (
                    // "No employees found" over a pool that simply hasn't arrived
                    // yet reads as "nobody is available" — a very different answer.
                    <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" role="status">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm font-semibold">Loading staff…</span>
                    </div>
                ) : searchedEmployees.length === 0 ? (
                    <div className="py-10 text-center">
                        <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground/25" />
                        <p className="text-sm font-semibold text-muted-foreground">
                            {watchTargetType && excludedByTarget > 0
                                ? `No ${TARGET_EMPLOYMENT_TYPE_LABELS[watchTargetType]}${
                                      watchTargetType === 'PT' && watchTargetFlex ? ' (Flexible)' : ''
                                  } staff contracted here`
                                : 'No employees found'}
                        </p>
                        {excludedByTarget > 0 && (
                            <p className="mx-auto mt-1 max-w-[240px] text-[11px] text-muted-foreground/70">
                                {excludedByTarget} excluded by this shift&apos;s employment target.
                                Change the target to widen the pool.
                            </p>
                        )}
                    </div>
                ) : (
                    <div role="listbox" aria-label="Available staff">
                        {excludedByTarget > 0 && (
                            <p className="mb-2 px-1 text-[10px] text-muted-foreground/70">
                                {excludedByTarget} hidden by the shift&apos;s employment target
                            </p>
                        )}
                        {searchedEmployees.map((emp: any) => {
                            const selected = watchEmployeeId === emp.id;
                            return (
                                <button
                                    key={emp.id}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    onClick={() => selectEmployee(emp.id)}
                                    className={cn(
                                        'mb-2 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors active:scale-[0.99]',
                                        selected
                                            ? 'border-emerald-500/40 bg-emerald-500/10'
                                            : 'border-border/50 bg-background',
                                    )}
                                >
                                    <div
                                        className={cn(
                                            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                                            selected
                                                ? 'bg-emerald-500/20 text-emerald-500 ring-1 ring-emerald-500/30'
                                                : 'bg-muted text-muted-foreground/70',
                                        )}
                                    >
                                        {initialsOf(emp)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-bold text-foreground">
                                            {displayNameOf(emp)}
                                        </p>
                                        <p className="truncate font-mono text-[10px] text-muted-foreground/60">
                                            {emp.employment_status ?? emp.contract_type ?? emp.id.slice(0, 8)}
                                        </p>
                                    </div>
                                    {selected && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    ) : null;

    /* ═══════════════════════════════════════════════════════════════════
       RENDER
       ═══════════════════════════════════════════════════════════════════ */
    return (
        <Form {...form}>
            <ShiftBottomSheet
                label={editMode ? 'Edit Shift' : 'Add Shift'}
                containerRef={containerRef}
                onDismiss={onCancel}
                header={header}
                footer={footer}
                overlay={picker}
            >
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-8 pt-3">
                    {readOnlyBanner && (
                        <div className="flex items-start gap-2 rounded-xl border border-purple-500/20 bg-purple-500/[0.06] p-3">
                            <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-400" />
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-widest text-purple-400">
                                    {readOnlyBanner.title}
                                </p>
                                <p className="text-[11px] text-muted-foreground">{readOnlyBanner.body}</p>
                            </div>
                        </div>
                    )}

                    {/* ── LOCATION ── */}
                    <Section icon={MapPin} title="Location">
                        <div className="grid grid-cols-2 gap-2">
                            <ReadOnlyField
                                label="Department"
                                value={resolvedContext.departmentName || 'All Departments'}
                            />
                            <ReadOnlyField
                                label="Sub-Dept"
                                value={resolvedContext.subDepartmentName || 'All Sub-Departments'}
                            />
                        </div>

                        {isGroupLocked ? (
                            <ReadOnlyField
                                label="Group"
                                value={
                                    GROUP_LABEL[watchGroup] ||
                                    watchGroup ||
                                    resolvedContext.groupName ||
                                    'General'
                                }
                            />
                        ) : (
                            <FormField
                                control={form.control}
                                name="group_type"
                                render={({ field }) => (
                                    <FormItem>
                                        <FieldLabel required>Group</FieldLabel>
                                        <Select
                                            value={field.value || ''}
                                            onValueChange={(val) => {
                                                field.onChange(val);
                                                form.setValue('sub_group_name', '', { shouldValidate: false });
                                            }}
                                            disabled={isReadOnly}
                                        >
                                            <FormControl>
                                                <SelectTrigger className={SELECT_CLS}>
                                                    <SelectValue placeholder="Select group…" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="z-[200]">
                                                {availableGroups.map((g: any) => (
                                                    <SelectItem
                                                        key={g.id}
                                                        value={
                                                            g.external_id ||
                                                            g.name.toLowerCase().replace(/\s+/g, '_')
                                                        }
                                                    >
                                                        {g.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage className="text-[10px] text-rose-500" />
                                    </FormItem>
                                )}
                            />
                        )}

                        {isSubGroupLocked ? (
                            <ReadOnlyField
                                label="Sub-group"
                                value={watchSubGroupName || resolvedContext.subGroupName || 'General'}
                            />
                        ) : (
                            <FormField
                                control={form.control}
                                name="sub_group_name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FieldLabel required>Sub-group</FieldLabel>
                                        <Select
                                            value={field.value || ''}
                                            onValueChange={field.onChange}
                                            disabled={isReadOnly || !watchGroup}
                                        >
                                            <FormControl>
                                                <SelectTrigger className={SELECT_CLS}>
                                                    <SelectValue
                                                        placeholder={
                                                            !watchGroup ? 'Pick a group first' : 'Select sub-group…'
                                                        }
                                                    />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="z-[200]">
                                                {availableSubGroups.map((sg: any) => (
                                                    <SelectItem key={sg.id || sg.name} value={sg.name}>
                                                        {sg.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage className="text-[10px] text-rose-500" />
                                    </FormItem>
                                )}
                            />
                        )}
                    </Section>

                    {/* ── WHEN ── */}
                    <Section
                        icon={Clock}
                        title="When"
                        hint={shiftLength > 0 ? `${formatHours(netLength)} paid` : undefined}
                    >
                        {!isTemplateMode && (
                            <ReadOnlyField label="Date" value={dateDisplay} icon={Calendar} />
                        )}

                        {/* Training shift toggle — first so the floor rule (2h vs 3h/4h) is established before entering times */}
                        <FormField
                            control={form.control}
                            name="is_training"
                            render={({ field }) => (
                                <FormItem className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl border border-border/50 bg-background px-3 py-2.5 transition-colors">
                                    <div className="min-w-0">
                                        <p className="text-[12px] font-bold text-foreground">Training shift</p>
                                        <p className="text-[10px] text-muted-foreground">
                                            Exempt from standard minimum engagement (2h floor)
                                        </p>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            aria-label="Training shift (exempt from standard minimum engagement)"
                                            checked={!!field.value}
                                            onCheckedChange={field.onChange}
                                            disabled={isReadOnly}
                                            className="data-[state=checked]:bg-purple-600 focus-visible:ring-2 focus-visible:ring-purple-400"
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-2 gap-2">
                            {(['start_time', 'end_time'] as const).map((name) => (
                                <FormField
                                    key={name}
                                    control={form.control}
                                    name={name}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FieldLabel required>
                                                {name === 'start_time' ? 'Start time' : 'End time'}
                                            </FieldLabel>
                                            <FormControl>
                                                {/* Native time input → the OS wheel/clock picker,
                                                    which beats any custom mobile time UI. */}
                                                <Input
                                                    type="time"
                                                    value={field.value ?? ''}
                                                    onChange={(e) => field.onChange(e.target.value)}
                                                    onBlur={field.onBlur}
                                                    disabled={isReadOnly}
                                                    className={cn(INPUT_CLS, 'font-mono font-semibold')}
                                                />
                                            </FormControl>
                                            <FormMessage className="text-[10px] text-rose-500" />
                                        </FormItem>
                                    )}
                                />
                            ))}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <FormField
                                control={form.control}
                                name="unpaid_break_minutes"
                                render={({ field }) => (
                                    <FormItem>
                                        <FieldLabel>Unpaid break (min)</FieldLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                inputMode="numeric"
                                                min={0}
                                                value={field.value === undefined ? '' : field.value}
                                                onChange={(e) =>
                                                    field.onChange(
                                                        e.target.value === '' ? undefined : Number(e.target.value),
                                                    )
                                                }
                                                disabled={isReadOnly}
                                                placeholder="0"
                                                className={cn(INPUT_CLS, 'font-mono')}
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
                                        <FieldLabel>Paid break (min)</FieldLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                inputMode="numeric"
                                                min={0}
                                                value={field.value === undefined ? '' : field.value}
                                                onChange={(e) =>
                                                    field.onChange(
                                                        e.target.value === '' ? undefined : Number(e.target.value),
                                                    )
                                                }
                                                disabled={isReadOnly}
                                                placeholder="0"
                                                className={cn(INPUT_CLS, 'font-mono')}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        {shiftLength > 0 && (
                            <div className="flex items-center gap-2">
                                <div className="flex-1 rounded-xl border border-border/40 bg-background px-3 py-2">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                                        Length
                                    </p>
                                    <p className="font-mono text-base font-black text-foreground">
                                        {formatHours(shiftLength)}
                                    </p>
                                </div>
                                <div className="flex-1 rounded-xl border border-border/40 bg-background px-3 py-2">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                                        Net paid
                                    </p>
                                    <p
                                        className={cn(
                                            'font-mono text-base font-black',
                                            netLength > 0 && shape.blocking
                                                ? 'text-rose-500'
                                                : 'text-emerald-500',
                                        )}
                                    >
                                        {formatHours(netLength)}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Every blocking shape breach, each with a one-tap fix where
                            the required value is unambiguous. Previously only the
                            minimum-engagement case was shown, so any other breach
                            disabled Save with nothing on screen explaining why. */}
                        {!isReadOnly && shapeBlockers.length > 0 && (
                            <div role="alert" aria-live="polite" className="space-y-2">
                                {shapeBlockers.map(hit => (
                                    <div
                                        key={hit.rule_id}
                                        className="flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-2.5 text-rose-500"
                                    >
                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                        <p className="min-w-0 flex-1 text-[11px] font-semibold">{hit.summary}</p>
                                        {hit.fix && (
                                            <div className="flex shrink-0 items-center gap-1">
                                                {(hit.fix.options ?? [{ value: hit.fix.value as number, label: hit.fix.label }]).map(opt => (
                                                    <button
                                                        key={String(opt.value)}
                                                        type="button"
                                                        onClick={() => form.setValue(hit.fix!.field, opt.value as never, { shouldDirty: true })}
                                                        aria-label={`Set ${opt.label} — resolves: ${hit.summary}`}
                                                        className="h-11 min-w-[44px] whitespace-nowrap rounded-lg bg-rose-500/15 px-2.5 text-[11px] font-black uppercase tracking-wide text-rose-500 ring-1 ring-rose-500/25 active:bg-rose-500/25"
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Section>

                    {/* ── WHO ── */}
                    <Section icon={UserCircle} title="Who">
                        <FormField
                            control={form.control}
                            name="target_employment_type"
                            render={({ field }) => (
                                <FormItem>
                                    <FieldLabel required>Employment target</FieldLabel>
                                    <Select
                                        value={field.value ?? ''}
                                        onValueChange={(v) => {
                                            field.onChange(v);
                                            // The flexible flag is only coherent for a PT target.
                                            if (v !== 'PT') form.setValue('target_requires_flexible', false);
                                            // Changing the target changes who is assignable — drop an
                                            // assignee the new target excludes rather than carrying a
                                            // mismatch into a save the DB trigger rejects.
                                            const assigned = form.getValues('assigned_employee_id');
                                            if (assigned) {
                                                const emp = employees.find((e: any) => e.id === assigned);
                                                const stillOk = contractMatchesTarget(
                                                    emp?.employment_status ?? emp?.contract_type,
                                                    v as (typeof TARGET_EMPLOYMENT_TYPES)[number],
                                                    v === 'PT' && !!form.getValues('target_requires_flexible'),
                                                );
                                                if (!stillOk) form.setValue('assigned_employee_id', null);
                                            }
                                        }}
                                        disabled={isReadOnly}
                                    >
                                        <FormControl>
                                            <SelectTrigger className={SELECT_CLS}>
                                                <SelectValue placeholder="Who is this shift for?" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent className="z-[200]">
                                            {TARGET_EMPLOYMENT_TYPES.map((t) => (
                                                <SelectItem key={t} value={t}>
                                                    {TARGET_EMPLOYMENT_TYPE_LABELS[t]}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="mt-1 text-[10px] text-muted-foreground">
                                        Only staff on a matching contract for this sub-department can be assigned.
                                    </p>
                                    <FormMessage className="text-[10px] text-rose-500" />
                                </FormItem>
                            )}
                        />

                        {watchTargetType === 'PT' && (
                            <FormField
                                control={form.control}
                                name="target_requires_flexible"
                                render={({ field }) => (
                                    <FormItem className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background px-3 py-2.5">
                                        <div className="min-w-0">
                                            <p className="text-[12px] font-bold text-foreground">
                                                Flexible Part-Time only
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">
                                                Narrows the pool to Flexible PT contracts
                                            </p>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={!!field.value}
                                                onCheckedChange={(v) => {
                                                    field.onChange(v);
                                                    const assigned = form.getValues('assigned_employee_id');
                                                    if (v && assigned) {
                                                        const emp = employees.find((e: any) => e.id === assigned);
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

                        <FormField
                            control={form.control}
                            name="role_id"
                            render={({ field }) => (
                                <FormItem>
                                    <FieldLabel required>Role</FieldLabel>
                                    <Select
                                        value={field.value || ''}
                                        onValueChange={field.onChange}
                                        disabled={isReadOnly || isRoleLocked}
                                    >
                                        <FormControl>
                                            <SelectTrigger className={SELECT_CLS}>
                                                <SelectValue placeholder="Select role…" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent className="z-[200] max-h-[50dvh]">
                                            {roles.map((r: any) => (
                                                <SelectItem key={r.id} value={r.id}>
                                                    {r.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage className="text-[10px] text-rose-500" />
                                </FormItem>
                            )}
                        />

                        {/* Employee — optional; unassigned goes out to bidding. */}
                        <div>
                            <FieldLabel>Employee</FieldLabel>
                            {isTemplateMode ? (
                                <ReadOnlyField value="Templates are always unassigned" />
                            ) : (
                                <button
                                    type="button"
                                    disabled={isReadOnly || isEmployeeLocked}
                                    onClick={() => setPickerOpen(true)}
                                    className={cn(
                                        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                                        watchEmployeeId
                                            ? 'border-emerald-500/35 bg-emerald-500/[0.07]'
                                            : 'border-dashed border-border/60 bg-background',
                                        (isReadOnly || isEmployeeLocked) && 'opacity-60',
                                    )}
                                >
                                    <div
                                        className={cn(
                                            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                                            watchEmployeeId
                                                ? 'bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/25'
                                                : 'bg-muted text-muted-foreground/40',
                                        )}
                                    >
                                        {assignedEmployee ? (
                                            initialsOf(assignedEmployee)
                                        ) : (
                                            <UserCircle className="h-5 w-5" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-bold text-foreground">
                                            {assignedName ?? 'Unassigned'}
                                        </p>
                                        <p className="truncate text-[11px] text-muted-foreground">
                                            {watchEmployeeId
                                                ? 'Tap to change'
                                                : isEmployeeLocked
                                                ? 'Locked by context'
                                                : 'Tap to assign · or leave open for bidding'}
                                        </p>
                                    </div>
                                    {!isReadOnly && !isEmployeeLocked && (
                                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                                    )}
                                </button>
                            )}
                        </div>
                    </Section>

                    {/* ── DETAILS (collapsed by default — all optional) ── */}
                    <section className="overflow-hidden rounded-2xl border border-border/50 bg-muted/20 dark:bg-white/[0.02]">
                        <button
                            type="button"
                            onClick={() => setShowDetails((v) => !v)}
                            aria-expanded={showDetails}
                            aria-controls="sheet-details-panel"
                            className="flex min-h-[52px] w-full items-center gap-2 px-3.5 py-3 text-left"
                        >
                            <GraduationCap className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                            <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-foreground/80">
                                Requirements & Notes
                            </h3>
                            <span className="ml-auto text-[10px] font-semibold text-muted-foreground/60">
                                Optional
                            </span>
                            <ChevronDown
                                className={cn(
                                    'h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform',
                                    showDetails && 'rotate-180',
                                )}
                            />
                        </button>

                        {showDetails && (
                            <div id="sheet-details-panel" className="space-y-3 px-3.5 pb-3.5">
                                <FormField
                                    control={form.control}
                                    name="required_skills"
                                    render={({ field }) => (
                                        <FormItem>
                                            <MultiSelect
                                                label="Skills"
                                                options={skills.map((s: any) => ({ name: s.name, id: s.id }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="None"
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
                                                label="Certifications"
                                                options={licenses.map((l: any) => ({ name: l.name, id: l.id }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="None"
                                                disabled={isReadOnly}
                                            />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="event_ids"
                                    render={({ field }) => (
                                        <FormItem>
                                            <MultiSelect
                                                label="Events"
                                                options={events.map((e: any) => ({ name: e.name, id: e.id }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="None"
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
                                            <FieldLabel>Notes</FieldLabel>
                                            <FormControl>
                                                <Textarea
                                                    {...field}
                                                    placeholder="Shift notes or handover…"
                                                    disabled={isReadOnly}
                                                    className="min-h-[80px] resize-none rounded-xl border-border/60 bg-background p-3 text-base"
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}
                    </section>

                    {/* ── COMPLIANCE ── */}
                    <Section
                        icon={Shield}
                        title="Compliance"
                        hint={
                            !watchEmployeeId || isTemplateMode
                                ? 'Not required'
                                : panelStatus === 'results'
                                ? `${blockers.length + systemFails.length} blocking · ${warnings.length} warning`
                                : undefined
                        }
                    >
                        {!watchEmployeeId || isTemplateMode ? (
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                {isTemplateMode
                                    ? 'Templates are validated when a shift is created from them.'
                                    : 'Unassigned shifts have nothing employee-specific to check. Compliance runs as soon as you assign someone.'}
                            </p>
                        ) : complianceRunning || isLoadingShifts ? (
                            <div className="flex items-center gap-2 py-2 text-indigo-400">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-[11px] font-bold uppercase tracking-widest">
                                    Running checks…
                                </span>
                            </div>
                        ) : panelStatus === 'error' ? (
                            <div className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[12px] font-bold text-rose-500">Check failed</p>
                                    <p className="text-[11px] text-muted-foreground">{compliancePanel.error}</p>
                                </div>
                            </div>
                        ) : panelStatus !== 'results' ? (
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => compliancePanel.run()}
                                className="h-12 w-full gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/10 text-[12px] font-bold text-indigo-400"
                            >
                                <Shield className="h-4 w-4" />
                                Run compliance checks
                            </Button>
                        ) : (
                            <div className="space-y-2">
                                {[...blockers, ...systemFails].map((hit: any, i: number) => (
                                    <div
                                        key={`blocker-${hit.rule_id}-${i}`}
                                        className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3"
                                    >
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[12px] font-bold text-rose-500">{hit.rule_name}</p>
                                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                                {hit.summary}
                                            </p>
                                        </div>
                                    </div>
                                ))}

                                {warnings.map((hit: any, i: number) => (
                                    <div
                                        key={`warning-${hit.rule_id}-${i}`}
                                        className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3"
                                    >
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[12px] font-bold text-amber-500">{hit.rule_name}</p>
                                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                                {hit.summary}
                                            </p>
                                        </div>
                                    </div>
                                ))}

                                {/* Warnings are overridable, blockers are not — the
                                    acknowledgement is what flips canProceed. */}
                                {warnings.length > 0 && (
                                    <label className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-background px-3 py-2.5">
                                        <span className="text-[12px] font-bold text-foreground">
                                            I acknowledge these warnings
                                        </span>
                                        <Switch
                                            checked={compliancePanel.warningsAcknowledged}
                                            onCheckedChange={compliancePanel.acknowledgeWarnings}
                                            disabled={isReadOnly}
                                            className="data-[state=checked]:bg-amber-500"
                                        />
                                    </label>
                                )}

                                {blockers.length === 0 &&
                                    systemFails.length === 0 &&
                                    warnings.length === 0 && (
                                        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
                                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                            <p className="text-[12px] font-bold text-emerald-500">
                                                All {compliancePanel.result?.summary.passed ?? 0} checks passed
                                            </p>
                                        </div>
                                    )}
                            </div>
                        )}
                    </Section>
                </div>
            </ShiftBottomSheet>
        </Form>
    );
};

export default ShiftFormSheet;
