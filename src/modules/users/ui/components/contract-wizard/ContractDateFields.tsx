import React from 'react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { X } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Button } from '@/modules/core/ui/primitives/button';
import { DatePicker } from '@/modules/core/ui/calendar/DatePicker';
import { todayISO } from '@/modules/core/lib/date.utils';

interface ContractDateFieldsProps {
    /** ISO yyyy-MM-dd */
    start_date: string;
    /** ISO yyyy-MM-dd, or '' for an ongoing contract */
    end_date: string;
    onChange: (patch: { start_date?: string; end_date?: string }) => void;
    /** The start date as saved, when editing: keeping it isn't backdating. */
    savedStart?: string;
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const nice = (s: string) => format(parseISO(s), 'd MMM yyyy');

/**
 * When the contract runs. The status follows from these dates, set by the
 * database: Upcoming before the start, Active, Expired after the last day.
 */
export const ContractDateFields: React.FC<ContractDateFieldsProps> = ({ start_date, end_date, onChange, savedStart }) => {
    const today = todayISO();
    const start = start_date ? parseISO(start_date) : undefined;
    const end = end_date ? parseISO(end_date) : undefined;
    const backdated = !!start_date && start_date < today && start_date !== savedStart;
    const daysBack = backdated ? differenceInCalendarDays(parseISO(today), start!) : 0;
    const upcoming = !!start_date && start_date > today;
    const outOfOrder = !!start_date && !!end_date && end_date < start_date;
    const endsNow = !!end_date && end_date <= today && !outOfOrder;

    const startNote = upcoming
        ? `Upcoming: no access or rostering until ${nice(start_date)}.`
        : backdated
            ? `Backdated ${daysBack} day${daysBack === 1 ? '' : 's'}. Access applies from now, and pay for shifts already processed isn't recalculated.`
            : null;

    return (
        <fieldset className="w-full text-left space-y-3">
            <legend className={cn(text.label, 'mb-1.5')}>Dates</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                    <span className={text.caption}>Start date</span>
                    <DatePicker
                        value={start}
                        onChange={(d) => onChange({ start_date: iso(d) })}
                        label="Start date"
                        placeholder="Pick a start date"
                        triggerClassName={cn(touch.targetY, 'w-full rounded-lg border-border bg-background')}
                    />
                </div>
                <div className="space-y-1">
                    <span className={text.caption}>Last day <span className="text-muted-foreground">(optional)</span></span>
                    <div className="flex items-center gap-1.5">
                        <DatePicker
                            value={end}
                            onChange={(d) => onChange({ end_date: iso(d) })}
                            label="Last day"
                            placeholder="Ongoing"
                            fromDate={start}
                            triggerClassName={cn(touch.targetY, 'w-full rounded-lg border-border bg-background')}
                        />
                        {end_date && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={cn(touch.target, 'shrink-0')}
                                onClick={() => onChange({ end_date: '' })}
                                aria-label="Clear the last day (ongoing contract)"
                            >
                                <X className="h-4 w-4" aria-hidden="true" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
            {startNote && <p className={text.caption}>{startNote}</p>}
            {outOfOrder && (
                <p className="text-[11px] text-destructive" role="alert">The last day is before the start date.</p>
            )}
            {endsNow && (
                <p className={text.caption}>
                    A last day of today or earlier ends the contract when you save: its access stops, and it becomes a read-only record.
                </p>
            )}
            {!end_date && <p className={text.subtle}>No last day: the contract runs until it is ended.</p>}
        </fieldset>
    );
};

