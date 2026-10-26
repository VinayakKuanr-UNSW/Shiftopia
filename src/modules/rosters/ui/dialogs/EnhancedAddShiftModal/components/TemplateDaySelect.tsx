/**
 * Which weekday(s) a TEMPLATE shift repeats on.
 *
 * WHY THIS DID NOT EXIST. `template_shifts.day_of_week` has always been on the
 * row, and `save_template_full` has always written it, but no control ever set
 * it — so the value arrived as `null` every time, and `null` means "stamp this
 * shift on EVERY date in the range" to
 * `apply_template_to_date_range_v2`. All 26 template shifts in production were
 * null, which is not 26 authors choosing the wildcard; it is 26 authors never
 * being asked.
 *
 * "Every day" REMAINS AVAILABLE, deliberately. It is a real and occasionally
 * correct answer — a daily setup shift, say. It has to be chosen: the field
 * starts empty and the save gate asks for it. Choosing it ticks all seven days
 * and greys them out, because it is ONE wildcard row (`day_of_week = null`), not
 * seven.
 *
 * MULTI-SELECT (2026-10-25). A row still holds one day, so picking several days
 * when ADDING saves one template shift per day (the orchestrator loops). EDITING
 * an existing row changes that row's single day only, so `multiple` is off there.
 * Built on PickerField, like every other dropdown in the Add Shift form.
 *
 * Values are 0 = Sunday … 6 = Saturday, matching the column and JavaScript's
 * `getDay()`. Worth knowing when reading this alongside the compliance layer,
 * which speaks ISO (1 = Monday … 7 = Sunday) because every work-cycle boundary
 * is anchored to a Monday — see `compliance/ordinary-hours-cycle.ts`. Anything
 * converting between the two conventions has to say which one it is holding.
 */

import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { CommandItem, CommandShortcut } from '@/modules/core/ui/primitives/command';
import { PICKER_CONTENT_CLASS, PICKER_ROW, PickerPanel, PickerTick, PickerTrigger } from '@/modules/core/ui/components/PickerField';

/** Monday-first for display; values are the stored Sunday-first encoding. */
export const TEMPLATE_WEEKDAYS: ReadonlyArray<{ value: number; label: string; short: string }> = Object.freeze([
    { value: 1, label: 'Monday', short: 'Mon' },
    { value: 2, label: 'Tuesday', short: 'Tue' },
    { value: 3, label: 'Wednesday', short: 'Wed' },
    { value: 4, label: 'Thursday', short: 'Thu' },
    { value: 5, label: 'Friday', short: 'Fri' },
    { value: 6, label: 'Saturday', short: 'Sat' },
    { value: 0, label: 'Sunday', short: 'Sun' },
]);

/** `undefined` = not chosen yet; `null` = every day; otherwise the chosen days. */
export type TemplateDays = number[] | null | undefined;

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 0];
const sameSet = (a: number[], b: number[]) => a.length === b.length && b.every(d => a.includes(d));

/** "Every day", "Weekdays", "Weekends", or the short names in Monday-first order. */
export function describeTemplateDays(days: TemplateDays): string | null {
    if (days === null) return 'Every day';
    if (!days || days.length === 0) return null;
    if (sameSet(days, WEEKDAYS)) return 'Weekdays';
    if (sameSet(days, WEEKEND)) return 'Weekends';
    return TEMPLATE_WEEKDAYS.filter(d => days.includes(d.value)).map(d => d.short).join(', ');
}

/** The single `day_of_week` a selection maps to (the save gates read this). */
export const firstTemplateDay = (days: TemplateDays): number | null | undefined =>
    days === null ? null : days?.[0];

/** The picker value for a row that holds one `day_of_week`. */
export const daysFromTemplateDay = (day: number | null | undefined): TemplateDays =>
    day === null ? null : day === undefined ? undefined : [day];

/** The next selection after toggling `day`. Picking all seven becomes the wildcard. */
export function toggleTemplateDay(days: TemplateDays, day: number, multiple: boolean): TemplateDays {
    if (!multiple) return [day];
    const current = days ?? [];
    const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day];
    if (next.length === 0) return undefined;
    return next.length === TEMPLATE_WEEKDAYS.length ? null : next;
}

export interface TemplateDaySelectProps {
    value: TemplateDays;
    onChange: (value: TemplateDays) => void;
    /** Several days at once (adding). Off when editing one existing row. */
    multiple?: boolean;
    disabled?: boolean;
    id?: string;
    className?: string;
}

export const TemplateDaySelect: React.FC<TemplateDaySelectProps> = ({
    value, onChange, multiple = true, disabled, id = 'template-day-of-week', className,
}) => {
    const [open, setOpen] = useState(false);
    const isEveryDay = value === null;
    const summary = describeTemplateDays(value);

    const pick = (day: number) => {
        onChange(toggleTemplateDay(value, day, multiple));
        if (!multiple) setOpen(false);
    };
    const pickEveryDay = () => {
        onChange(isEveryDay && multiple ? undefined : null);
        if (!multiple) setOpen(false);
    };

    const hint = isEveryDay
        ? 'Created on every date the template is applied to, including public holidays.'
        : multiple && (value?.length ?? 0) > 1
            ? `Adds ${value!.length} shifts, one for each day.`
            : null;

    return (
        <div className={className}>
            <Popover open={open && !disabled} onOpenChange={(next) => setOpen(next)} modal={false}>
                <PopoverTrigger asChild>
                    <PickerTrigger
                        id={id}
                        label="Repeats on"
                        required
                        display={summary ?? (multiple ? 'Choose days' : 'Choose a day')}
                        isEmpty={!summary}
                        isOpen={open}
                        disabled={disabled}
                    />
                </PopoverTrigger>
                <PopoverContent className={PICKER_CONTENT_CLASS} sideOffset={10} align="center">
                    <PickerPanel
                        heading={multiple ? 'Days' : 'Day'}
                        searchPlaceholder="Search days..."
                        emptyText="No days found."
                        onClose={() => setOpen(false)}
                        selectVerb={multiple ? 'Toggle' : 'Select'}
                    >
                        <CommandItem
                            value="Every day"
                            onSelect={pickEveryDay}
                            aria-checked={isEveryDay}
                            className={PICKER_ROW}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <PickerTick on={isEveryDay} shape={multiple ? 'square' : 'circle'} />
                                <span className="flex flex-col min-w-0">
                                    <span className="font-semibold text-[13px] sm:text-[14px]">Every day</span>
                                    <span className="text-[11px] text-muted-foreground group-aria-selected:text-white/70">
                                        repeats on every date in the range
                                    </span>
                                </span>
                            </div>
                            <CommandShortcut className="group-aria-selected:text-white/60" aria-hidden="true">↵</CommandShortcut>
                        </CommandItem>
                        {TEMPLATE_WEEKDAYS.map(d => {
                            const on = isEveryDay || (value ?? []).includes(d.value);
                            return (
                                <CommandItem
                                    key={d.value}
                                    value={d.label}
                                    // Every day is one wildcard row: the days show ticked but
                                    // cannot be changed until it is turned off.
                                    disabled={isEveryDay && multiple}
                                    onSelect={() => pick(d.value)}
                                    aria-checked={on}
                                    className={PICKER_ROW}
                                >
                                    <div className="flex items-center gap-3">
                                        <PickerTick on={on} shape={multiple ? 'square' : 'circle'} />
                                        <span className="font-semibold text-[13px] sm:text-[14px]">{d.label}</span>
                                    </div>
                                    <CommandShortcut className="group-aria-selected:text-white/60" aria-hidden="true">↵</CommandShortcut>
                                </CommandItem>
                            );
                        })}
                    </PickerPanel>
                </PopoverContent>
            </Popover>
            {hint && <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
    );
};
