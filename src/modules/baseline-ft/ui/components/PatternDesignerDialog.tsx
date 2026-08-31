/**
 * Designing a baseline pattern, compliant by construction.
 *
 * THE HOURS ARE NOT AN INPUT. The author chooses which days the employee works
 * and what time they start; the length of each day is DERIVED from the
 * contracted weekly hours. That inversion is the whole point — 38 ÷ 5 is 7.6h
 * exactly, which is also cl 35.1(c)'s daily floor, so asking a human to type
 * the day length is asking them to be right to the minute with no margin. The
 * production template called "Baseline FT" is what happens when they are not:
 * 8.0h days, 40h a week, against a 38h contract.
 *
 * Day counts that cannot work are disabled with the reason attached rather than
 * hidden, so "why can't I pick six days?" is answered where it is asked.
 */

import React from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import { designPattern, lawfulDayCounts } from '../../domain/patternDesigner';
import type { IsoWeekday } from '../../domain/types';
import { FindingList } from './FindingList';
import { fmtHours } from './BaselineLedger';

const DAYS: ReadonlyArray<{ iso: IsoWeekday; short: string; long: string }> = [
    { iso: 1, short: 'Mon', long: 'Monday' },
    { iso: 2, short: 'Tue', long: 'Tuesday' },
    { iso: 3, short: 'Wed', long: 'Wednesday' },
    { iso: 4, short: 'Thu', long: 'Thursday' },
    { iso: 5, short: 'Fri', long: 'Friday' },
    { iso: 6, short: 'Sat', long: 'Saturday' },
    { iso: 7, short: 'Sun', long: 'Sunday' },
];

export interface PatternDesignerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Roles the sub-department can roster. */
    roles: ReadonlyArray<{ id: string; name: string }>;
    /** Derived from the FT contracts in scope; 38 when none say otherwise. */
    contractedWeeklyHours: number;
    subDepartmentName: string;
    isSaving: boolean;
    onCreate: (args: {
        name: string;
        days: IsoWeekday[];
        startTime: string;
        unpaidBreakMinutes: number;
        roleId: string;
    }) => void;
}

export const PatternDesignerDialog: React.FC<PatternDesignerDialogProps> = ({
    open, onOpenChange, roles, contractedWeeklyHours, subDepartmentName, isSaving, onCreate,
}) => {
    const [name, setName] = React.useState('');
    const [days, setDays] = React.useState<IsoWeekday[]>([1, 2, 3, 4, 5]);
    const [startTime, setStartTime] = React.useState('08:00');
    const [unpaidBreak, setUnpaidBreak] = React.useState(30);
    const [roleId, setRoleId] = React.useState('');

    // Reset each time it opens, so a previous attempt does not leak in.
    React.useEffect(() => {
        if (!open) return;
        setName(`${subDepartmentName} full-time baseline`);
        setDays([1, 2, 3, 4, 5]);
        setStartTime('08:00');
        setUnpaidBreak(30);
        setRoleId(roles.length === 1 ? roles[0].id : '');
    }, [open, subDepartmentName, roles]);

    const allowedCounts = React.useMemo(
        () => lawfulDayCounts(contractedWeeklyHours),
        [contractedWeeklyHours],
    );

    const design = React.useMemo(
        () => designPattern({
            weeklyHours: contractedWeeklyHours,
            days,
            startTime,
            unpaidBreakMinutes: unpaidBreak,
            roleId,
        }),
        [contractedWeeklyHours, days, startTime, unpaidBreak, roleId],
    );

    const blocked = design.findings.some(f => f.severity === 'BLOCKING');
    // >= 3, matching the `valid_name_length` CHECK on roster_templates. A
    // client gate looser than the database turns a fixable form error into an
    // opaque 400 from the write.
    const canSave = !blocked && design.slots.length > 0 && name.trim().length >= 3 && !isSaving;

    const toggleDay = (iso: IsoWeekday) => {
        setDays(prev => prev.includes(iso) ? prev.filter(d => d !== iso) : [...prev, iso].sort());
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Design a baseline pattern</DialogTitle>
                    <DialogDescription>
                        Choose the days and the start time. The length of each day is worked out
                        from the {fmtHours(contractedWeeklyHours)} contract, so the pattern adds up
                        exactly.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="bftp-name" className={text.label}>Pattern name</Label>
                        <Input
                            id="bftp-name" value={name} className={touch.targetY}
                            onChange={e => setName(e.target.value)}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className={text.label}>Working days</Label>
                        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                            {DAYS.map(d => {
                                const on = days.includes(d.iso);
                                return (
                                    <button
                                        key={d.iso}
                                        type="button"
                                        onClick={() => toggleDay(d.iso)}
                                        aria-pressed={on}
                                        aria-label={d.long}
                                        className={cn(
                                            touch.target, text.label,
                                            'rounded-md border px-2 transition-colors',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            on
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'border-border bg-background hover:bg-muted',
                                        )}
                                    >
                                        {d.short}
                                    </button>
                                );
                            })}
                        </div>
                        <p className={text.caption}>
                            {allowedCounts.length > 0
                                ? `A ${fmtHours(contractedWeeklyHours)} week divides evenly across ` +
                                  `${allowedCounts.join(' or ')} day${allowedCounts.length === 1 ? '' : 's'}. ` +
                                  `You have chosen ${days.length}.`
                                : `No number of equal days fits between the 7.6-hour minimum and the 12-hour maximum.`}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="bftp-start" className={text.label}>Start time</Label>
                            <Input
                                id="bftp-start" type="time" value={startTime} className={touch.targetY}
                                onChange={e => setStartTime(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="bftp-break" className={text.label}>Unpaid meal break</Label>
                            <Select
                                value={String(unpaidBreak)}
                                onValueChange={v => setUnpaidBreak(Number(v))}
                            >
                                <SelectTrigger id="bftp-break" className={touch.targetY}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {[30, 45, 60].map(m => (
                                        <SelectItem key={m} value={String(m)}>{m} minutes</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="bftp-role" className={text.label}>Role</Label>
                        <Select value={roleId || undefined} onValueChange={setRoleId}>
                            <SelectTrigger id="bftp-role" className={touch.targetY}>
                                <SelectValue placeholder="Choose a role" />
                            </SelectTrigger>
                            <SelectContent>
                                {roles.map(r => (
                                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* What the design actually produces, before it is saved. */}
                    {design.slots.length > 0 && (
                        <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
                            <p className={text.overline}>Result</p>
                            <p className={cn(text.body, 'mt-1')}>
                                {design.slots.length} shifts a week,{' '}
                                <strong>{design.slots[0].startTime}–{design.slots[0].endTime}</strong>,{' '}
                                {fmtHours(design.hoursPerDay)} each — {fmtHours(design.weeklyHours)} a week.
                            </p>
                            <p className={cn(text.caption, 'mt-0.5')}>
                                Includes {design.slots[0].unpaidBreakMinutes}m unpaid meal break and{' '}
                                {design.slots[0].paidBreakMinutes}m paid rest.
                            </p>
                        </div>
                    )}

                    <FindingList findings={design.findings} showCalculation />
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        className={touch.targetY}
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        className={touch.targetY}
                        disabled={!canSave}
                        onClick={() => onCreate({
                            name: name.trim(), days, startTime,
                            unpaidBreakMinutes: unpaidBreak, roleId,
                        })}
                    >
                        {isSaving
                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                            : <Wand2 className="mr-2 h-4 w-4" aria-hidden="true" />}
                        Create pattern
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
