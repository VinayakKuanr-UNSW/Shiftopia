/**
 * "Copy this shift to…" — a date range, and which days of the week in it get a
 * copy.
 *
 * LAID OUT LIKE A PERMISSIONS FORM: a group of sections, each a title, a line of
 * description, a switch for the whole section and a checkbox per member. Here the
 * sections are Weekdays and Weekends and the members are the days. The switch
 * turns the whole section on or off; the checkboxes pick within it.
 *
 * CHECKED MEANS "GETS A COPY". The earlier version asked which days to EXCLUDE,
 * which reads both ways to about half of people. The state underneath is still
 * an exclusion set — that is what `planCopy` takes — but nothing on screen asks
 * the manager to think in negatives.
 *
 * NO LIVE COUNT. The plan is still computed as the manager types (it gates
 * Apply), but the outcome — "Copied to X dates, Y dates skipped", with reasons —
 * is reported once, by the toast, after the write.
 */
import React from 'react';
import { format } from 'date-fns';

import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import { Button } from '@/modules/core/ui/primitives/button';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Switch } from '@/modules/core/ui/primitives/switch';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import type { CopyPlan } from '../../domain/copyPlan';
import type { IsoWeekday } from '../../domain/types';

interface DaySection {
    key: string;
    title: string;
    description: string;
    days: ReadonlyArray<{ iso: IsoWeekday; label: string }>;
}

/** Mon → Sun, the order the grid's columns run in. */
const SECTIONS: readonly DaySection[] = [
    {
        key: 'weekdays',
        title: 'Weekdays',
        description: 'Copy onto Monday to Friday in the range.',
        days: [
            { iso: 1, label: 'Monday' }, { iso: 2, label: 'Tuesday' },
            { iso: 3, label: 'Wednesday' }, { iso: 4, label: 'Thursday' },
            { iso: 5, label: 'Friday' },
        ],
    },
    {
        key: 'weekends',
        title: 'Weekends',
        description: 'Copy onto Saturday and Sunday in the range.',
        days: [{ iso: 6, label: 'Saturday' }, { iso: 7, label: 'Sunday' }],
    },
];

export interface CopyShiftDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Who and what is being copied, for the header. */
    employeeName: string;
    sourceDate: string;
    sourceTimeLabel: string;
    startDate: string;
    endDate: string;
    /** Earliest selectable date — today. Nothing is copied into the past. */
    minDate?: string;
    /** ISO weekdays that do NOT get a copy. */
    excluded: ReadonlySet<IsoWeekday>;
    onStartDateChange: (value: string) => void;
    onEndDateChange: (value: string) => void;
    onToggleWeekday: (iso: IsoWeekday) => void;
    /** Recomputed by the caller as the inputs change. Gates Apply. */
    plan: CopyPlan;
    /** True while the cycle ceiling for the range is still loading. */
    planning?: boolean;
    onConfirm: () => void;
    busy?: boolean;
    /** While a copy runs: dates written so far. A long copy must not look stalled. */
    progress?: { done: number; total: number } | null;
    /**
     * Why nothing can be copied at all, whatever the dates — e.g. the cycle
     * this copy would be checked against cannot be read. Disables Apply and
     * says so, rather than leaving a greyed button to explain itself.
     */
    blockedReason?: string | null;
}

export const CopyShiftDialog: React.FC<CopyShiftDialogProps> = ({
    open, onOpenChange, employeeName, sourceDate, sourceTimeLabel,
    startDate, endDate, minDate, excluded,
    onStartDateChange, onEndDateChange, onToggleWeekday,
    plan, planning, onConfirm, busy, progress, blockedReason,
}) => {
    const rangeInvalid = Boolean(startDate && endDate && endDate < startDate);

    /** Section switch: on if any of its days gets a copy. */
    const setSection = (section: DaySection, on: boolean) => {
        for (const { iso } of section.days) {
            // Toggle only the days whose state differs, so the result is exactly
            // "all on" or "all off" whatever mix the checkboxes were in.
            if (excluded.has(iso) === on) onToggleWeekday(iso);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Copy Shift</DialogTitle>
                    <DialogDescription>
                        {employeeName} · {sourceTimeLabel} ·{' '}
                        {sourceDate ? format(new Date(`${sourceDate}T00:00:00`), 'EEE d MMM yyyy') : ''}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="copy-start">Start date</Label>
                            <Input
                                id="copy-start"
                                type="date"
                                value={startDate}
                                min={minDate}
                                onChange={(e) => onStartDateChange(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="copy-end">End date</Label>
                            <Input
                                id="copy-end"
                                type="date"
                                value={endDate}
                                min={startDate || minDate}
                                onChange={(e) => onEndDateChange(e.target.value)}
                            />
                        </div>
                    </div>

                    {rangeInvalid && (
                        <p className={cn(text.caption, 'text-red-400')}>
                            The end date is before the start date.
                        </p>
                    )}

                    <div className="space-y-2">
                        <p className={text.label}>Days</p>
                        <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                            {SECTIONS.map(section => {
                                const on = section.days.some(d => !excluded.has(d.iso));
                                const switchId = `copy-section-${section.key}`;
                                return (
                                    <div
                                        key={section.key}
                                        role="group"
                                        aria-labelledby={`${switchId}-title`}
                                        className="p-4 space-y-3"
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <Label
                                                    id={`${switchId}-title`}
                                                    htmlFor={switchId}
                                                    className="text-sm font-semibold cursor-pointer"
                                                >
                                                    {section.title}
                                                </Label>
                                                <p className={cn(text.subtle, 'mt-0.5')}>{section.description}</p>
                                            </div>
                                            <Switch
                                                id={switchId}
                                                checked={on}
                                                onCheckedChange={(v) => setSection(section, v)}
                                            />
                                        </div>
                                        {on && (
                                            <div className="space-y-2.5 pt-1">
                                                {section.days.map(({ iso, label }) => (
                                                    <div key={iso} className="flex items-center gap-2.5">
                                                        <Checkbox
                                                            id={`copy-day-${iso}`}
                                                            checked={!excluded.has(iso)}
                                                            onCheckedChange={() => onToggleWeekday(iso)}
                                                        />
                                                        <Label htmlFor={`copy-day-${iso}`} className="cursor-pointer font-normal">
                                                            {label}
                                                        </Label>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Only when Apply is disabled for a reason the fields do not
                        already show — otherwise a greyed button is a dead end. */}
                    {blockedReason ? (
                        <p className={cn(text.caption, 'text-red-400')}>{blockedReason}</p>
                    ) : planning ? (
                        <p className={text.subtle}>Checking the roster and hours ceiling for these dates…</p>
                    ) : !rangeInvalid && startDate && endDate && plan.targets.length === 0 && (
                        <p className={text.subtle}>
                            No date in this range can take a copy.
                        </p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        onClick={onConfirm}
                        disabled={busy || planning || plan.targets.length === 0 || rangeInvalid || Boolean(blockedReason)}
                    >
                        {busy
                            ? (progress ? `Applying… ${progress.done} of ${progress.total}` : 'Applying…')
                            : 'Apply'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default CopyShiftDialog;
