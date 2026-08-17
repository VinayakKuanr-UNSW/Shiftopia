/**
 * RosterTemplatesDialog — the single place where templates and this roster meet.
 *
 * Consolidates THREE toolbar buttons that were all about the same relationship,
 * just pointing in different directions:
 *
 *   ApplyTemplateDialog     ("Inject Sequence")     template → roster
 *   PlanRosterPeriodDialog  ("Plan Roster Period")  template → roster (+ empty days)
 *   SnapFromRosterDialog    ("Snap")                roster   → template
 *
 * The first two overlapped almost entirely — `create_planning_period` literally
 * called `apply_template_to_date_range_v2` internally, and the only thing it
 * uniquely produced was a `planning_periods` row no screen ever read. The third is
 * the genuine inverse operation, and it was sitting behind an unrelated-looking
 * camera icon several buttons away, so nothing suggested the two were related.
 * See docs/investigations/2026-08-05_roster-page-ux-accessibility-audit.md.
 *
 * THE DATE RANGE IS SHARED BY BOTH TABS. That is the point of putting them
 * together: pick "This Month" once, then either fill it from a template or capture
 * what is already in it. Previously Apply had free start/end dates, Plan Period had
 * presets, and Snap had a third date picker of its own — three controls for one
 * concept, none of which agreed.
 *
 * What survived from each:
 *   Apply Template  → free start/end dates, template history + per-batch UNDO
 *   Plan Period     → range presets, the no-template case, optional publish
 *   Snap            → capture-as-template with live shift count and auto-naming
 *
 * SUB-DEPARTMENT SCOPE — deliberately differs by direction:
 *   Applying a template: one sub-department. A template belongs to one, so fanning
 *     it across the whole scope would copy work into teams it was never written
 *     for. Uses the selected sub-department, or the template's own when none is.
 *   Preparing empty days: every sub-department in scope. Empty containers are
 *     scope-neutral, and this is what Plan Period did.
 *   Capturing: requires exactly one — you cannot capture "a bit of several teams"
 *     into a single template. The tab explains that rather than just disabling.
 *
 * ACCESSIBILITY: built on the Radix Dialog and Tabs primitives, so focus trap,
 * restore, Escape and roving tab-stops come from the primitives rather than being
 * hand-rolled. Presets and the template list are real radiogroups; every icon is
 * aria-hidden with a text label beside it; day cells carry an sr-only sentence
 * rather than a bare number; outcome lines are live regions. No `title` tooltips.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/modules/core/ui/primitives/tabs';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
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
    Camera,
    CalendarPlus,
    CalendarRange,
    Check,
    ChevronRight,
    ExternalLink,
    FileStack,
    History,
    Layers,
    Loader2,
    RotateCcw,
    Search,
    Send,
    User,
    Sparkles,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { MonthGrid } from '@/modules/core/ui/calendar';
import { toast } from 'sonner';
import { supabase } from '@/platform/supabase/client';
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
    useSnapRosterAsTemplate,
} from '@/modules/templates/hooks/queries/useTemplateQueries';
import type { TemplateBatch } from '@/modules/templates/model/templates.types';
import type { TemplateSummary } from '@/modules/rosters/api/shifts.queries';

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
                    dayClassName="rounded-lg text-xs font-semibold"
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
    const [isConfirming, setIsConfirming] = useState(false);

    const handleUndo = async () => {
        if (!isConfirming) {
            setIsConfirming(true);
            setTimeout(() => setIsConfirming(false), 3000);
            return;
        }
        try {
            await undo.mutateAsync({ batchId: batch.id });
            toast.success('Application reversed');
        } catch {
            toast.error('Failed to undo application');
        }
    };

    return (
        <div className="bg-card/40 border border-border/60 rounded-xl p-3 space-y-2 hover:bg-card/70 transition-colors">
            <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shrink-0">
                    <User className="h-3 w-3 text-blue-400" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold truncate text-foreground">{batch.appliedByName || 'System'}</p>
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
                    onClick={handleUndo}
                    disabled={undo.isPending}
                    className={cn(
                        'h-7 px-2.5 rounded-lg text-xs font-semibold transition-all',
                        isConfirming
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25'
                            : 'text-muted-foreground hover:text-red-400 hover:bg-red-500/10',
                    )}
                >
                    {undo.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        : <><RotateCcw className="h-3 w-3 mr-1" aria-hidden="true" />{isConfirming ? 'Confirm?' : 'Undo'}</>}
                </Button>
            </div>
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
    const navigate = useNavigate();

    const { data: templates = [], isLoading: isLoadingTemplates } = useTemplates(
        subDepartmentId || undefined,
        departmentId || undefined,
    );
    const { data: subDepts = [] } = useSubDepartments(departmentId || undefined);

    const applyTemplate = useApplyTemplate();
    const ensureRosters = useEnsureRosters();
    const snapTemplate  = useSnapRosterAsTemplate();

    const [tab, setTab] = useState<'apply' | 'capture'>('apply');

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

    const canApply = !applyBlocker && !isApplyBusy;

    const handleApply = async () => {
        if (!organizationId || !departmentId || !user || applyBlocker) return;
        try {
            if (isTemplateMode) {
                await applyTemplate.mutateAsync({
                    templateId: selectedId,
                    startDate: startDateStr,
                    endDate: endDateStr,
                    userId: user.id,
                    source: 'roster_modal',
                    targetDepartmentId: departmentId,
                    targetSubDepartmentId: subDepartmentId || undefined,
                    forceStack: false,
                });
            } else {
                await ensureRosters.mutateAsync({
                    organizationId,
                    departmentId,
                    subDepartmentIds: scopedSubDeptIds.length ? scopedSubDeptIds : [subDepartmentId],
                    startDate: startDateStr,
                    endDate: endDateStr,
                });
            }

            onOpenChange(false);
        } catch {
            // Both mutations surface their own destructive toast.
        }
    };

    // ── Capture tab ──────────────────────────────────────────────────────────
    const subDepartmentName = useMemo(
        () => (subDepts as { id: string; name: string }[]).find(s => s.id === subDepartmentId)?.name ?? '',
        [subDepts, subDepartmentId],
    );

    const [templateName, setTemplateName] = useState('');
    const [nameDirty, setNameDirty] = useState(false);
    const [captureResult, setCaptureResult] = useState<{ templateId: string; shiftsCaptured: number } | null>(null);
    const [captureError, setCaptureError] = useState<string | null>(null);

    useEffect(() => {
        if (nameDirty || !isRangeValid || !subDepartmentName) return;
        setTemplateName(
            `${subDepartmentName} Pattern ${format(range.start, 'd MMM')}–${format(range.end, 'd MMM')}`,
        );
    }, [nameDirty, isRangeValid, subDepartmentName, range.start, range.end]);

    // Live count of what would be captured.
    const [captureCount, setCaptureCount] = useState<number | null>(null);
    const [isCounting, setIsCounting] = useState(false);
    const countReqRef = useRef(0);

    useEffect(() => {
        if (tab !== 'capture' || !subDepartmentId || !isRangeValid) {
            setCaptureCount(null);
            return;
        }
        const reqId = ++countReqRef.current;
        setIsCounting(true);
        supabase
            .from('shifts')
            .select('id', { count: 'exact', head: true })
            .eq('sub_department_id', subDepartmentId)
            .gte('shift_date', startDateStr)
            .lte('shift_date', endDateStr)
            .neq('lifecycle_status', 'Cancelled')
            .is('deleted_at', null)
            .then(({ count }) => {
                if (reqId !== countReqRef.current) return;
                setCaptureCount(count ?? 0);
                setIsCounting(false);
            });
    }, [tab, subDepartmentId, isRangeValid, startDateStr, endDateStr]);

    const trimmedName = templateName.trim();
    const nameError =
        trimmedName.length === 0 ? null
        : trimmedName.length < 3 ? 'Name must be at least 3 characters.'
        : trimmedName.length > 100 ? 'Name must be fewer than 100 characters.'
        : null;

    const captureBlocker =
        !subDepartmentId ? 'Select a single sub-department to capture from'
        : !isRangeValid ? 'End date is before the start date'
        : nameError ? nameError
        : trimmedName.length === 0 ? 'Name the template'
        : captureCount === 0 ? 'No shifts in this range to capture'
        : null;

    const canCapture = !captureBlocker && !isCounting && !snapTemplate.isPending;

    const handleCapture = async () => {
        if (!canCapture || !subDepartmentId) return;
        setCaptureError(null);
        try {
            const result = await snapTemplate.mutateAsync({
                subDepartmentId,
                startDate: startDateStr,
                endDate: endDateStr,
                templateName: trimmedName,
            });
            setCaptureResult(result);
        } catch (err) {
            setCaptureError(err instanceof Error ? err.message : 'Failed to capture template.');
        }
    };

    const applySummary = isTemplateMode
        ? `Applies “${selectedTemplate?.name ?? ''}” to ${newDayCount} day${newDayCount !== 1 ? 's' : ''}`
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

    // ── Shared range control, rendered in both tabs ──────────────────────────
    const rangeControl = (
        <section aria-labelledby="rtd-range" className="space-y-3">
            <h3 id="rtd-range" className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <CalendarRange className="h-4 w-4 text-primary" aria-hidden="true" />
                Date range
            </h3>

            <div role="radiogroup" aria-label="Date range preset" className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 -mx-1 px-1">
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
                            'px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-150 shrink-0',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                            preset === key
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'bg-muted/30 text-foreground/80 hover:text-foreground hover:bg-muted/60 border border-border/40 font-semibold',
                        )}
                    >
                        {PRESET_LABELS[key]}
                    </button>
                ))}
            </div>

            {preset === 'custom' && (
                <div className="flex flex-wrap items-end gap-3 pt-1">
                    <div className="space-y-1">
                        <Label htmlFor="rtd-start" className="text-xs font-semibold text-foreground">Start</Label>
                        <Input id="rtd-start" type="date" value={customStart}
                               onChange={(e) => setCustomStart(e.target.value)} className="w-[140px] h-9 text-xs rounded-lg border-border/60 bg-background text-foreground" />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="rtd-end" className="text-xs font-semibold text-foreground">End</Label>
                        <Input id="rtd-end" type="date" value={customEnd}
                               onChange={(e) => setCustomEnd(e.target.value)} className="w-[140px] h-9 text-xs rounded-lg border-border/60 bg-background text-foreground" />
                    </div>
                </div>
            )}

            <div className="flex items-baseline justify-between pt-1">
                <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-foreground">
                    <span>{isRangeValid ? format(range.start, 'd MMM yyyy') : '—'}</span>
                    <span className="text-muted-foreground font-normal">→</span>
                    <span>{isRangeValid ? format(range.end, 'd MMM yyyy') : '—'}</span>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">{dayCount} days</span>
            </div>
        </section>
    );

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent
                overlayClassName="z-[100] bg-black/70 backdrop-blur-md"
                aria-labelledby="rtd-dialog-title"
                aria-describedby="rtd-dialog-desc"
                className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-[850px] h-auto max-h-[90vh] p-0 overflow-hidden flex flex-col rounded-2xl sm:rounded-3xl border border-border/60 shadow-2xl bg-background text-foreground z-[100]"
            >
                {/* Header */}
                <div className="p-4 sm:p-6 pb-3 border-b border-border/40 flex flex-col gap-1 shrink-0 bg-background">
                    <DialogTitle id="rtd-dialog-title" className="text-lg sm:text-xl font-bold tracking-tight text-foreground">Templates</DialogTitle>
                    <DialogDescription id="rtd-dialog-desc" className="text-xs text-muted-foreground">
                        Apply a template to a date range, or capture this roster as a new one.
                    </DialogDescription>
                </div>

                <Tabs value={tab} onValueChange={(v) => setTab(v as 'apply' | 'capture')}
                      className="flex-1 min-h-0 flex flex-col">
                    <div className="px-4 sm:px-6 pt-3 pb-3 border-b border-border/40 bg-muted/20 shrink-0">
                        <TabsList className="bg-muted/50 p-1 rounded-xl border border-border/40 flex w-full sm:w-auto inline-flex">
                            <TabsTrigger value="apply" className="flex-1 sm:flex-initial gap-2 rounded-lg font-semibold text-xs sm:text-sm px-4 py-2.5 min-h-[40px] transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
                                <FileStack className="h-4 w-4" aria-hidden="true" />
                                Apply to roster
                            </TabsTrigger>
                            <TabsTrigger value="capture" className="flex-1 sm:flex-initial gap-2 rounded-lg font-semibold text-xs sm:text-sm px-4 py-2.5 min-h-[40px] transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
                                <Camera className="h-4 w-4" aria-hidden="true" />
                                Capture from roster
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    {/* ══ APPLY — template → roster ══════════════════════════ */}
                    <TabsContent value="apply" className="flex-1 min-h-0 flex flex-col mt-0 overflow-hidden">
                        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6">
                            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                                <section aria-labelledby="rtd-source" className="space-y-3">
                                    <h3 id="rtd-source" className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                                        <FileStack className="h-4 w-4 text-primary" aria-hidden="true" />
                                        What to apply
                                    </h3>

                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                        <Input
                                            id="rtd-search-input"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Search templates"
                                            aria-label="Search templates"
                                            className="pl-9 h-10 text-xs sm:text-sm rounded-xl border-border/60 bg-background text-foreground focus:bg-background transition-colors"
                                        />
                                    </div>

                                    <div role="radiogroup" aria-label="Template to apply" className="space-y-2">
                                        {/* No template option */}
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={!isTemplateMode}
                                            tabIndex={!isTemplateMode ? 0 : -1}
                                            onKeyDown={(e) => handleTemplateKeyDown(e, NO_TEMPLATE)}
                                            onClick={() => setSelectedId(NO_TEMPLATE)}
                                            className={cn(
                                                'w-full text-left rounded-xl border p-3.5 min-h-[52px] transition-all duration-150',
                                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                                !isTemplateMode
                                                    ? 'border-primary bg-primary/15 text-foreground font-bold shadow-sm'
                                                    : 'border-border/50 bg-card/40 hover:bg-muted/40 text-foreground hover:border-border',
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                    "h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                                                    !isTemplateMode ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60 bg-transparent"
                                                )}>
                                                    {!isTemplateMode && <Check className="h-3.5 w-3.5 stroke-[3]" aria-hidden="true" />}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <span className="font-bold text-sm block text-foreground">
                                                        No template — prepare empty days
                                                    </span>
                                                    <span className="block text-xs text-muted-foreground mt-0.5">
                                                        Creates the days so you can add shifts by hand.
                                                    </span>
                                                </div>
                                            </div>
                                        </button>

                                        {isLoadingTemplates ? (
                                            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                                                <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                                                Loading templates…
                                            </div>
                                        ) : filteredTemplates.length === 0 ? (
                                            <p className="p-4 text-xs text-muted-foreground text-center rounded-xl border border-dashed border-border/50 bg-muted/10">
                                                {searchQuery
                                                    ? 'No templates match that search.'
                                                    : 'No templates for this scope yet — capture one from the other tab.'}
                                            </p>
                                        ) : (
                                            <ScrollArea className="max-h-[240px] pr-1">
                                                <div className="space-y-2">
                                                    {filteredTemplates.map((t: TemplateSummary) => (
                                                        <button
                                                            key={t.id}
                                                            type="button"
                                                            role="radio"
                                                            aria-checked={selectedId === t.id}
                                                            tabIndex={selectedId === t.id ? 0 : -1}
                                                            onKeyDown={(e) => handleTemplateKeyDown(e, t.id)}
                                                            onClick={() => setSelectedId(t.id)}
                                                            className={cn(
                                                                'w-full text-left rounded-xl border p-3.5 min-h-[52px] transition-all duration-150',
                                                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                                                selectedId === t.id
                                                                    ? 'border-primary bg-primary/15 text-foreground font-bold shadow-sm'
                                                                    : 'border-border/50 bg-card/40 hover:bg-muted/40 text-foreground hover:border-border',
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <div className={cn(
                                                                    "h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                                                                    selectedId === t.id ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60 bg-transparent"
                                                                )}>
                                                                    {selectedId === t.id && <Check className="h-3.5 w-3.5 stroke-[3]" aria-hidden="true" />}
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <span className="font-bold text-sm block truncate text-foreground">{t.name}</span>
                                                                    {t.description && (
                                                                        <span className="block text-xs text-muted-foreground mt-0.5 truncate">{t.description}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </ScrollArea>
                                        )}
                                    </div>

                                    {isTemplateMode && history.length > 0 && (
                                        <>
                                            <Separator className="my-2 border-border/40" />
                                            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                                                <History className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                                Recent applications
                                            </h3>
                                            <div className="space-y-2">
                                                {history.slice(0, 3).map(b => <HistoryItem key={b.id} batch={b} />)}
                                            </div>
                                        </>
                                    )}
                                </section>

                                <div className="space-y-5">
                                    {rangeControl}

                                    {isRangeValid && allDates.length <= 42 && (
                                        <div className="space-y-3 pt-1">
                                            <div className="flex items-center justify-between flex-wrap gap-2">
                                                <span className="text-xs font-bold uppercase tracking-wider text-foreground">Preview Calendar</span>
                                                <div className="flex items-center gap-3 text-xs font-semibold">
                                                    <span className="flex items-center gap-1.5 text-amber-400">
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
                                        <div className="flex items-start gap-2.5 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
                                            <span>
                                                {pastDayCount} day{pastDayCount !== 1 ? 's' : ''} in this range {pastDayCount !== 1 ? 'have' : 'has'} already
                                                passed and will be skipped.
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Sticky Bottom CTA Bar */}
                        <div className="sticky bottom-0 border-t border-border/40 bg-background/95 backdrop-blur-md p-4 px-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 z-20 pb-safe">
                            <p role="status" aria-live="polite" aria-atomic="true" className="text-xs font-semibold text-foreground min-h-[1.25rem] flex items-center gap-2">
                                {applyBlocker ? (
                                    <span className="text-amber-400 flex items-center gap-1.5">
                                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                                        {applyBlocker}
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1.5 text-foreground">
                                        <Sparkles className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                                        {applySummary}
                                    </span>
                                )}
                            </p>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="rounded-xl text-xs font-semibold flex-1 sm:flex-initial min-h-[40px]">Cancel</Button>
                                <Button onClick={handleApply} disabled={!canApply} size="sm" className="flex-1 sm:flex-initial min-w-[160px] min-h-[44px] rounded-xl font-bold text-xs sm:text-sm bg-primary text-primary-foreground shadow-md hover:opacity-95 transition-all">
                                    {isApplyBusy
                                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Working…</>
                                        : <><Check className="mr-2 h-4 w-4" aria-hidden="true" />
                                            {isTemplateMode ? 'Apply Template' : 'Prepare Days'}</>}
                                </Button>
                            </div>
                        </div>
                    </TabsContent>

                    {/* ══ CAPTURE — roster → template ════════════════════════ */}
                    <TabsContent value="capture" className="flex-1 min-h-0 flex flex-col mt-0 overflow-hidden">
                        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5">
                            {captureResult ? (
                                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 space-y-3 animate-in fade-in-50 duration-200">
                                    <p className="text-sm font-bold text-emerald-300 flex items-center gap-2">
                                        <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                                        Captured {captureResult.shiftsCaptured} shift{captureResult.shiftsCaptured !== 1 ? 's' : ''} into “{trimmedName}”.
                                    </p>
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        Saved as a draft. Open it to review and publish before it can be applied.
                                    </p>
                                    <div className="flex flex-wrap gap-2 pt-2">
                                        <Button size="sm" onClick={() => { navigate('/templates'); onOpenChange(false); }} className="rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm min-h-[40px]">
                                            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                                            Open in Templates
                                        </Button>
                                        <Button size="sm" variant="ghost"
                                                onClick={() => { setCaptureResult(null); setNameDirty(false); }} className="rounded-xl text-xs min-h-[40px]">
                                            Capture another
                                        </Button>
                                    </div>
                                </div>
                            ) : !subDepartmentId ? (
                                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-2">
                                    <p className="text-sm font-bold text-amber-300 flex items-center gap-2">
                                        <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />
                                        Select a sub-department first
                                    </p>
                                    <p className="text-xs text-muted-foreground leading-relaxed max-w-[62ch]">
                                        A template belongs to a single sub-department, so capturing needs one chosen in the
                                        scope filter above the roster. Applying a template does not — which is why this tab
                                        asks for something the other one does not.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <div className="grid gap-6 lg:grid-cols-2">
                                        {rangeControl}

                                        <section aria-labelledby="rtd-name" className="space-y-3">
                                            <h3 id="rtd-name" className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                                                <Camera className="h-4 w-4 text-primary" aria-hidden="true" />
                                                New template
                                            </h3>
                                            <div className="space-y-2 bg-muted/20 border border-border/40 rounded-xl p-4">
                                                <Label htmlFor="rtd-template-name" className="text-xs font-semibold text-foreground">Name</Label>
                                                <Input
                                                    id="rtd-template-name"
                                                    value={templateName}
                                                    onChange={(e) => { setTemplateName(e.target.value); setNameDirty(true); }}
                                                    placeholder="e.g. Security Pattern 1 Aug–31 Aug"
                                                    aria-invalid={!!nameError}
                                                    aria-describedby={nameError ? 'rtd-name-error' : 'rtd-name-hint'}
                                                    className="h-10 text-xs rounded-lg border-border/60 bg-background text-foreground"
                                                />
                                                {nameError ? (
                                                    <p id="rtd-name-error" role="alert" className="text-xs text-red-400 font-medium">
                                                        {nameError}
                                                    </p>
                                                ) : (
                                                    <p id="rtd-name-hint" className="text-xs text-muted-foreground">
                                                        Suggested from scope and range — editing stops auto-suggestions.
                                                    </p>
                                                )}
                                            </div>
                                        </section>
                                    </div>

                                    <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
                                        <p role="status" aria-live="polite" aria-atomic="true" className="text-xs font-medium">
                                            {isCounting ? (
                                                <span className="flex items-center gap-2 text-muted-foreground">
                                                    <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                                                    Counting shifts in this range…
                                                </span>
                                            ) : captureCount === null ? (
                                                <span className="text-muted-foreground">Pick a valid range to see what would be captured.</span>
                                            ) : captureCount === 0 ? (
                                                <span className="text-muted-foreground">
                                                    No shifts scheduled in {format(range.start, 'd MMM')} – {format(range.end, 'd MMM')} for{' '}
                                                    <strong className="text-foreground">{subDepartmentName}</strong>. There is nothing to capture.
                                                </span>
                                            ) : (
                                                <span className="text-foreground">
                                                    <strong className="text-primary text-sm font-black">{captureCount}</strong> shift{captureCount !== 1 ? 's' : ''} in{' '}
                                                    {format(range.start, 'd MMM')} – {format(range.end, 'd MMM')} will be captured into a
                                                    new draft template.
                                                </span>
                                            )}
                                        </p>
                                    </div>

                                    {captureError && (
                                        <div role="alert" className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl p-3 font-medium">
                                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                                            <span>{captureError}</span>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="sticky bottom-0 border-t border-border/40 bg-background/95 backdrop-blur-md p-4 px-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 z-20 pb-safe">
                            <p role="status" aria-live="polite" aria-atomic="true" className="text-xs font-semibold text-foreground min-h-[1.25rem]">
                                {captureResult ? 'Saved as a draft template.' : captureBlocker ?? 'Ready to capture.'}
                            </p>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="rounded-xl text-xs font-semibold flex-1 sm:flex-initial min-h-[40px]">Close</Button>
                                {!captureResult && (
                                    <Button onClick={handleCapture} disabled={!canCapture} size="sm" className="flex-1 sm:flex-initial min-w-[160px] min-h-[44px] rounded-xl font-bold text-xs sm:text-sm bg-primary text-primary-foreground shadow-md hover:opacity-95 transition-all">
                                        {snapTemplate.isPending
                                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Capturing…</>
                                            : <><Camera className="mr-2 h-4 w-4" aria-hidden="true" />Capture Template</>}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};

export default RosterTemplatesDialog;

