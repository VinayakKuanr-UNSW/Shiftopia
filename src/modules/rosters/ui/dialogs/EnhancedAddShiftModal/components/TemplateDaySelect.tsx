/**
 * Which weekday a TEMPLATE shift repeats on.
 *
 * WHY THIS DID NOT EXIST. `template_shifts.day_of_week` has always been on the
 * row, and `save_template_full` has always written it, but no control ever set
 * it — so the value arrived as `null` every time, and `null` means "stamp this
 * shift on EVERY date in the range" to
 * `apply_template_to_date_range_v2`. All 26 template shifts in production were
 * null, which is not 26 authors choosing the wildcard; it is 26 authors never
 * being asked. The Office generator refuses such a template outright,
 * because a shape with no schedule is not a weekly pattern.
 *
 * "Every day" REMAINS AVAILABLE, deliberately. It is a real and occasionally
 * correct answer — a daily setup shift, say — and removing it would break
 * templates that rely on it. What changes is that it has to be chosen: the
 * field starts empty and the save gate asks for it, so the wildcard is a
 * decision rather than the residue of an unasked question.
 *
 * Values are 0 = Sunday … 6 = Saturday, matching the column and JavaScript's
 * `getDay()`. Worth knowing when reading this alongside the compliance layer,
 * which speaks ISO (1 = Monday … 7 = Sunday) because every work-cycle boundary
 * is anchored to a Monday — see `compliance/ordinary-hours-cycle.ts`. Anything
 * converting between the two conventions has to say which one it is holding.
 */

import React from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';

/** Sunday-first, matching the stored encoding rather than the ISO one. */
export const TEMPLATE_WEEKDAYS: ReadonlyArray<{ value: number; label: string }> = Object.freeze([
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
    { value: 0, label: 'Sunday' },
]);

/** Sentinel for the wildcard. `null` cannot round-trip through a Select value. */
const EVERY_DAY = 'every-day';

export interface TemplateDaySelectProps {
    /** `undefined` = not chosen yet; `null` = explicitly every day. */
    value: number | null | undefined;
    onChange: (value: number | null) => void;
    disabled?: boolean;
    id?: string;
    className?: string;
}

export const TemplateDaySelect: React.FC<TemplateDaySelectProps> = ({
    value, onChange, disabled, id = 'template-day-of-week', className,
}) => {
    const selected =
        value === null ? EVERY_DAY
            : typeof value === 'number' ? String(value)
                : undefined;

    return (
        <div className={cn('space-y-1.5', className)}>
            <label
                htmlFor={id}
                className="flex items-center gap-1.5 text-[12px] font-bold text-foreground"
            >
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Repeats on
                <span className="text-destructive" aria-hidden="true">*</span>
            </label>

            <Select
                value={selected}
                disabled={disabled}
                onValueChange={v => onChange(v === EVERY_DAY ? null : Number(v))}
            >
                <SelectTrigger id={id} className="min-h-11">
                    <SelectValue placeholder="Choose a day" />
                </SelectTrigger>
                <SelectContent>
                    {TEMPLATE_WEEKDAYS.map(d => (
                        <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                    ))}
                    <SelectItem value={EVERY_DAY}>
                        <span className="flex items-baseline gap-2">
                            <span>Every day</span>
                            <span className="text-[10px] text-muted-foreground">
                                repeats on every date in the range
                            </span>
                        </span>
                    </SelectItem>
                </SelectContent>
            </Select>

            <p className="text-[10px] text-muted-foreground">
                {value === null
                    ? 'This shift will be created on every date the template is applied to, including public holidays.'
                    : 'The day of the week this shift repeats on when the template is applied.'}
            </p>
        </div>
    );
};
