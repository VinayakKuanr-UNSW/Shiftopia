/**
 * "When I can't work" — the subtractive half of the availability page.
 *
 * This is where a permanent's agency actually lives. They cannot usefully
 * declare availability (their contract already says when they can be
 * rostered), and leave is for absences that draw down a balance. What is left
 * is the exception: an appointment, a study block, a stretch of nights they
 * would rather not take.
 *
 * SEVERITY IS PHRASED AS INTENT, not as the solver's tier names. "I can't work
 * then" (SOFT) and "I'd rather not" (PREFERENCE) are the two an employee may
 * set; HARD is manager-only and never offered here, because it removes them
 * from consideration outright with no balance consumed and no record of having
 * been granted. RLS enforces that independently — this is the courtesy copy.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarX2, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import {
    createAvailabilityException,
    deleteAvailabilityException,
    listAvailabilityExceptions,
    type AvailabilityException,
    type ExceptionSeverity,
} from '../../api/exceptions.api';

/** Employee-settable severities, phrased as the employee would say them. */
const SEVERITY_COPY: Record<'SOFT' | 'PREFERENCE', { label: string; hint: string }> = {
    SOFT: {
        label: "I can't work then",
        hint: 'You will only be rostered if there is nobody else to cover it.',
    },
    PREFERENCE: {
        label: "I'd rather not",
        hint: 'Taken into account when there is a choice, but not a blocker.',
    },
};

const SEVERITY_BADGE: Record<ExceptionSeverity, string> = {
    HARD: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20',
    SOFT: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20',
    PREFERENCE: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/20',
};

function describe(exception: AvailabilityException): string {
    const when = exception.exceptionDate ?? 'Every day';
    return `${when} · ${exception.startTime}–${exception.endTime}`;
}

export interface ExceptionsPanelProps {
    profileId: string;
    /**
     * Which job this exception applies to. NULL means unscoped / person-wide.
     * Threaded from the availability page's scope picker; the write will
     * attach it to the exception row so the solver can narrow by job.
     */
    subDepartmentId?: string | null;
}

export const ExceptionsPanel: React.FC<ExceptionsPanelProps> = ({ profileId, subDepartmentId }) => {
    const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [saving, setSaving] = useState(false);

    const [date, setDate] = useState('');
    const [start, setStart] = useState('09:00');
    const [end, setEnd] = useState('17:00');
    const [severity, setSeverity] = useState<'SOFT' | 'PREFERENCE'>('SOFT');
    const [reason, setReason] = useState('');

    const refresh = useCallback(async () => {
        if (!profileId) return;
        setLoading(true);
        try {
            // Scoped to the job the page is showing. Without this the panel
            // listed EVERY exception the person holds, so someone Casual in
            // Set-up and Front of House saw their Front of House entries while
            // looking at Set-up, and deleting one from the wrong tab looked
            // like the panel had lost track of which job it was on.
            setExceptions(await listAvailabilityExceptions(profileId, subDepartmentId ?? null));
            setError(null);
        } catch (e) {
            // Surfaced, not swallowed: an empty list and a failed read look
            // identical to the employee otherwise, and one of them means their
            // declared exceptions are not being applied.
            setError(e instanceof Error ? e.message : 'Could not load your exceptions.');
        } finally {
            setLoading(false);
        }
        // `subDepartmentId` is load-bearing in this list, not just in the
        // dependency lint: it is what re-runs the read when the scope picker
        // switches jobs. Drop it and the panel keeps showing the job it was
        // first mounted on.
    }, [profileId, subDepartmentId]);

    useEffect(() => { void refresh(); }, [refresh]);

    const windowInvalid = useMemo(() => Boolean(start && end && end <= start), [start, end]);

    const handleAdd = async () => {
        if (windowInvalid) return;
        setSaving(true);
        setError(null);
        try {
            await createAvailabilityException(profileId, {
                exceptionDate: date || null,
                startTime: start,
                endTime: end,
                severity,
                reason: reason.trim() || undefined,
                subDepartmentId: subDepartmentId ?? null,
            });
            setAdding(false);
            setDate('');
            setReason('');
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save that exception.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        setError(null);
        try {
            await deleteAvailabilityException(id);
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not remove that exception.');
        }
    };

    return (
        <section className="rounded-2xl border border-border/40 bg-card/40 p-3 lg:p-4">
            <header className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <CalendarX2 className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-foreground">
                        When I can&apos;t work
                    </h2>
                </div>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAdding((v) => !v)}
                    className="h-8 gap-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider"
                >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                </Button>
            </header>

            {error && (
                <p role="alert" className="mb-3 rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-600 dark:text-red-400">
                    {error}
                </p>
            )}

            {adding && (
                <div className="mb-3 space-y-3 rounded-xl border border-border/40 bg-background/60 p-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                        <label className="block text-xs">
                            <span className="mb-1 block text-muted-foreground">Date</span>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full rounded-lg border border-border/50 bg-background px-2 py-1.5 text-sm"
                            />
                            {/* Blank is a real, useful answer here — it is how you
                                say "every Tuesday afternoon, indefinitely". */}
                            <span className="mt-1 block text-[10px] text-muted-foreground">
                                Leave blank for every day
                            </span>
                        </label>
                        <label className="block text-xs">
                            <span className="mb-1 block text-muted-foreground">From</span>
                            <input
                                type="time"
                                value={start}
                                onChange={(e) => setStart(e.target.value)}
                                className="w-full rounded-lg border border-border/50 bg-background px-2 py-1.5 text-sm"
                            />
                        </label>
                        <label className="block text-xs">
                            <span className="mb-1 block text-muted-foreground">To</span>
                            <input
                                type="time"
                                value={end}
                                onChange={(e) => setEnd(e.target.value)}
                                className="w-full rounded-lg border border-border/50 bg-background px-2 py-1.5 text-sm"
                            />
                        </label>
                    </div>

                    <fieldset className="space-y-1.5">
                        <legend className="mb-1 text-xs text-muted-foreground">How firm is this?</legend>
                        {(Object.keys(SEVERITY_COPY) as Array<'SOFT' | 'PREFERENCE'>).map((key) => (
                            <label key={key} className="flex cursor-pointer items-start gap-2 text-xs">
                                <input
                                    type="radio"
                                    name="exception-severity"
                                    checked={severity === key}
                                    onChange={() => setSeverity(key)}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span className="font-medium text-foreground">{SEVERITY_COPY[key].label}</span>
                                    <span className="block text-[10px] text-muted-foreground">
                                        {SEVERITY_COPY[key].hint}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </fieldset>

                    <label className="block text-xs">
                        <span className="mb-1 block text-muted-foreground">Reason (optional)</span>
                        <input
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Medical appointment, study, …"
                            className="w-full rounded-lg border border-border/50 bg-background px-2 py-1.5 text-sm"
                        />
                    </label>

                    {windowInvalid && (
                        <p className="text-xs text-red-500">
                            The end time has to be after the start time.
                        </p>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setAdding(false)} className="h-8 text-xs">
                            Cancel
                        </Button>
                        <Button size="sm" onClick={handleAdd} disabled={saving || windowInvalid} className="h-8 gap-1.5 text-xs">
                            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Save
                        </Button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
            ) : exceptions.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                    Nothing here. Add a window when there is a time you should not be rostered.
                </p>
            ) : (
                <ul className="space-y-1.5">
                    {exceptions.map((exception) => (
                        <li
                            key={exception.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/50 px-3 py-2"
                        >
                            <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-foreground">
                                    {describe(exception)}
                                </p>
                                {exception.reason && (
                                    <p className="truncate text-[10px] text-muted-foreground">{exception.reason}</p>
                                )}
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-2">
                                <span className={cn(
                                    'rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider',
                                    SEVERITY_BADGE[exception.severity],
                                )}>
                                    {exception.severity === 'HARD' ? 'Blocked' :
                                        exception.severity === 'SOFT' ? "Can't" : 'Rather not'}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(exception.id)}
                                    aria-label={`Remove exception ${describe(exception)}`}
                                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};
