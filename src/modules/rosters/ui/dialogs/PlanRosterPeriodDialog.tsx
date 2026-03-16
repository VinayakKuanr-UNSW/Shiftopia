import React, { useState, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
    Loader2,
    Zap,
    CalendarRange,
    ChevronRight,
    Sparkles,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
    format,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    addWeeks,
    addMonths,
    differenceInDays,
    eachDayOfInterval,
    isBefore,
    startOfDay,
} from 'date-fns';
import {
    useSubDepartments,
    useTemplates,
    useOrganizations,
    useDepartments,
    useRostersLookup,
} from '@/modules/rosters/state/useRosterShifts';
import { useCreatePlanningPeriod } from '@/modules/rosters/state/useRosterMutations';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlanRosterPeriodDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    organizationId: string;
    departmentId: string;
    /** Inherited from global scope — null means "all sub-depts" */
    preSelectedSubDeptId?: string | null;
    selectedDate: Date;
}

// ── Date range presets ────────────────────────────────────────────────────────

type PresetKey = 'this-week' | 'next-week' | 'this-month' | 'next-month' | 'custom';

interface DateRange { start: Date; end: Date; }

function getPresetRange(key: PresetKey, anchor: Date): DateRange {
    const opts = { weekStartsOn: 1 as const };
    switch (key) {
        case 'this-week':  return { start: startOfWeek(anchor, opts),              end: endOfWeek(anchor, opts) };
        case 'next-week':  return { start: startOfWeek(addWeeks(anchor, 1), opts), end: endOfWeek(addWeeks(anchor, 1), opts) };
        case 'next-month': return { start: startOfMonth(addMonths(anchor, 1)),     end: endOfMonth(addMonths(anchor, 1)) };
        default:           return { start: startOfMonth(anchor),                   end: endOfMonth(anchor) };
    }
}

const PRESET_LABELS: Record<PresetKey, string> = {
    'this-week':  'This Week',
    'next-week':  'Next Week',
    'this-month': 'This Month',
    'next-month': 'Next Month',
    'custom':     'Custom',
};

// ── Calendar Day Cell ─────────────────────────────────────────────────────────

type DayStatus = 'active' | 'new' | 'past';

const DayCell: React.FC<{ date: Date; status: DayStatus }> = ({ date, status }) => (
    <div
        className={cn(
            'aspect-square rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-all',
            status === 'active' && 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400',
            status === 'new'    && 'bg-primary/10 border-primary/30 text-primary',
            status === 'past'   && 'bg-muted/20 border-border/30 text-muted-foreground/30',
        )}
        title={`${format(date, 'EEE, MMM d')} — ${
            status === 'active' ? 'Roster active' :
            status === 'past'   ? 'Past date (skipped)' :
            'Will be created'
        }`}
    >
        <span className="text-[9px] font-black leading-none">{format(date, 'd')}</span>
        {status === 'active' && <Zap className="h-2 w-2 fill-current opacity-90" />}
        {status === 'new'    && <div className="h-1 w-1 rounded-full bg-primary/60" />}
    </div>
);

// ── Component ─────────────────────────────────────────────────────────────────

export const PlanRosterPeriodDialog: React.FC<PlanRosterPeriodDialogProps> = ({
    open,
    onOpenChange,
    organizationId,
    departmentId,
    preSelectedSubDeptId,
    selectedDate,
}) => {
    // ── Scope lookups ──────────────────────────────────────────────────────────
    const { data: organizations = [] } = useOrganizations();
    const { data: departments   = [] } = useDepartments(organizationId);
    const { data: subDepts      = [] } = useSubDepartments(departmentId);
    const { data: templates     = [] } = useTemplates(undefined, departmentId);

    const orgName   = (organizations as { id: string; name: string }[]).find(o => o.id === organizationId)?.name ?? '...';
    const deptName  = (departments   as { id: string; name: string }[]).find(d => d.id === departmentId)?.name  ?? '...';
    const subDeptName = preSelectedSubDeptId
        ? (subDepts as { id: string; name: string }[]).find(s => s.id === preSelectedSubDeptId)?.name ?? '...'
        : null;

    // Sub-dept IDs come entirely from global scope — no user selection needed
    const scopedSubDeptIds: string[] = useMemo(
        () => preSelectedSubDeptId
            ? [preSelectedSubDeptId]
            : (subDepts as { id: string }[]).map(s => s.id),
        [preSelectedSubDeptId, subDepts]
    );

    const createPeriod = useCreatePlanningPeriod();

    // ── State ──────────────────────────────────────────────────────────────────
    const [preset,      setPreset]      = useState<PresetKey>('this-month');
    const [customStart, setCustomStart] = useState(format(startOfMonth(selectedDate), 'yyyy-MM-dd'));
    const [customEnd,   setCustomEnd]   = useState(format(endOfMonth(selectedDate),   'yyyy-MM-dd'));
    const [templateId,  setTemplateId]  = useState<string>('none');

    // ── Derived date range ─────────────────────────────────────────────────────
    const dateRange = useMemo((): DateRange => {
        if (preset === 'custom') {
            return {
                start: new Date(`${customStart}T12:00:00`),
                end:   new Date(`${customEnd}T12:00:00`),
            };
        }
        return getPresetRange(preset, selectedDate);
    }, [preset, selectedDate, customStart, customEnd]);

    const dayCount = differenceInDays(dateRange.end, dateRange.start) + 1;
    const allDates = useMemo(
        () => eachDayOfInterval({ start: dateRange.start, end: dateRange.end }),
        [dateRange]
    );

    // ── Existing rosters for calendar ─────────────────────────────────────────
    const { data: existingRosters = [] } = useRostersLookup(
        organizationId,
        { departmentIds: [departmentId], subDepartmentIds: scopedSubDeptIds }
    );

    const activeDates = useMemo(() => {
        const set = new Set<string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (existingRosters as any[]).forEach(r => set.add(r.start_date as string));
        return set;
    }, [existingRosters]);

    const getDayStatus = (date: Date): DayStatus => {
        const dateStr = format(date, 'yyyy-MM-dd');
        if (activeDates.has(dateStr))           return 'active';
        if (isBefore(startOfDay(date), startOfDay(new Date()))) return 'past';
        return 'new';
    };

    const firstDayOffset = (allDates[0]?.getDay() + 6) % 7; // Mon-start

    // ── Submit ─────────────────────────────────────────────────────────────────
    const canSubmit = scopedSubDeptIds.length > 0 && dayCount > 0 && !createPeriod.isPending;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        try {
            await createPeriod.mutateAsync({
                organizationId,
                departmentId,
                subDeptIds:   scopedSubDeptIds,
                startDate:    format(dateRange.start, 'yyyy-MM-dd'),
                endDate:      format(dateRange.end,   'yyyy-MM-dd'),
                templateId:   templateId !== 'none' ? templateId : null,
                autoSeed:     templateId !== 'none',
                autoPublish:  false,
                overridePast: false,
            });
            onOpenChange(false);
        } catch {
            // handled by mutation toast
        }
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px] bg-background border-border text-foreground shadow-2xl p-0 overflow-hidden ring-1 ring-border rounded-[2rem]">
                <div className="overflow-y-auto max-h-[90vh] custom-scrollbar">

                    {/* Header */}
                    <div className="p-8 pb-5 bg-muted/30 border-b border-border space-y-4">
                        <div>
                            <DialogTitle className="text-2xl font-black tracking-tighter">
                                Plan Roster Period
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground/70 mt-1">
                                Activate rosters + seed shifts in a single action.
                            </DialogDescription>
                        </div>

                        {/* Inherited scope breadcrumb */}
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-background/60 border border-border/60 text-xs font-bold text-muted-foreground flex-wrap">
                            <span className="opacity-50 truncate">{orgName}</span>
                            <ChevronRight className="h-3 w-3 opacity-30 flex-shrink-0" />
                            <span className="text-primary/80 truncate">{deptName}</span>
                            {subDeptName && (
                                <>
                                    <ChevronRight className="h-3 w-3 opacity-30 flex-shrink-0" />
                                    <span className="text-primary truncate">{subDeptName}</span>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="p-8 space-y-7">

                        {/* ── Date Range ──────────────────────────────────────────── */}
                        <section className="space-y-3">
                            <Label className="text-[10px] uppercase font-black tracking-[0.15em] text-muted-foreground/70 flex items-center gap-2">
                                <CalendarRange className="h-3.5 w-3.5" />
                                Date Range
                            </Label>

                            <div className="flex flex-wrap gap-2">
                                {(Object.keys(PRESET_LABELS) as PresetKey[]).map(key => (
                                    <button
                                        key={key}
                                        onClick={() => setPreset(key)}
                                        className={cn(
                                            'px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all',
                                            preset === key
                                                ? 'bg-primary text-primary-foreground border-primary'
                                                : 'bg-muted text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                                        )}
                                    >
                                        {PRESET_LABELS[key]}
                                    </button>
                                ))}
                            </div>

                            {preset === 'custom' && (
                                <div className="flex items-center gap-3">
                                    <input
                                        type="date"
                                        value={customStart}
                                        onChange={e => setCustomStart(e.target.value)}
                                        className="flex-1 h-9 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                    <input
                                        type="date"
                                        value={customEnd}
                                        onChange={e => setCustomEnd(e.target.value)}
                                        className="flex-1 h-9 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            )}

                            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                                <Badge variant="outline" className="bg-primary/10 border-primary/20 text-primary font-mono">
                                    {dayCount}d
                                </Badge>
                                <span>{format(dateRange.start, 'MMM d, yyyy')}</span>
                                <ChevronRight className="h-3 w-3 opacity-40" />
                                <span>{format(dateRange.end, 'MMM d, yyyy')}</span>
                            </div>

                            {/* Calendar — only for ranges ≤ 42 days */}
                            {allDates.length <= 42 && (
                                <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-3">
                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-[9px] uppercase font-black tracking-widest text-muted-foreground/50">
                                            Calendar Preview
                                        </span>
                                        <div className="flex items-center gap-3">
                                            <span className="flex items-center gap-1 text-[9px] font-bold text-amber-500/80">
                                                <Zap className="h-2.5 w-2.5 fill-current" /> Active
                                            </span>
                                            <span className="flex items-center gap-1 text-[9px] font-bold text-primary/80">
                                                <div className="h-1.5 w-1.5 rounded-full bg-primary" /> New
                                            </span>
                                            <span className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground/40">
                                                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" /> Past
                                            </span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-7">
                                        {['M','T','W','T','F','S','S'].map((d, i) => (
                                            <div key={i} className="text-center text-[8px] font-black text-muted-foreground/40 uppercase tracking-widest pb-1">
                                                {d}
                                            </div>
                                        ))}
                                    </div>

                                    <div className="grid grid-cols-7 gap-1">
                                        {Array.from({ length: firstDayOffset }).map((_, i) => <div key={`pad-${i}`} />)}
                                        {allDates.map((date, i) => (
                                            <DayCell key={i} date={date} status={getDayStatus(date)} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </section>

                        {/* ── Template ─────────────────────────────────────────────── */}
                        <section className="space-y-3">
                            <Label className="text-[10px] uppercase font-black tracking-[0.15em] text-muted-foreground/70 flex items-center gap-2">
                                <Sparkles className="h-3.5 w-3.5" />
                                Template
                                <span className="text-muted-foreground/40 font-normal normal-case tracking-normal">
                                    — optional, seeds shifts automatically
                                </span>
                            </Label>
                            <Select value={templateId} onValueChange={setTemplateId}>
                                <SelectTrigger className="bg-muted/50 border-border rounded-xl h-10">
                                    <SelectValue placeholder="Select a template…" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">No template — create empty rosters</SelectItem>
                                    {(templates as { id: string; name: string }[]).map(t => (
                                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </section>

                    </div>

                    {/* Footer */}
                    <DialogFooter className="bg-muted/30 border-t border-border p-6 flex-col sm:flex-row gap-3">
                        <Button
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            disabled={createPeriod.isPending}
                            className="h-11 px-6 rounded-xl text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={!canSubmit}
                            className="flex-1 sm:flex-none h-11 px-8 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 font-black text-xs uppercase tracking-[0.15em] transition-all active:scale-95"
                        >
                            {createPeriod.isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Creating…
                                </>
                            ) : (
                                <>
                                    <Zap className="mr-2 h-4 w-4 fill-current" />
                                    Create Period
                                    <Badge variant="outline" className="ml-2 bg-white/20 border-white/20 text-white text-[10px] font-bold">
                                        {dayCount}d
                                    </Badge>
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default PlanRosterPeriodDialog;
