/**
 * The baseline table — one line per working pattern, edited in place.
 *
 * NINE COLUMNS, FIVE OF THEM EDITABLE. Gross, paid break and net are
 * consequences of the other five and are rendered as figures rather than
 * fields. The paid rest pause is the one worth being firm about: cl 37.1/37.2
 * makes it a function of how long somebody works, so offering it as an input
 * would let a manager roster a nine-hour day with no rest pause and hear
 * nothing about it until the shape gate refused the shift days later.
 *
 * THE TENTH COLUMN IS THE POINT. Start and end are freely typed, because a
 * shift ends when the venue closes and a tool that refuses to express that is
 * useless. What stops 08:00–16:30 becoming a standing 40-hour week against a
 * 38-hour contract is the CYCLE column, updating as the time is typed:
 * `160 / 152 · 8h over`. That breach is what every full-time employee in this
 * database was carrying, and it is eight minutes a day away from lawful — far
 * too small to notice without the arithmetic on screen.
 *
 * ROLE IS READ-ONLY, and deliberately. The contract authorises the role;
 * `BFT_PATTERN_ROLE_MISMATCH` is BLOCKING for any other, so a picker here would
 * only offer ways to break the row. Changing someone's role is a contract
 * change, and the finding says exactly that.
 *
 * PHONES GET CARDS. Ten columns cannot become a table at 430px without
 * two-dimensional scrolling, which WCAG SC 1.4.10 forbids — so the composition
 * changes rather than shrinking, the same swap `/team-availability` makes for
 * its matrix.
 */

import React from 'react';
import { ChevronRight, Plus, Trash2, Wand2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/modules/core/ui/primitives/table';
import {
    DAY_LONG, DAY_SHORT, ISO_WEEK, deriveRow,
    type CycleVerdict, type PatternRow,
} from '../../domain/patternRow';
import type { IsoWeekday } from '../../domain/types';
import type { EmployeeLedger } from '../../api/baselineFt.commands';
import { EmployeeDetail, fmtHm, fmtHours } from './BaselineLedger';

/* ────────────────────────────────────────────────────────────────────────────
   View model
   ──────────────────────────────────────────────────────────────────────────── */

export interface EmployeePatternModel {
    employeeId: string;
    name: string;
    /** From the contract. Displayed, never chosen. */
    roleName: string;
    contractedWeeklyHours: number;
    cycleWeeks: number;
    rows: PatternRow[];
    verdict: CycleVerdict;
    /** The period reconciliation, once the world has loaded. */
    ledger: EmployeeLedger | null;
    hasUnsavedEdits: boolean;
}

export interface BaselinePatternTableProps {
    employees: readonly EmployeePatternModel[];
    onChangeRow: (rowId: string, patch: Partial<PatternRow>) => void;
    onAddRow: (employeeId: string) => void;
    onRemoveRow: (rowId: string) => void;
    /**
     * Spread the contracted week evenly across every day this employee has
     * selected, and set the finish times to match.
     *
     * Keyed on the EMPLOYEE, not one row: with two lines at different start
     * times, "make this line fit the contract" has no single answer, while
     * "make this person's week add up" has exactly one.
     */
    onFitToContract: (employeeId: string) => void;
    disabled?: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
   Formatting
   ──────────────────────────────────────────────────────────────────────────── */

/** Minutes as `7h 36`. Never decimalised: 7.6h and 7h 36m are easy to confuse. */
function fmtMinutes(minutes: number): string {
    const sign = minutes < 0 ? '−' : '';
    const abs = Math.abs(Math.round(minutes));
    return `${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, '0')}`;
}

const VERDICT_STYLE: Record<CycleVerdict['status'], string> = {
    balanced: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    over: 'bg-destructive/10 text-destructive border-destructive/30',
    short: 'bg-amber-500/10 text-amber-700 dark:text-amber-500 border-amber-500/30',
    empty: 'bg-muted text-muted-foreground border-border',
};

function verdictLabel(v: CycleVerdict): string {
    switch (v.status) {
        case 'empty':    return 'No days set';
        case 'balanced': return 'Exact';
        case 'over':     return `${fmtHm(v.deltaHours)} over`;
        case 'short':    return `${fmtHm(Math.abs(v.deltaHours))} short`;
    }
}

/* ────────────────────────────────────────────────────────────────────────────
   Cells
   ──────────────────────────────────────────────────────────────────────────── */

const DayToggles: React.FC<{
    days: readonly IsoWeekday[];
    onChange: (days: IsoWeekday[]) => void;
    disabled?: boolean;
}> = ({ days, onChange, disabled }) => (
    // Seven toggles rather than a multi-select, because the value of a column
    // is being able to read the whole team's shape down it. A collapsed
    // dropdown hides exactly the thing the table exists to show.
    <div className="flex gap-0.5" role="group" aria-label="Working days">
        {ISO_WEEK.map(d => {
            const on = days.includes(d);
            return (
                <button
                    key={d}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    aria-label={DAY_LONG[d]}
                    title={DAY_LONG[d]}
                    onClick={() => onChange(
                        on ? days.filter(x => x !== d) : [...days, d].sort((a, b) => a - b),
                    )}
                    className={cn(
                        'h-8 w-7 rounded text-[11px] font-bold transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'disabled:opacity-50',
                        on
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/70',
                    )}
                >
                    {DAY_SHORT[d].charAt(0)}
                </button>
            );
        })}
    </div>
);

const TimeInput: React.FC<{
    value: string;
    label: string;
    onChange: (v: string) => void;
    disabled?: boolean;
}> = ({ value, label, onChange, disabled }) => (
    <Input
        type="time"
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="h-9 w-[7.5rem] tabular-nums"
    />
);

const BreakSelect: React.FC<{
    value: number;
    onChange: (v: number) => void;
    disabled?: boolean;
}> = ({ value, onChange, disabled }) => (
    <Select
        value={String(value)}
        disabled={disabled}
        onValueChange={v => onChange(Number(v))}
    >
        <SelectTrigger className="h-9 w-[5.5rem]" aria-label="Unpaid meal break">
            <SelectValue />
        </SelectTrigger>
        <SelectContent>
            {/* cl 36.1 — a day over five hours needs 30–60 minutes unpaid. Zero
                stays available because a short day legitimately needs none. */}
            {[0, 30, 45, 60].map(m => (
                <SelectItem key={m} value={String(m)}>{m}m</SelectItem>
            ))}
        </SelectContent>
    </Select>
);

const Derived: React.FC<{ children: React.ReactNode; strong?: boolean }> = ({ children, strong }) => (
    <span className={cn(
        'tabular-nums font-mono text-xs',
        strong ? 'text-foreground font-semibold' : 'text-muted-foreground',
    )}>
        {children}
    </span>
);

const VerdictChip: React.FC<{ verdict: CycleVerdict; cycleWeeks: number }> = ({ verdict, cycleWeeks }) => (
    <div className="flex flex-col items-start gap-1">
        <span className="tabular-nums font-mono text-xs text-foreground">
            {fmtHours(verdict.cycleHours)} / {fmtHours(verdict.ceilingHours)}
        </span>
        <Badge variant="outline" className={cn(text.label, VERDICT_STYLE[verdict.status])}>
            {verdictLabel(verdict)}
        </Badge>
        <span className={text.subtle}>over {cycleWeeks} week{cycleWeeks === 1 ? '' : 's'}</span>
    </div>
);

/* ────────────────────────────────────────────────────────────────────────────
   Desktop
   ──────────────────────────────────────────────────────────────────────────── */

const HEADERS = [
    '', 'Employee', 'Role', 'Mon – Sun', 'Start', 'End',
    'Gross', 'Unpaid', 'Paid', 'Net', 'Cycle', '',
] as const;

const DesktopTable: React.FC<BaselinePatternTableProps & {
    expanded: string | null;
    setExpanded: (id: string | null) => void;
}> = ({
    employees, onChangeRow, onAddRow, onRemoveRow, onFitToContract,
    disabled, expanded, setExpanded,
}) => (
    <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <Table>
            <TableHeader>
                <TableRow>
                    {HEADERS.map((h, i) => (
                        <TableHead key={i} className={cn(i >= 6 && i <= 9 && 'text-right')}>
                            {h}
                        </TableHead>
                    ))}
                </TableRow>
            </TableHeader>

            {employees.map(emp => {
                const isOpen = expanded === emp.employeeId;

                return (
                    // One tbody per employee: the rows of a multi-line pattern
                    // belong together, and a browser will not split a tbody
                    // across a grouping boundary.
                    <TableBody key={emp.employeeId} className="border-b last:border-b-0">
                        {emp.rows.map((row, i) => {
                            const d = deriveRow(row);
                            const first = i === 0;

                            return (
                                <TableRow key={row.rowId} className="border-0">
                                    <TableCell className="w-8 pr-0 align-top">
                                        {first && (
                                            <button
                                                type="button"
                                                aria-expanded={isOpen}
                                                aria-label={`${isOpen ? 'Hide' : 'Show'} the reconciliation for ${emp.name}`}
                                                onClick={() => setExpanded(isOpen ? null : emp.employeeId)}
                                                className={cn(
                                                    touch.target,
                                                    'flex items-center justify-center rounded',
                                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                                )}
                                            >
                                                <ChevronRight
                                                    className={cn(
                                                        'h-4 w-4 text-muted-foreground transition-transform',
                                                        isOpen && 'rotate-90',
                                                    )}
                                                    aria-hidden="true"
                                                />
                                            </button>
                                        )}
                                    </TableCell>

                                    <TableCell className="align-top">
                                        {first && (
                                            <div className="flex items-center gap-1.5">
                                                <span className={text.body}>{emp.name}</span>
                                                {emp.hasUnsavedEdits && (
                                                    <span
                                                        aria-label="Unsaved changes"
                                                        title="Unsaved changes"
                                                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                                                    />
                                                )}
                                            </div>
                                        )}
                                    </TableCell>

                                    <TableCell className="align-top">
                                        {first && (
                                            <span className={text.bodyMuted}>{emp.roleName || '—'}</span>
                                        )}
                                    </TableCell>

                                    <TableCell className="align-top">
                                        <DayToggles
                                            days={row.days}
                                            disabled={disabled}
                                            onChange={days => onChangeRow(row.rowId, { days })}
                                        />
                                    </TableCell>

                                    <TableCell className="align-top">
                                        <TimeInput
                                            value={row.startTime} label={`Start time for ${emp.name}`}
                                            disabled={disabled}
                                            onChange={startTime => onChangeRow(row.rowId, { startTime })}
                                        />
                                    </TableCell>

                                    <TableCell className="align-top">
                                        <TimeInput
                                            value={row.endTime} label={`Finish time for ${emp.name}`}
                                            disabled={disabled}
                                            onChange={endTime => onChangeRow(row.rowId, { endTime })}
                                        />
                                    </TableCell>

                                    <TableCell className="text-right align-top">
                                        <Derived>{fmtMinutes(d.grossMinutes)}</Derived>
                                    </TableCell>

                                    <TableCell className="align-top">
                                        <BreakSelect
                                            value={row.unpaidBreakMinutes}
                                            disabled={disabled}
                                            onChange={unpaidBreakMinutes =>
                                                onChangeRow(row.rowId, { unpaidBreakMinutes })}
                                        />
                                    </TableCell>

                                    <TableCell className="text-right align-top">
                                        <Derived>{d.paidBreakMinutes}m</Derived>
                                    </TableCell>

                                    <TableCell className="text-right align-top">
                                        <Derived strong>{fmtMinutes(d.netMinutes)}</Derived>
                                    </TableCell>

                                    <TableCell className="align-top">
                                        {first && (
                                            <VerdictChip verdict={emp.verdict} cycleWeeks={emp.cycleWeeks} />
                                        )}
                                    </TableCell>

                                    <TableCell className="align-top">
                                        <div className="flex items-center gap-1">
                                            <Button
                                                type="button" variant="ghost" size="sm"
                                                disabled={disabled}
                                                onClick={() => onFitToContract(emp.employeeId)}
                                                title="Set the finish time so the pattern matches the contract exactly"
                                                className="h-8 px-2"
                                            >
                                                <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                                                <span className="sr-only">
                                                    Fit {emp.name}&rsquo;s hours to their contract
                                                </span>
                                            </Button>
                                            {emp.rows.length > 1 && (
                                                <Button
                                                    type="button" variant="ghost" size="sm"
                                                    disabled={disabled}
                                                    onClick={() => onRemoveRow(row.rowId)}
                                                    className="h-8 px-2 text-muted-foreground hover:text-destructive"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                                    <span className="sr-only">Remove this line</span>
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}

                        <TableRow className="border-0">
                            <TableCell />
                            <TableCell colSpan={HEADERS.length - 1} className="pt-0">
                                <Button
                                    type="button" variant="ghost" size="sm"
                                    disabled={disabled}
                                    onClick={() => onAddRow(emp.employeeId)}
                                    className={cn(text.caption, 'h-7 px-2 text-muted-foreground')}
                                >
                                    <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
                                    Add a different start time for {emp.name.split(' ')[0]}
                                </Button>
                            </TableCell>
                        </TableRow>

                        {isOpen && emp.ledger && (
                            <TableRow className="border-0">
                                <TableCell colSpan={HEADERS.length} className="p-0">
                                    <EmployeeDetail ledger={emp.ledger} />
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                );
            })}
        </Table>
    </div>
);

/* ────────────────────────────────────────────────────────────────────────────
   Phone
   ──────────────────────────────────────────────────────────────────────────── */

const PhoneCards: React.FC<BaselinePatternTableProps & {
    expanded: string | null;
    setExpanded: (id: string | null) => void;
}> = ({
    employees, onChangeRow, onAddRow, onRemoveRow, onFitToContract,
    disabled, expanded, setExpanded,
}) => (
    <ul className="space-y-2 md:hidden">
        {employees.map(emp => {
            const isOpen = expanded === emp.employeeId;

            return (
                <li key={emp.employeeId} className="overflow-hidden rounded-lg border bg-card">
                    <div className="flex items-start justify-between gap-2 px-3 pt-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className={cn(text.body, 'truncate')}>{emp.name}</span>
                                {emp.hasUnsavedEdits && (
                                    <span
                                        aria-label="Unsaved changes"
                                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                                    />
                                )}
                            </div>
                            <span className={text.subtle}>{emp.roleName || '—'}</span>
                        </div>
                        <Badge
                            variant="outline"
                            className={cn(text.label, 'shrink-0', VERDICT_STYLE[emp.verdict.status])}
                        >
                            {fmtHours(emp.verdict.cycleHours)} / {fmtHours(emp.verdict.ceilingHours)}
                        </Badge>
                    </div>

                    {emp.rows.map((row, i) => {
                        const d = deriveRow(row);
                        return (
                            <div
                                key={row.rowId}
                                className={cn('space-y-2.5 px-3 py-3', i > 0 && 'border-t border-dashed')}
                            >
                                <DayToggles
                                    days={row.days}
                                    disabled={disabled}
                                    onChange={days => onChangeRow(row.rowId, { days })}
                                />

                                <div className="flex flex-wrap items-end gap-2">
                                    <label className="space-y-1">
                                        <span className={text.subtle}>Start</span>
                                        <TimeInput
                                            value={row.startTime} label={`Start time for ${emp.name}`}
                                            disabled={disabled}
                                            onChange={startTime => onChangeRow(row.rowId, { startTime })}
                                        />
                                    </label>
                                    <label className="space-y-1">
                                        <span className={text.subtle}>End</span>
                                        <TimeInput
                                            value={row.endTime} label={`Finish time for ${emp.name}`}
                                            disabled={disabled}
                                            onChange={endTime => onChangeRow(row.rowId, { endTime })}
                                        />
                                    </label>
                                    <label className="space-y-1">
                                        <span className={text.subtle}>Unpaid</span>
                                        <BreakSelect
                                            value={row.unpaidBreakMinutes}
                                            disabled={disabled}
                                            onChange={unpaidBreakMinutes =>
                                                onChangeRow(row.rowId, { unpaidBreakMinutes })}
                                        />
                                    </label>
                                </div>

                                <dl className="grid grid-cols-3 gap-x-3 rounded-md bg-muted/40 px-2.5 py-2">
                                    {([
                                        ['Gross', fmtMinutes(d.grossMinutes)],
                                        ['Paid rest', `${d.paidBreakMinutes}m`],
                                        ['Net', fmtMinutes(d.netMinutes)],
                                    ] as const).map(([label, value]) => (
                                        <div key={label}>
                                            <dt className={text.subtle}>{label}</dt>
                                            <dd className={cn(text.metric, 'tabular-nums')}>{value}</dd>
                                        </div>
                                    ))}
                                </dl>

                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button" variant="outline" size="sm"
                                        disabled={disabled}
                                        onClick={() => onFitToContract(emp.employeeId)}
                                        className={cn(touch.targetY, 'flex-1')}
                                    >
                                        <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                                        Fit to contract
                                    </Button>
                                    {emp.rows.length > 1 && (
                                        <Button
                                            type="button" variant="ghost" size="sm"
                                            disabled={disabled}
                                            onClick={() => onRemoveRow(row.rowId)}
                                            className={cn(touch.targetY, 'text-muted-foreground')}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                            <span className="sr-only">Remove this line</span>
                                        </Button>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                        <Button
                            type="button" variant="ghost" size="sm"
                            disabled={disabled}
                            onClick={() => onAddRow(emp.employeeId)}
                            className={cn(text.caption, 'text-muted-foreground')}
                        >
                            <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
                            Add a line
                        </Button>

                        {emp.ledger && (
                            <button
                                type="button"
                                aria-expanded={isOpen}
                                onClick={() => setExpanded(isOpen ? null : emp.employeeId)}
                                className={cn(text.caption, touch.targetY, 'flex items-center gap-1 px-1')}
                            >
                                <ChevronRight
                                    className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')}
                                    aria-hidden="true"
                                />
                                {isOpen ? 'Hide' : 'Show'} the reconciliation
                            </button>
                        )}
                    </div>

                    {isOpen && emp.ledger && <EmployeeDetail ledger={emp.ledger} />}
                </li>
            );
        })}
    </ul>
);

/* ────────────────────────────────────────────────────────────────────────────
   Component
   ──────────────────────────────────────────────────────────────────────────── */

export const BaselinePatternTable: React.FC<BaselinePatternTableProps> = props => {
    const [expanded, setExpanded] = React.useState<string | null>(null);

    if (props.employees.length === 0) return null;

    return (
        <>
            <PhoneCards {...props} expanded={expanded} setExpanded={setExpanded} />
            <DesktopTable {...props} expanded={expanded} setExpanded={setExpanded} />
        </>
    );
};
