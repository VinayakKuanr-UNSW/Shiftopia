/**
 * BreaksEditor — scheduled unpaid breaks table + paid rest-pause stepper.
 *
 * Unpaid breaks: an ordered table `SNo. | Start | End | Duration`, one row per
 * break, so a long shift can carry several dispersed breaks. Times step in
 * 15-minute increments and resolve across midnight (23:45–00:15 = 30m). The
 * first row is mirrored into `break_start` / `break_end` so legacy readers
 * (cost engine, V8 single-window fallback) keep working.
 *
 * Paid rest pauses (cl 37): minutes only, 15-minute increments. They need no
 * punches and do not shorten the shift — net = gross − unpaid breaks.
 *
 * Render layer only: legality is decided by `evaluateShiftShape` upstream.
 */

import { useCallback } from 'react';
import type { useForm } from 'react-hook-form';
import { Coffee, Minus, Plus, Trash2, Utensils } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { tableTokens } from '@/modules/core/ui/primitives/table';
import { breakSpanMinutes } from '@/modules/compliance/shape';
import type { FormValues } from '../types';

type BreakRow = NonNullable<FormValues['unpaid_breaks']>[number];

export const PAID_PAUSE_PRESETS = [0, 15, 30, 45, 60] as const;

/** Snap a minute count to the nearest lower multiple of 15, never negative. */
export function snapTo15(mins: number): number {
    if (!Number.isFinite(mins) || mins <= 0) return 0;
    return Math.floor(mins / 15) * 15;
}

/** `HH:mm` + minutes, wrapping past midnight. */
function addMinutes(t: string, mins: number): string {
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return '';
    const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

interface BreaksEditorProps {
    form: ReturnType<typeof useForm<FormValues>>;
    isReadOnly: boolean;
    /** Security (EBA Sch 3): the meal break is PAID — rows still required, nothing deducted. */
    isSecurity?: boolean;
    /** Compact styling for the mobile sheet. */
    compact?: boolean;
}

export function BreaksEditor({ form, isReadOnly, isSecurity = false, compact = false }: BreaksEditorProps) {
    const rows = (form.watch('unpaid_breaks') ?? []) as BreakRow[];
    const startTime = form.watch('start_time');
    const paid = form.watch('paid_break_minutes') ?? 0;

    const commit = useCallback((next: BreakRow[]) => {
        const numbered = next.map((r, i) => ({
            sno: i + 1,
            start: r.start,
            end: r.end,
            duration: breakSpanMinutes(r.start, r.end) ?? 0,
        }));
        form.setValue('unpaid_breaks', numbered, { shouldDirty: true });
        form.setValue('break_start', numbered[0]?.start || null, { shouldDirty: true });
        form.setValue('break_end', numbered[0]?.end || null, { shouldDirty: true });
    }, [form]);

    const addRow = () => {
        // Seed after the previous break (or 4h into the shift) with a 30m span.
        const anchor = rows.length > 0 && rows[rows.length - 1].end
            ? addMinutes(rows[rows.length - 1].end, 240)
            : startTime ? addMinutes(startTime, 240) : '';
        commit([...rows, { start: anchor, end: anchor ? addMinutes(anchor, 30) : '' }]);
    };

    const updateRow = (idx: number, key: 'start' | 'end', value: string) => {
        commit(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
    };

    const removeRow = (idx: number) => commit(rows.filter((_, i) => i !== idx));

    const total = rows.reduce((acc, r) => acc + (breakSpanMinutes(r.start, r.end) ?? 0), 0);
    const setPaid = (v: number) => form.setValue('paid_break_minutes', Math.max(0, snapTo15(v)), { shouldDirty: true });

    const cell = compact ? 'px-1.5 py-1.5' : 'px-2 py-2';
    const timeInput = cn(
        'w-full rounded-lg border border-border/50 bg-background font-mono font-semibold tracking-wider',
        'focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60',
        compact ? 'h-10 px-2 text-[13px]' : 'h-11 px-2.5 text-[14px]',
    );

    return (
        <div className="space-y-4">
            {/* ── Unpaid breaks table ─────────────────────────────────────── */}
            <div className="rounded-xl border border-border/50 bg-muted/20">
                <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        <Coffee className="h-3.5 w-3.5" aria-hidden="true" />
                        {isSecurity ? 'Meal Breaks (Paid — Sch 3)' : 'Unpaid Breaks'}
                    </div>
                    <span className="font-mono text-[11px] font-bold text-foreground" data-testid="unpaid-break-total">
                        Total {total}m{isSecurity && total > 0 ? ' · paid' : ''}
                    </span>
                </div>

                <table className={cn(tableTokens.table, "w-full text-left")} aria-label="Scheduled unpaid breaks">
                    <thead>
                        <tr className={cn(tableTokens.row, "text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80")}>
                            <th className={cn(tableTokens.head, cell, 'w-12')} scope="col">SNo.</th>
                            <th className={cn(tableTokens.head, cell)} scope="col">Start</th>
                            <th className={cn(tableTokens.head, cell)} scope="col">End</th>
                            <th className={cn(tableTokens.head, cell, 'w-20')} scope="col">Duration</th>
                            <th className={cn(tableTokens.head, cell, 'w-10')} scope="col"><span className="sr-only">Remove</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr className={tableTokens.row}>
                                <td colSpan={5} className={cn(tableTokens.cell, "px-3 py-3 text-[12px] text-muted-foreground")}>
                                    No breaks scheduled. Shifts over 5h need at least one 30–60m meal break (cl 36.1).
                                </td>
                            </tr>
                        )}
                        {rows.map((r, idx) => {
                            const dur = breakSpanMinutes(r.start, r.end);
                            const badIncrement = dur !== null && dur % 15 !== 0;
                            return (
                                <tr key={idx} className={cn(tableTokens.row, "border-t border-border/30")}>
                                    <td className={cn(tableTokens.cell, cell, 'font-mono text-[12px] font-bold text-muted-foreground')}>{idx + 1}</td>
                                    <td className={cn(tableTokens.cell, cell)}>
                                        <input
                                            type="time"
                                            step={900}
                                            aria-label={`Break ${idx + 1} start`}
                                            value={r.start ?? ''}
                                            disabled={isReadOnly}
                                            onChange={(e) => updateRow(idx, 'start', e.target.value)}
                                            className={timeInput}
                                        />
                                    </td>
                                    <td className={cn(tableTokens.cell, cell)}>
                                        <input
                                            type="time"
                                            step={900}
                                            aria-label={`Break ${idx + 1} end`}
                                            value={r.end ?? ''}
                                            disabled={isReadOnly}
                                            onChange={(e) => updateRow(idx, 'end', e.target.value)}
                                            className={timeInput}
                                        />
                                    </td>
                                    <td className={cn(tableTokens.cell, cell)}>
                                        <span
                                            className={cn(
                                                'inline-flex rounded-md px-2 py-1 font-mono text-[12px] font-bold',
                                                badIncrement
                                                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                                    : 'bg-primary/10 text-foreground',
                                            )}
                                            data-testid={`break-${idx + 1}-duration`}
                                        >
                                            {dur === null ? '—' : `${dur}m`}
                                        </span>
                                    </td>
                                    <td className={cn(tableTokens.cell, cell)}>
                                        {!isReadOnly && (
                                            <button
                                                type="button"
                                                onClick={() => removeRow(idx)}
                                                aria-label={`Remove break ${idx + 1}`}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>

                {!isReadOnly && (
                    <div className="border-t border-border/40 px-3 py-2">
                        <button
                            type="button"
                            onClick={addRow}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-bold text-primary hover:bg-primary/10"
                        >
                            <Plus className="h-3.5 w-3.5" /> Add Unpaid Break
                        </button>
                    </div>
                )}
            </div>

            {/* ── Paid rest pauses ─────────────────────────────────────────── */}
            <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <Utensils className="h-3.5 w-3.5" aria-hidden="true" />
                    Paid Rest Pauses
                    <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
                        — 15m steps, no punches, does not shorten the shift
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        aria-label="Decrease paid rest pause by 15 minutes"
                        disabled={isReadOnly || paid <= 0}
                        onClick={() => setPaid(paid - 15)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 disabled:opacity-40"
                    >
                        <Minus className="h-4 w-4" />
                    </button>
                    <span
                        className="min-w-[56px] text-center font-mono text-[14px] font-black"
                        data-testid="paid-pause-value"
                        aria-live="polite"
                    >
                        {paid}m
                    </span>
                    <button
                        type="button"
                        aria-label="Increase paid rest pause by 15 minutes"
                        disabled={isReadOnly}
                        onClick={() => setPaid(paid + 15)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 disabled:opacity-40"
                    >
                        <Plus className="h-4 w-4" />
                    </button>
                    <div className="ml-1 flex flex-wrap gap-1.5">
                        {PAID_PAUSE_PRESETS.map((p) => (
                            <button
                                key={p}
                                type="button"
                                disabled={isReadOnly}
                                onClick={() => setPaid(p)}
                                aria-pressed={paid === p}
                                className={cn(
                                    'h-8 rounded-lg px-2.5 text-[12px] font-bold ring-1',
                                    paid === p
                                        ? 'bg-primary text-primary-foreground ring-primary'
                                        : 'bg-background text-foreground ring-border/50 hover:bg-muted',
                                )}
                            >
                                {p}m
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
