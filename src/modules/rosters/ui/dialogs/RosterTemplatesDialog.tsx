/**
 * RosterTemplatesDialog — the single place where templates and this roster meet.
 *
 * Consolidates two toolbar buttons that overlapped almost entirely:
 *
 *   ApplyTemplateDialog     ("Inject Sequence")     template → roster
 *   PlanRosterPeriodDialog  ("Plan Roster Period")  template → roster (+ empty days)
 *
 * `create_planning_period` literally called `apply_template_to_date_range_v2`
 * internally, and the only thing it uniquely produced was a `planning_periods`
 * row no screen ever read. See
 * docs/investigations/2026-08-05_roster-page-ux-accessibility-audit.md.
 *
 * What survived from each:
 *   Apply Template  → free start/end dates, template history + per-batch UNDO
 *   Plan Period     → range presets, the no-template case, optional publish
 *
 * (A third tab captured a roster as a new template; retired 2026-10-25 —
 * templates are authored in the template editor.)
 *
 * SUB-DEPARTMENT SCOPE:
 *   Applying a template: one sub-department. A template belongs to one, so fanning
 *     it across the whole scope would copy work into teams it was never written
 *     for. Uses the selected sub-department, or the template's own when none is.
 *   Preparing empty days: every sub-department in scope. Empty containers are
 *     scope-neutral, and this is what Plan Period did.
 *
 * ACCESSIBILITY: built on the Radix Dialog primitive, so focus trap, restore and
 * Escape come from the primitive rather than being hand-rolled. Presets and the template list are real radiogroups; every icon is
 * aria-hidden with a text label beside it; day cells carry an sr-only sentence
 * rather than a bare number; outcome lines are live regions. No `title` tooltips.
 */

import React, { useMemo, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import {
    format,
    parseISO,
    differenceInDays,
    eachDayOfInterval,
    startOfMonth,
    endOfMonth,
    eachMonthOfInterval,
    isAfter,
    addWeeks,
    addMonths,
    isBefore,
    startOfDay,
} from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';
import {
    AlertTriangle,
    CalendarRange,
    Check,
    FileStack,
    History,
    Loader2,
    RotateCcw,
    Search,
    User,
    Sparkles,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { FIELD_INPUT } from '@/modules/core/ui/components/PickerField';
import { MonthGrid } from '@/modules/core/ui/calendar';
import { toast } from 'sonner';
import { useAuth } from '@/platform/auth/useAuth';
import { getSydneyToday, formatInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { useTemplates, useRostersLookup, useSubDepartments } from '@/modules/rosters/state/useRosterShifts';
import {
    useApplyTemplate,
    useEnsureRosters,
} from '@/modules/rosters/state/useRosterMutations';
import {
    useTemplateHistory,
    useUndoTemplateBatch,
} from '@/modules/templates/hooks/queries/useTemplateQueries';
import type { TemplateBatch } from '@/modules/templates/model/templates.types';
import type { TemplateSummary } from '@/modules/rosters/api/shifts.queries';
import { previewTemplateApplication, undoTemplateApplication } from '@/modules/rosters/api/rosterSubgroups.api';
import { ImpactConfirmDialog } from './ImpactConfirmDialog';
import { describeTemplateStacking, describeTemplateUndo, type ChangeSummary } from './rosterChangeCopy';

// ── Range presets ────────────────────────────────────────────────────────────

type PresetKey = 'this-week' | 'next-week' | 'this-month' | 'next-month' | 'custom';

const PRESET_LABELS: Record<PresetKey, string> = {
    'this-week':  'This Week',
    'next-week':  'Next Week',
    'this-month': 'This Month',
    'next-month': 'Next Month',
    'custom':     'Custom',
};

function getPresetRange(key: PresetKey, anchor: Date): { start: Date; end: Date } {
    switch (key) {
        case 'this-week':  return { start: startOfWeekAU(anchor),              end: endOfWeekAU(anchor) };
        case 'next-week':  return { start: startOfWeekAU(addWeeks(anchor, 1)), end: endOfWeekAU(addWeeks(anchor, 1)) };
        case 'next-month': return { start: startOfMonth(addMonths(anchor, 1)),     end: endOfMonth(addMonths(anchor, 1)) };
        default:           return { start: startOfMonth(anchor),                   end: endOfMonth(anchor) };
    }
}

// ── Calendar preview ────────────────────────────────────────────────────────

type DayStatus = 'existing' | 'new' | 'past';

const STATUS_LABEL: Record<DayStatus, string> = {
    existing: 'already has a roster',
    past: 'in the past, will be skipped',
    new: 'roster will be created',
};

/**
 * Preview of what applying over the chosen range will do.
 *
 * Rendered with the shared `MonthGrid` rather than a hand-built grid, so it
 * inherits Monday-start weeks, NSW public-holiday marking and grid semantics.
 * One grid per month the range spans — the previous version padded only the
 * leading offset, so a range crossing a month boundary ran on with no break and
 * the weekday columns stopped meaning anything.
 */
const RangePreview: React.FC<{
    range: { start: Date; end: Date };
    getDayStatus: (date: Date) => DayStatus;
}> = ({ range, getDayStatus }) => {
    const months = useMemo(
        () => eachMonthOfInterval({ start: startOfMonth(range.start), end: startOfMonth(range.end) }),
        [range.start, range.end],
    );

    const inRange = React.useCallback(
        (date: Date) => !isBefore(startOfDay(date), startOfDay(range.start)) && !isAfter(startOfDay(date), startOfDay(range.end)),
        [range.start, range.end],
    );

    const modifiers = useMemo(
        () => ({
            outOfRange: (date: Date) => !inRange(date),
            statusExisting: (date: Date) => inRange(date) && getDayStatus(date) === 'existing',
            statusNew: (date: Date) => inRange(date) && getDayStatus(date) === 'new',
            statusPast: (date: Date) => inRange(date) && getDayStatus(date) === 'past',
        }),
        [inRange, getDayStatus],
    );

    return (
        <div className={cn('grid gap-4', months.length > 1 && 'sm:grid-cols-2')}>
            {months.map(month => (
                <MonthGrid
                    key={month.toISOString()}
                    month={month}
                    captionVariant={months.length > 1 ? 'default' : 'hidden'}
                    showOutsideDays={false}
                    minCellHeight="2.25rem"
                    dayClassName="rounded-lg text-[11px] font-semibold"
                    dayModifiers={modifiers}
                    modifiersClassNames={{
                        outOfRange: 'border-transparent text-muted-foreground/30 opacity-30',
                        statusExisting: 'bg-amber-500/15 border-transparent text-amber-300 dark:text-amber-200 font-semibold',
                        statusNew: 'bg-primary/15 border-transparent text-primary font-semibold',
                        statusPast: 'bg-muted/10 border-transparent text-muted-foreground/40 font-normal',
                    }}
                    dayLabel={ctx => {
                        const base = format(ctx.date, 'EEEE d MMMM yyyy');
                        if (!inRange(ctx.date)) return `${base}, outside the selected range`;
                        const holiday = ctx.holidayName ? `, ${ctx.holidayName}, public holiday` : '';
                        return `${base}${holiday} — ${STATUS_LABEL[getDayStatus(ctx.date)]}`;
                    }}
                    renderDay={ctx => (
                        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5">
                            <span className="leading-none">{ctx.date.getDate()}</span>
                            {inRange(ctx.date) && getDayStatus(ctx.date) !== 'past' && (
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        'h-1 w-1 rounded-full',
                                        getDayStatus(ctx.date) === 'existing' ? 'bg-amber-400' : 'bg-primary',
                                    )}
                                />
                            )}
                        </span>
                    )}
                />
            ))}
        </div>
    );
};

// ── Template application history (carried over from ApplyTemplateDialog) ─────

const HistoryItem: React.FC<{ batch: TemplateBatch }> = ({ batch }) => {
    const undo = useUndoTemplateBatch();
    const { user } = useAuth();
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    // Undo removes this application's shifts that have not started, and only
    // those. The dialog shows the database's dry run of exactly that first.
    const loadUndoPreview = async (): Promise<ChangeSummary> => {
        if (!user) throw new Error('Sign in again to undo this application.');
        return describeTemplateUndo(await undoTemplateApplication(batch.id, user.id, true));
    };

    return (
        <div className="bg-card/40 border border-border/60 rounded-xl p-3 space-y-2 hover:bg-card/70 transition-colors">
            <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shrink-0">
                    <User className="h-3 w-3 text-blue-400" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold truncate text-foreground">{batch.appliedByName || 'System'}</p>
                    <p className="text-[11px] text-muted-foreground">
                        {formatInTimezone(new Date(batch.appliedAt), SYDNEY_TZ, 'd MMM, HH:mm')}
                    </p>
                </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                <span className="text-[11px] font-medium text-muted-foreground">
                    {format(new Date(batch.startDate), 'd MMM')} – {format(new Date(batch.endDate), 'd MMM')}
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsConfirmOpen(true)}
                    disabled={undo.isPending}
                    className="h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-all text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                >
                    {undo.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        : <><RotateCcw className="h-3 w-3 mr-1" aria-hidden="true" />Undo</>}
                </Button>
            </div>
            <ImpactConfirmDialog
                open={isConfirmOpen}
                onOpenChange={setIsConfirmOpen}
                title="Undo this template application?"
                description={<>Applied {formatInTimezone(new Date(batch.appliedAt), SYDNEY_TZ, 'd MMM, HH:mm')} by {batch.appliedByName || 'System'}.</>}
                load={loadUndoPreview}
                onConfirm={async () => { await undo.mutateAsync({ batchId: batch.id }); }}
                acknowledgementLabel="I understand these shifts are removed for good, including ones staff are assigned to."
            />
        </div>
    );
};

// ── Dialog ───────────────────────────────────────────────────────────────────

interface RosterTemplatesDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    organizationId: string | null;
    departmentId: string | null;
    subDepartmentId: string | null;
    selectedDate: Date;
}

const NO_TEMPLATE = '__none__';


export const RosterTemplatesDialog: React.FC<RosterTemplatesDialogProps> = ({
    isOpen,
    onOpenChange,
    organizationId,
    departmentId,
    subDepartmentId,
    selectedDate,
}) => {
    const { user } = useAuth();

    const { data: templates = [], isLoading: isLoadingTemplates } = useTemplates(
        subDepartmentId || undefined,
        departmentId || undefined,
    );
    const { data: subDepts = [] } = useSubDepartments(departmentId || undefined);

    const applyTemplate = useApplyTemplate();
    const ensureRosters = useEnsureRosters();

    // ── Range — SHARED between both tabs ─────────────────────────────────────
    const [preset, setPreset] = useState<PresetKey>('this-month');
    const [customStart, setCustomStart] = useState(format(startOfMonth(selectedDate), 'yyyy-MM-dd'));
    const [customEnd, setCustomEnd] = useState(format(endOfMonth(selectedDate), 'yyyy-MM-dd'));

    const range = useMemo(() => {
        if (preset === 'custom') return { start: parseISO(customStart), end: parseISO(customEnd) };
        return getPresetRange(preset, selectedDate);
    }, [preset, selectedDate, customStart, customEnd]);

    const isRangeValid = range.start <= range.end;
    const dayCount = isRangeValid ? differenceInDays(range.end, range.start) + 1 : 0;
    const allDates = useMemo(
        () => (isRangeValid ? eachDayOfInterval({ start: range.start, end: range.end }) : []),
        [isRangeValid, range],
    );
    const startDateStr = isRangeValid ? format(range.start, 'yyyy-MM-dd') : '';
    const endDateStr   = isRangeValid ? format(range.end, 'yyyy-MM-dd') : '';

    // ── Apply tab ────────────────────────────────────────────────────────────
    const [selectedId, setSelectedId] = useState<string>(NO_TEMPLATE);
    const [searchQuery, setSearchQuery] = useState('');

    const isTemplateMode = selectedId !== NO_TEMPLATE;
    const isApplyBusy = applyTemplate.isPending || ensureRosters.isPending;
    const [isCheckingStack, setIsCheckingStack] = useState(false);
    const [stackSummary, setStackSummary] = useState<(ChangeSummary & { needsConfirmation: boolean }) | null>(null);

    const scopedSubDeptIds: (string | null)[] = useMemo(
        () => (subDepartmentId ? [subDepartmentId] : (subDepts as { id: string }[]).map(s => s.id)),
        [subDepartmentId, subDepts],
    );

    const { data: existingRosters = [] } = useRostersLookup(
        organizationId || undefined,
        {
            departmentIds: departmentId ? [departmentId] : [],
            subDepartmentIds: scopedSubDeptIds.filter((v): v is string => !!v),
        },
    );

    const existingDates = useMemo(() => {
        const set = new Set<string>();
        (existingRosters as { start_date?: string }[]).forEach(r => r.start_date && set.add(r.start_date));
        return set;
    }, [existingRosters]);

    const today = getSydneyToday();
    const getDayStatus = (date: Date): DayStatus => {
        if (existingDates.has(format(date, 'yyyy-MM-dd'))) return 'existing';
        if (isBefore(startOfDay(date), today)) return 'past';
        return 'new';
    };

    const pastDayCount = allDates.filter(d => getDayStatus(d) === 'past').length;
    const newDayCount = allDates.filter(d => getDayStatus(d) === 'new').length;

    const { data: history = [] } = useTemplateHistory(isTemplateMode ? selectedId : undefined);

    const filteredTemplates = useMemo(
        () => templates.filter((t: TemplateSummary) =>
            t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false),
        ),
        [templates, searchQuery],
    );
    const selectedTemplate = templates.find((t: TemplateSummary) => t.id === selectedId);

    const applyBlocker =
        !organizationId || !departmentId ? 'Select an organisation and department first'
        : !isRangeValid ? 'End date is before the start date'
        : dayCount > 0 && pastDayCount === dayCount ? 'Every day in this range is already past'
        : null;

    const canApply = !applyBlocker && !isApplyBusy && !isCheckingStack;

    const applySelectedTemplate = async () => {
        if (!user || !departmentId) return;
        await applyTemplate.mutateAsync({
            templateId: selectedId,
            startDate: startDateStr,
            endDate: endDateStr,
            userId: user.id,
            source: 'roster_modal',
            targetDepartmentId: departmentId,
            targetSubDepartmentId: subDepartmentId || undefined,
        });
        onOpenChange(false);
    };

    // A second template ADDS on top of what is there; nothing is replaced. When
    // the days already hold shifts, say so (and what would be duplicated) before
    // writing. On empty days there is nothing to weigh, so it applies directly.
    const handleApplyTemplate = async () => {
        setIsCheckingStack(true);
        let summary: ChangeSummary & { needsConfirmation: boolean };
        try {
            summary = describeTemplateStacking(
                await previewTemplateApplication({
                    templateId: selectedId,
                    startDate: startDateStr,
                    endDate: endDateStr,
                    targetDepartmentId: departmentId || undefined,
                    targetSubDepartmentId: subDepartmentId || undefined,
                }),
                selectedTemplate?.name ?? 'This template',
            );
        } catch (err) {
            toast.error(`Could not check what is already on these days: ${err instanceof Error ? err.message : 'unknown error'}`);
            return;
        } finally {
            setIsCheckingStack(false);
        }
        if (summary.needsConfirmation) {
            setStackSummary(summary);
            return;
        }
        try {
            await applySelectedTemplate();
        } catch {
            // useApplyTemplate surfaces its own destructive toast.
        }
    };

    const handleApply = async () => {
        if (!organizationId || !departmentId || !user || applyBlocker) return;
        if (isTemplateMode) {
            await handleApplyTemplate();
            return;
        }
        try {
            await ensureRosters.mutateAsync({
                organizationId,
                departmentId,
                subDepartmentIds: scopedSubDeptIds.length ? scopedSubDeptIds : [subDepartmentId],
                startDate: startDateStr,
                endDate: endDateStr,
            });
            onOpenChange(false);
        } catch {
            // useEnsureRosters surfaces its own destructive toast.
        }
    };

    // A template STACKS onto days that already have a roster, so it reaches every
    // day that is not past. Counting only roster-less days read "0 days" for a
    // month that was already set up.
    const applyDayCount = dayCount - pastDayCount;
    const applySummary = isTemplateMode
        ? `Applies “${selectedTemplate?.name ?? ''}” to ${applyDayCount} day${applyDayCount !== 1 ? 's' : ''}`
        : `Prepares ${newDayCount} empty day${newDayCount !== 1 ? 's' : ''}`;

    // ── Keyboard navigation for ARIA radiogroups ──────────────────────────────
    const PRESET_KEYS: PresetKey[] = ['this-week', 'next-week', 'this-month', 'next-month', 'custom'];

    const handlePresetKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = (currentIndex + 1) % PRESET_KEYS.length;
            setPreset(PRESET_KEYS[nextIndex]);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = (currentIndex - 1 + PRESET_KEYS.length) % PRESET_KEYS.length;
            setPreset(PRESET_KEYS[prevIndex]);
        }
    };

    const allTemplateIds = useMemo(
        () => [NO_TEMPLATE, ...filteredTemplates.map((t: TemplateSummary) => t.id)],
        [filteredTemplates],
    );

    const handleTemplateKeyDown = (e: React.KeyboardEvent, currentId: string) => {
        const currentIndex = allTemplateIds.indexOf(currentId);
        if (currentIndex === -1) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            const nextIndex = (currentIndex + 1) % allTemplateIds.length;
            setSelectedId(allTemplateIds[nextIndex]);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const prevIndex = (currentIndex - 1 + allTemplateIds.length) % allTemplateIds.length;
            setSelectedId(allTemplateIds[prevIndex]);
        }
    };

    const sectionLabel = 'text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300';
    const railRow = (isOn: boolean) => cn(
        'w-full text-left rounded-xl px-3 py-2.5 min-h-[52px] transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary',
        isOn ? 'bg-background shadow-sm ring-1 ring-border/60' : 'hover:bg-background/60',
    );
    const railTick = (isOn: boolean) => cn(
        'mt-0.5 h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition-colors',
        isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
    );

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent
                overlayClassName="z-[100] bg-black/70 backdrop-blur-md"
                aria-labelledby="rtd-dialog-title"
                aria-describedby="rtd-dialog-desc"
                className="w-[calc(100vw-1.5rem)] sm:w-full h-[min(760px,92vh)] p-0 gap-0 overflow-hidden flex flex-col md:flex-row text-foreground z-[100]"
                size="2xl"
            >
                {/* ── LEFT RAIL: title, what to apply, recent applications ── */}
                <aside className="flex md:w-[320px] shrink-0 flex-col border-b md:border-b-0 md:border-r border-border/50 bg-muted/30 px-4 py-6 min-h-0 overflow-y-auto">
                    <div className="px-2">
                        <DialogTitle id="rtd-dialog-title" className="text-[15px] font-bold tracking-tight">Templates</DialogTitle>
                        <DialogDescription id="rtd-dialog-desc" className="mt-0.5 text-[11px]">
                            Apply a template to a date range, or prepare empty days.
                        </DialogDescription>
                    </div>

                    <section aria-labelledby="rtd-source" className="mt-6 space-y-3">
                        <h3 id="rtd-source" className={cn(sectionLabel, 'px-2 flex items-center gap-2')}>
                            <FileStack className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                            What to apply
                        </h3>

                        <div className="relative">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            <Input
                                id="rtd-search-input"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search templates"
                                aria-label="Search templates"
                                className={cn(FIELD_INPUT, 'h-11 pl-10')}
                            />
                        </div>

                        <div role="radiogroup" aria-label="Template to apply" className="space-y-1">
                            <button
                                type="button"
                                role="radio"
                                aria-checked={!isTemplateMode}
                                tabIndex={!isTemplateMode ? 0 : -1}
                                onKeyDown={(e) => handleTemplateKeyDown(e, NO_TEMPLATE)}
                                onClick={() => setSelectedId(NO_TEMPLATE)}
                                className={railRow(!isTemplateMode)}
                            >
                                <div className="flex items-start gap-3">
                                    <div className={railTick(!isTemplateMode)}>
                                        {!isTemplateMode && <Check className="h-3.5 w-3.5 stroke-[3]" aria-hidden="true" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <span className="block text-[13px] font-semibold text-foreground">No template — prepare empty days</span>
                                        <span className="block text-[11px] text-muted-foreground">Creates the days so you can add shifts by hand.</span>
                                    </div>
                                </div>
                            </button>

                            {isLoadingTemplates ? (
                                <div className="flex items-center gap-2 p-3 text-[11px] text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                                    Loading templates…
                                </div>
                            ) : filteredTemplates.length === 0 ? (
                                <p className="p-3 text-[11px] text-muted-foreground text-center rounded-xl border border-dashed border-border/50">
                                    {searchQuery
                                        ? 'No templates match that search.'
                                        : 'No templates for this scope yet — create one on the Templates page.'}
                                </p>
                            ) : (
                                filteredTemplates.map((t: TemplateSummary) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={selectedId === t.id}
                                        tabIndex={selectedId === t.id ? 0 : -1}
                                        onKeyDown={(e) => handleTemplateKeyDown(e, t.id)}
                                        onClick={() => setSelectedId(t.id)}
                                        className={railRow(selectedId === t.id)}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={railTick(selectedId === t.id)}>
                                                {selectedId === t.id && <Check className="h-3.5 w-3.5 stroke-[3]" aria-hidden="true" />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <span className="block truncate text-[13px] font-semibold text-foreground">{t.name}</span>
                                                {t.description && (
                                                    <span className="block truncate text-[11px] text-muted-foreground">{t.description}</span>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </section>

                    {isTemplateMode && history.length > 0 && (
                        <section aria-labelledby="rtd-history" className="mt-auto pt-6 space-y-3">
                            <h3 id="rtd-history" className={cn(sectionLabel, 'px-2 flex items-center gap-2')}>
                                <History className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                Recent applications
                            </h3>
                            <div className="space-y-2">
                                {history.slice(0, 3).map(b => <HistoryItem key={b.id} batch={b} />)}
                            </div>
                        </section>
                    )}
                </aside>

                {/* ── RIGHT PANE: date range, preview, footer ─────────────── */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
                        <div className="border-b border-border/50 pb-4 pr-12">
                            <h3 id="rtd-range" className="text-[15px] font-bold tracking-tight text-foreground flex items-center gap-2">
                                <CalendarRange className="h-4 w-4 text-primary" aria-hidden="true" />
                                Date range
                            </h3>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                                Days already in the past are skipped. A template adds on top of days that already have shifts.
                            </p>
                        </div>

                        {/* Segmented preset control */}
                        <div
                            role="radiogroup"
                            aria-labelledby="rtd-range"
                            className="flex w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-xl bg-muted/50 p-1"
                        >
                            {PRESET_KEYS.map((key, index) => (
                                <button
                                    key={key}
                                    type="button"
                                    role="radio"
                                    aria-checked={preset === key}
                                    tabIndex={preset === key ? 0 : -1}
                                    onKeyDown={(e) => handlePresetKeyDown(e, index)}
                                    onClick={() => setPreset(key)}
                                    className={cn(
                                        'flex-1 min-h-[40px] whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-colors',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                        preset === key
                                            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {PRESET_LABELS[key]}
                                </button>
                            ))}
                        </div>

                        {preset === 'custom' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="rtd-start" className="text-[13px] font-semibold text-foreground">Start</Label>
                                    <Input id="rtd-start" type="date" value={customStart}
                                           onChange={(e) => setCustomStart(e.target.value)} className={cn(FIELD_INPUT, 'h-14')} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="rtd-end" className="text-[13px] font-semibold text-foreground">End</Label>
                                    <Input id="rtd-end" type="date" value={customEnd}
                                           onChange={(e) => setCustomEnd(e.target.value)} className={cn(FIELD_INPUT, 'h-14')} />
                                </div>
                            </div>
                        )}

                        <div className="flex items-baseline justify-between">
                            <div className="flex items-center gap-2 text-[15px] font-bold text-foreground">
                                <span>{isRangeValid ? format(range.start, 'd MMM yyyy') : '—'}</span>
                                <span className="text-muted-foreground font-normal">→</span>
                                <span>{isRangeValid ? format(range.end, 'd MMM yyyy') : '—'}</span>
                            </div>
                            <span className="text-[11px] font-semibold text-muted-foreground">{dayCount} days</span>
                        </div>

                        {isRangeValid && allDates.length <= 42 && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <span className={sectionLabel}>Preview</span>
                                    <div className="flex items-center gap-3 text-[11px] font-semibold">
                                        <span className="flex items-center gap-1.5 text-amber-500 dark:text-amber-400">
                                            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden="true" /> Has roster
                                        </span>
                                        <span className="flex items-center gap-1.5 text-primary">
                                            <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" /> Will be created
                                        </span>
                                        <span className="flex items-center gap-1.5 text-muted-foreground">
                                            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50" aria-hidden="true" /> Past
                                        </span>
                                    </div>
                                </div>
                                <RangePreview range={range} getDayStatus={getDayStatus} />
                            </div>
                        )}

                        {pastDayCount > 0 && !applyBlocker && (
                            <div className="flex items-start gap-2.5 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                                <span>
                                    {pastDayCount} day{pastDayCount !== 1 ? 's' : ''} in this range {pastDayCount !== 1 ? 'have' : 'has'} already
                                    passed and will be skipped.
                                </span>
                            </div>
                        )}
                    </div>

                    {/* ── FOOTER ── */}
                    <div className="flex flex-shrink-0 flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border/50 px-6 py-4 pb-safe">
                        <p role="status" aria-live="polite" aria-atomic="true" className="text-[13px] font-semibold text-foreground min-h-[1.25rem] flex items-center gap-2">
                            {applyBlocker ? (
                                <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    {applyBlocker}
                                </span>
                            ) : (
                                <span className="flex items-center gap-1.5">
                                    <Sparkles className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                                    {applySummary}
                                </span>
                            )}
                        </p>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                className="h-11 flex-1 sm:flex-initial rounded-xl border-border/60 px-5 text-[13px] font-semibold"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={handleApply}
                                disabled={!canApply}
                                className="h-11 flex-1 sm:flex-initial gap-1.5 rounded-xl bg-primary px-6 text-[13px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
                            >
                                {isApplyBusy || isCheckingStack
                                    ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{isCheckingStack ? 'Checking…' : 'Working…'}</>
                                    : <><Check className="h-4 w-4" aria-hidden="true" />{isTemplateMode ? 'Apply Template' : 'Prepare Days'}</>}
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>

            <ImpactConfirmDialog
                open={!!stackSummary}
                onOpenChange={open => { if (!open) setStackSummary(null); }}
                tone="default"
                title="Add on top of what is already there?"
                description={<>{selectedTemplate?.name ?? 'This template'} · {isRangeValid ? `${format(range.start, 'd MMM')} – ${format(range.end, 'd MMM yyyy')}` : ''}</>}
                load={() => (stackSummary ? Promise.resolve(stackSummary) : Promise.reject(new Error('Nothing to confirm.')))}
                onConfirm={applySelectedTemplate}
            />
        </Dialog>
    );
};


