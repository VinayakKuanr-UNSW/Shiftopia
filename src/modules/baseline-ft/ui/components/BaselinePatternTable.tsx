/**
 * Baseline FT — Employee Scheduling Workspace.
 *
 * Minimalist, high-clarity Table Structure:
 *   - Column 1: Employee Name (sortable)
 *   - Column 2: Role (sortable)
 *   - Column 3: Day Selector (M T W T F S S)
 *   - Column 4: Start Time
 *   - Column 5: End Time
 *   - Column 6: Gross Length
 *   - Column 7: Paid Break (derived from EBA cl 37.1)
 *   - Column 8: Unpaid Break
 *   - Column 9: Paid Length
 *   - Column 10: Quick Actions & Row Expansion
 *
 * Expandable Row Disclosure:
 *   - 4-week cycle EBA target progress meter
 *   - Secondary variations (+ Add variation)
 *   - The calculation ledger & proposed draft shifts candidates
 *   - Recommendations & compliance diagnostics
 */

import React from 'react';
import {
    ArrowUpDown,
    ChevronRight,
    ClipboardPaste,
    Copy,
    Info,
    Plus,
    Trash2,
    Wand2,
} from 'lucide-react';

import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    Popover, PopoverContent, PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import {
    DAY_LONG, ISO_WEEK, deriveRow,
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
    roleName: string;
    contractedWeeklyHours: number;
    cycleWeeks: number;
    rows: PatternRow[];
    verdict: CycleVerdict;
    ledger: EmployeeLedger | null;
    hasUnsavedEdits: boolean;
}

export interface BaselinePatternTableProps {
    employees: readonly EmployeePatternModel[];
    onChangeRow: (rowId: string, patch: Partial<PatternRow>) => void;
    onAddRow: (employeeId: string) => void;
    onRemoveRow: (rowId: string) => void;
    onFitToContract: (employeeId: string) => void;
    /**
     * Copy one employee's shape onto another. REQUIRED, not optional.
     *
     * It was optional, with a fallback here that looped the source's rows and
     * wrote every one of them to the target's `rows[0]` — so a multi-variation
     * pattern silently collapsed to whichever variation happened to be last,
     * the target's own variations survived underneath as a hybrid, and the
     * "Pattern applied" toast fired either way. Only the page can add and
     * remove rows atomically, so only the page can do this correctly.
     */
    onCopyPattern: (sourceEmployeeId: string, targetEmployeeId: string) => void;
    disabled?: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
   Formatting Helpers
   ──────────────────────────────────────────────────────────────────────────── */

function fmtMinutes(minutes: number): string {
    const sign = minutes < 0 ? '−' : '';
    const abs = Math.abs(Math.round(minutes));
    return `${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, '0')}m`;
}

const DAY_LETTER: Record<IsoWeekday, string> = {
    1: 'M',
    2: 'T',
    3: 'W',
    4: 'T',
    5: 'F',
    6: 'S',
    7: 'S',
};

const VERDICT_STYLE: Record<CycleVerdict['status'], string> = {
    balanced: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    over: 'bg-destructive/10 text-destructive border-destructive/30',
    short: 'bg-amber-500/10 text-amber-700 dark:text-amber-500 border-amber-500/30',
    empty: 'bg-muted text-muted-foreground border-border/40',
};

const VERDICT_PROGRESS_COLOR: Record<CycleVerdict['status'], string> = {
    balanced: 'bg-emerald-500',
    over: 'bg-destructive',
    short: 'bg-amber-500',
    empty: 'bg-muted-foreground/30',
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
   Sub-components
   ──────────────────────────────────────────────────────────────────────────── */

const DayToggles: React.FC<{
    days: readonly IsoWeekday[];
    onChange: (days: IsoWeekday[]) => void;
    disabled?: boolean;
}> = ({ days, onChange, disabled }) => (
    <div className="inline-flex items-center gap-1" role="group" aria-label="Working days">
        {ISO_WEEK.map(d => {
            const on = days.includes(d);
            return (
                <button
                    key={d}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    aria-label={DAY_LONG[d]}
                    title={`${DAY_LONG[d]}: ${on ? 'Scheduled' : 'Off'}`}
                    onClick={() => onChange(
                        on ? days.filter(x => x !== d) : [...days, d].sort((a, b) => a - b),
                    )}
                    className={cn(
                        // 44px thumb target below md, released to the compact
                        // 32px box where the table renders for a pointer.
                        touch.target, 'md:min-h-0 md:min-w-0',
                        'w-9 h-9 md:w-8 md:h-8 rounded-md font-bold text-[11px] flex items-center justify-center transition-all cursor-pointer select-none',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
                        'disabled:opacity-50',
                        on
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'border border-slate-200 dark:border-border/60 bg-white dark:bg-card text-slate-400 dark:text-muted-foreground font-medium hover:bg-slate-50 dark:hover:bg-muted/40',
                    )}
                >
                    {DAY_LETTER[d]}
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
        className={cn(
            touch.targetY, 'md:min-h-0',
            'h-11 md:h-8 px-2 w-28 rounded-lg border border-slate-200 dark:border-border/60 bg-white dark:bg-card text-xs font-medium tabular-nums shadow-xs',
        )}
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
        <SelectTrigger
            className={cn(
                touch.targetY, 'md:min-h-0',
                'h-11 md:h-8 px-2.5 w-24 rounded-lg border border-slate-200 dark:border-border/60 bg-white dark:bg-card text-xs font-medium shadow-xs',
            )}
            aria-label="Unpaid meal break"
        >
            <SelectValue placeholder="30 min" />
        </SelectTrigger>
        <SelectContent className="shadow-md">
            {[0, 30, 45, 60].map(m => (
                <SelectItem key={m} value={String(m)} className="text-xs font-medium">
                    {m} min
                </SelectItem>
            ))}
        </SelectContent>
    </Select>
);

/* ────────────────────────────────────────────────────────────────────────────
   Main Table Component
   ──────────────────────────────────────────────────────────────────────────── */

interface CopiedPattern {
    employeeId: string;
    employeeName: string;
    rows: PatternRow[];
}

export const BaselinePatternTable: React.FC<BaselinePatternTableProps> = ({
    employees, onChangeRow, onAddRow, onRemoveRow, onFitToContract, onCopyPattern, disabled,
}) => {
    const { toast } = useToast();
    const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());
    const [copiedPattern, setCopiedPattern] = React.useState<CopiedPattern | null>(null);

    // Sort state
    const [sortField, setSortField] = React.useState<'name' | 'role'>('name');
    const [sortAsc, setSortAsc] = React.useState<boolean>(true);

    const toggleSort = (field: 'name' | 'role') => {
        if (sortField === field) {
            setSortAsc(!sortAsc);
        } else {
            setSortField(field);
            setSortAsc(true);
        }
    };

    const sortedEmployees = React.useMemo(() => {
        return [...employees].sort((a, b) => {
            const valA = sortField === 'name' ? a.name : a.roleName;
            const valB = sortField === 'name' ? b.name : b.roleName;
            const cmp = valA.localeCompare(valB);
            return sortAsc ? cmp : -cmp;
        });
    }, [employees, sortField, sortAsc]);

    const toggleExpand = (empId: string) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(empId)) next.delete(empId);
            else next.add(empId);
            return next;
        });
    };

    const handleCopy = (emp: EmployeePatternModel) => {
        setCopiedPattern({
            employeeId: emp.employeeId,
            employeeName: emp.name,
            rows: emp.rows,
        });
        toast({
            title: 'Pattern copied',
            description: `${emp.name}’s weekly pattern copied to clipboard.`,
        });
    };

    const handlePaste = (targetEmployeeId: string) => {
        if (!copiedPattern) return;
        const targetEmp = employees.find(e => e.employeeId === targetEmployeeId);
        if (!targetEmp) return;      // nothing happened, so say nothing

        onCopyPattern(copiedPattern.employeeId, targetEmployeeId);
        toast({
            title: 'Pattern applied',
            description:
                `${copiedPattern.employeeName}’s days and times copied to ${targetEmp.name}. ` +
                `Their own role and contract are unchanged.`,
        });
    };

    if (employees.length === 0) return null;

    /**
     * One employee, as a phone card.
     *
     * The desktop table's ten columns have a combined minimum width of 1250px —
     * nearly three times a 430px viewport — so rendering it on a phone means
     * scrolling in two dimensions at once, which WCAG SC 1.4.10 (Reflow)
     * forbids. `/baseline-ft` is on ALLOWED_MOBILE_ROUTES, and that entry is a
     * CLAIM that this page reflows; the claim needs a composition behind it.
     *
     * So the shape changes rather than shrinking: the same controls, stacked,
     * with the derived figures as a strip instead of four columns.
     */
    const renderCard = (emp: EmployeePatternModel) => {
        const isExpanded = expandedRows.has(emp.employeeId);
        const primaryRow = emp.rows[0];
        const totalWeeklyHours = emp.rows.reduce((n, r) => n + deriveRow(r).weeklyMinutes, 0) / 60;
        const targetPercentage = emp.verdict.ceilingHours > 0
            ? Math.min(100, Math.round((emp.verdict.cycleHours / emp.verdict.ceilingHours) * 100))
            : 0;
        const initials = emp.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

        return (
            <li
                key={emp.employeeId}
                className="rounded-2xl border border-slate-200 dark:border-border/60 bg-white dark:bg-card/40 shadow-xs overflow-hidden"
            >
                {/* Identity + verdict */}
                <div className="flex items-start gap-2.5 px-3.5 pt-3.5">
                    <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 dark:border-border/60 bg-slate-100 dark:bg-muted text-xs font-bold text-slate-700 dark:text-foreground"
                        aria-hidden="true"
                    >
                        {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-bold text-foreground">{emp.name}</span>
                            {emp.hasUnsavedEdits && (
                                <span
                                    aria-label="Unsaved changes"
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                                />
                            )}
                        </div>
                        <span className="block truncate text-[11px] text-muted-foreground">
                            {emp.roleName || 'No role on contract'} · {emp.contractedWeeklyHours}h contract
                        </span>
                    </div>
                    <Badge
                        variant="outline"
                        className={cn('shrink-0 text-[10px] font-semibold', VERDICT_STYLE[emp.verdict.status])}
                    >
                        {verdictLabel(emp.verdict)}
                    </Badge>
                </div>

                {/* Cycle progress — same verdict as the badge above it */}
                <div className="flex items-center gap-2 px-3.5 pt-2.5">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                        <div
                            className={cn('h-full transition-all', VERDICT_PROGRESS_COLOR[emp.verdict.status])}
                            style={{ width: `${targetPercentage}%` }}
                        />
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {fmtHours(emp.verdict.cycleHours)} / {fmtHours(emp.verdict.ceilingHours)}
                    </span>
                </div>

                {/* Every line, primary first */}
                {emp.rows.map((row, i) => {
                    const d = deriveRow(row);
                    return (
                        <div
                            key={row.rowId}
                            className={cn('space-y-2.5 px-3.5 py-3', i > 0 && 'border-t border-dashed border-slate-200 dark:border-border/50')}
                        >
                            {i > 0 && (
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-muted-foreground">
                                        Variation {i + 1}
                                    </span>
                                    <Button
                                        type="button" variant="ghost" size="sm"
                                        disabled={disabled}
                                        onClick={() => onRemoveRow(row.rowId)}
                                        className={cn(touch.target, 'h-9 px-2 text-muted-foreground hover:text-destructive')}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span className="sr-only">Remove variation {i + 1}</span>
                                    </Button>
                                </div>
                            )}

                            <DayToggles
                                days={row.days}
                                disabled={disabled}
                                onChange={days => onChangeRow(row.rowId, { days })}
                            />

                            <div className="flex flex-wrap items-end gap-2">
                                <label className="space-y-1">
                                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Start</span>
                                    <TimeInput
                                        value={row.startTime || ''}
                                        label={`Start time for ${emp.name}`}
                                        disabled={disabled}
                                        onChange={startTime => onChangeRow(row.rowId, { startTime })}
                                    />
                                </label>
                                <label className="space-y-1">
                                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">End</span>
                                    <TimeInput
                                        value={row.endTime || ''}
                                        label={`Finish time for ${emp.name}`}
                                        disabled={disabled}
                                        onChange={endTime => onChangeRow(row.rowId, { endTime })}
                                    />
                                </label>
                                <label className="space-y-1">
                                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Unpaid</span>
                                    <BreakSelect
                                        value={row.unpaidBreakMinutes}
                                        disabled={disabled}
                                        onChange={unpaidBreakMinutes =>
                                            onChangeRow(row.rowId, { unpaidBreakMinutes })}
                                    />
                                </label>
                            </div>

                            {/* Derived, never typed */}
                            <dl className="grid grid-cols-3 gap-x-3 rounded-lg bg-slate-50 dark:bg-muted/30 px-2.5 py-2">
                                {([
                                    ['Gross', fmtMinutes(d.grossMinutes)],
                                    ['Paid rest', d.paidBreakMinutes > 0 ? `+${d.paidBreakMinutes}m` : '—'],
                                    ['Paid length', fmtMinutes(d.netMinutes)],
                                ] as const).map(([label, value]) => (
                                    <div key={label}>
                                        <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
                                        <dd className="font-mono text-xs font-semibold tabular-nums text-foreground">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    );
                })}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-border/40 px-3.5 py-2.5">
                    <Button
                        type="button" variant="outline" size="sm"
                        disabled={disabled || !primaryRow}
                        onClick={() => onFitToContract(emp.employeeId)}
                        className={cn(touch.targetY, 'flex-1 text-xs')}
                    >
                        <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Fit to contract
                    </Button>
                    <Button
                        type="button" variant="outline" size="sm"
                        disabled={disabled}
                        onClick={() => onAddRow(emp.employeeId)}
                        className={cn(touch.targetY, 'text-xs border-dashed')}
                    >
                        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Variation
                    </Button>
                    <Button
                        type="button" variant="ghost" size="sm"
                        disabled={disabled}
                        onClick={() => handleCopy(emp)}
                        aria-label={`Copy ${emp.name}'s pattern`}
                        className={cn(touch.target, 'h-11 w-11 p-0 text-muted-foreground')}
                    >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    {copiedPattern && copiedPattern.employeeId !== emp.employeeId && (
                        <Button
                            type="button" variant="ghost" size="sm"
                            disabled={disabled}
                            onClick={() => handlePaste(emp.employeeId)}
                            aria-label={`Paste ${copiedPattern.employeeName}'s pattern onto ${emp.name}`}
                            className={cn(touch.target, 'h-11 w-11 p-0 text-blue-600')}
                        >
                            <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
                        </Button>
                    )}
                </div>

                {emp.ledger && (
                    <>
                        <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpand(emp.employeeId)}
                            className={cn(
                                touch.targetY,
                                'flex w-full items-center gap-1.5 border-t border-slate-100 dark:border-border/40 px-3.5 py-2 text-xs text-muted-foreground',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            )}
                        >
                            <ChevronRight
                                className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
                                aria-hidden="true"
                            />
                            {isExpanded ? 'Hide' : 'Show'} the reconciliation
                        </button>
                        {isExpanded && <EmployeeDetail ledger={emp.ledger} />}
                    </>
                )}
            </li>
        );
    };

    return (
        <>
        {/* ── Phone: one card per employee ────────────────────────────────── */}
        <ul
            className="space-y-3 md:hidden"
            role="region"
            aria-label="Employee Scheduling Workspace"
        >
            {sortedEmployees.map(renderCard)}
        </ul>

        {/* ── Tablet and up: the workspace table ──────────────────────────── */}
        <div
            className="hidden md:block w-full rounded-2xl border border-slate-200 dark:border-border/60 bg-white dark:bg-card/40 overflow-hidden shadow-xs"
            role="region"
            aria-label="Employee Scheduling Workspace"
        >
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                    {/* ── Table Header ────────────────────────────────────────── */}
                    <thead>
                        <tr className="border-b border-slate-200 dark:border-border/50 bg-slate-50/80 dark:bg-muted/30 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">
                            {/* Column 1: Employee Name */}
                            <th scope="col" className="py-3 px-4 min-w-[180px]">
                                <button
                                    type="button"
                                    onClick={() => toggleSort('name')}
                                    className="inline-flex items-center gap-1.5 hover:text-foreground font-semibold cursor-pointer uppercase tracking-wider"
                                >
                                    Employee Name
                                    <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden="true" />
                                </button>
                            </th>

                            {/* Column 2: Role */}
                            <th scope="col" className="py-3 px-3 min-w-[130px]">
                                <button
                                    type="button"
                                    onClick={() => toggleSort('role')}
                                    className="inline-flex items-center gap-1.5 hover:text-foreground font-semibold cursor-pointer uppercase tracking-wider"
                                >
                                    Role
                                    <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden="true" />
                                </button>
                            </th>

                            {/* Column 3: Day Selector */}
                            <th scope="col" className="py-3 px-3 min-w-[220px]">
                                Working Days
                            </th>

                            {/* Column 4: Start Time */}
                            <th scope="col" className="py-3 px-2 min-w-[120px]">
                                Start Time
                            </th>

                            {/* Column 5: End Time */}
                            <th scope="col" className="py-3 px-2 min-w-[120px]">
                                End Time
                            </th>

                            {/* Column 6: Gross Length */}
                            <th scope="col" className="py-3 px-2 text-center min-w-[85px]">
                                Gross
                            </th>

                            {/* Column 7: Paid Break */}
                            <th scope="col" className="py-3 px-2 text-center min-w-[85px]">
                                Paid Rest
                            </th>

                            {/* Column 8: Unpaid Break */}
                            <th scope="col" className="py-3 px-2 min-w-[110px]">
                                Unpaid Break
                            </th>

                            {/* Column 9: Paid Length / Total */}
                            <th scope="col" className="py-3 px-3 text-right min-w-[110px]">
                                Paid Length
                            </th>

                            {/* Column 10: Actions & Expand */}
                            <th scope="col" className="py-3 px-3 text-right min-w-[90px]">
                                Actions
                            </th>
                        </tr>
                    </thead>

                    {/* ── Table Body ──────────────────────────────────────────── */}
                    <tbody className="divide-y divide-slate-100 dark:divide-border/40">
                        {sortedEmployees.map(emp => {
                            const isExpanded = expandedRows.has(emp.employeeId);
                            const primaryRow = emp.rows[0];
                            const d = primaryRow ? deriveRow(primaryRow) : null;
                            const totalWeeklyPaidMinutes = emp.rows.reduce((sum, r) => sum + deriveRow(r).weeklyMinutes, 0);
                            const totalWeeklyPaidHours = totalWeeklyPaidMinutes / 60;

                            const hasIssues = emp.verdict.status === 'over' || (emp.ledger && emp.ledger.findings.some(f => f.severity === 'BLOCKING'));
                            const targetPercentage = emp.verdict.ceilingHours > 0
                                ? Math.min(100, Math.round((emp.verdict.cycleHours / emp.verdict.ceilingHours) * 100))
                                : 0;

                            const initials = emp.name
                                .split(' ')
                                .map(n => n[0])
                                .join('')
                                .slice(0, 2)
                                .toUpperCase();

                            return (
                                <React.Fragment key={emp.employeeId}>
                                    <tr
                                        className={cn(
                                            'transition-colors hover:bg-slate-50/60 dark:hover:bg-muted/20',
                                            isExpanded && 'bg-slate-50/40 dark:bg-muted/10',
                                            hasIssues && 'border-l-4 border-l-orange-500',
                                        )}
                                    >
                                        {/* Column 1: Employee Name */}
                                        <td className="py-3 px-4 font-medium text-foreground">
                                            <div className="flex items-center gap-2.5">
                                                <div
                                                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground font-bold text-xs select-none border border-slate-200 dark:border-border/60 shrink-0"
                                                    aria-hidden="true"
                                                >
                                                    {initials}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-bold text-foreground text-xs truncate">
                                                            {emp.name}
                                                        </span>
                                                        {hasIssues && (
                                                            <span className="inline-flex rounded bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 text-[9px] font-bold px-1.5 py-0.5 uppercase">
                                                                ⚠ Review
                                                            </span>
                                                        )}
                                                        {emp.hasUnsavedEdits && (
                                                            <span className="inline-flex rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 text-[9px] font-semibold px-1 py-0.5">
                                                                ●
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-[11px] text-muted-foreground block truncate">
                                                        {emp.contractedWeeklyHours}h Contract
                                                    </span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Column 2: Role */}
                                        <td className="py-3 px-3 text-muted-foreground text-xs font-medium">
                                            {emp.roleName || (
                                                // NOT "Full-time" — that is an employment type,
                                                // not a role, and this column drives the pay rate
                                                // and BFT_PATTERN_ROLE_MISMATCH. A missing role is
                                                // a contract gap and has to read as one.
                                                <span className="italic text-amber-600 dark:text-amber-400">
                                                    No role on contract
                                                </span>
                                            )}
                                        </td>

                                        {/* Column 3: Day Selector */}
                                        <td className="py-3 px-3">
                                            {primaryRow && (
                                                <DayToggles
                                                    days={primaryRow.days}
                                                    disabled={disabled}
                                                    onChange={days => onChangeRow(primaryRow.rowId, { days })}
                                                />
                                            )}
                                        </td>

                                        {/* Column 4: Start Time */}
                                        <td className="py-3 px-2">
                                            {primaryRow && (
                                                <TimeInput
                                                    value={primaryRow.startTime || ''}
                                                    label={`Start time for ${emp.name}`}
                                                    disabled={disabled}
                                                    onChange={startTime => onChangeRow(primaryRow.rowId, { startTime })}
                                                />
                                            )}
                                        </td>

                                        {/* Column 5: End Time */}
                                        <td className="py-3 px-2">
                                            {primaryRow && (
                                                <TimeInput
                                                    value={primaryRow.endTime || ''}
                                                    label={`Finish time for ${emp.name}`}
                                                    disabled={disabled}
                                                    onChange={endTime => onChangeRow(primaryRow.rowId, { endTime })}
                                                />
                                            )}
                                        </td>

                                        {/* Column 6: Gross Length */}
                                        <td className="py-3 px-2 text-center font-mono text-muted-foreground tabular-nums">
                                            {d ? fmtMinutes(d.grossMinutes) : '—'}
                                        </td>

                                        {/* Column 7: Paid Rest Break */}
                                        <td className="py-3 px-2 text-center font-mono text-muted-foreground tabular-nums">
                                            {d && d.paidBreakMinutes > 0 ? (
                                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                                    +{d.paidBreakMinutes}m
                                                </span>
                                            ) : (
                                                '—'
                                            )}
                                        </td>

                                        {/* Column 8: Unpaid Break */}
                                        <td className="py-3 px-2">
                                            {primaryRow && (
                                                <BreakSelect
                                                    value={primaryRow.unpaidBreakMinutes}
                                                    disabled={disabled}
                                                    onChange={unpaidBreakMinutes =>
                                                        onChangeRow(primaryRow.rowId, { unpaidBreakMinutes })}
                                                />
                                            )}
                                        </td>

                                        {/* Column 9: Paid Length */}
                                        <td className="py-3 px-3 text-right tabular-nums">
                                            <div className="font-bold text-foreground text-xs">
                                                {d ? fmtMinutes(d.netMinutes) : '0h'} / shift
                                            </div>
                                            <span className="text-[10px] text-muted-foreground">
                                                {fmtHours(totalWeeklyPaidHours)} wk
                                            </span>
                                        </td>

                                        {/* Column 10: Actions & Expand */}
                                        <td className="py-3 px-3 text-right">
                                            <div className="inline-flex items-center justify-end gap-1">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={disabled}
                                                    onClick={() => onFitToContract(emp.employeeId)}
                                                    title="Fit finish time to match contract exactly"
                                                    className={cn(touch.target, "md:min-h-0 md:min-w-0", "h-9 w-9 md:h-7 md:w-7 p-0 text-muted-foreground hover:text-foreground")}
                                                >
                                                    <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                                                    <span className="sr-only">Fit to contract</span>
                                                </Button>

                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={disabled}
                                                    onClick={() => handleCopy(emp)}
                                                    title="Copy pattern"
                                                    className={cn(touch.target, "md:min-h-0 md:min-w-0", "h-9 w-9 md:h-7 md:w-7 p-0 text-muted-foreground hover:text-foreground")}
                                                >
                                                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                                    <span className="sr-only">Copy pattern</span>
                                                </Button>

                                                {copiedPattern && copiedPattern.employeeId !== emp.employeeId && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={disabled}
                                                        onClick={() => handlePaste(emp.employeeId)}
                                                        title={`Paste pattern from ${copiedPattern.employeeName}`}
                                                        className={cn(touch.target, "md:min-h-0 md:min-w-0", "h-9 w-9 md:h-7 md:w-7 p-0 text-blue-600 hover:text-blue-700")}
                                                    >
                                                        <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
                                                        <span className="sr-only">Paste pattern</span>
                                                    </Button>
                                                )}

                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    aria-expanded={isExpanded}
                                                    aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${emp.name}`}
                                                    onClick={() => toggleExpand(emp.employeeId)}
                                                    className={cn(touch.target, "md:min-h-0 md:min-w-0", "h-9 w-9 md:h-7 md:w-7 p-0 text-muted-foreground hover:text-foreground")}
                                                >
                                                    <ChevronRight
                                                        className={cn('h-4 w-4 transition-transform duration-200', isExpanded && 'rotate-90')}
                                                        aria-hidden="true"
                                                    />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>

                                    {/* ── Expandable Details Row ──────────────────────────── */}
                                    {isExpanded && (
                                        <tr className="bg-slate-100/80 dark:bg-[#0b0e17] border-y-2 border-slate-300 dark:border-white/15">
                                            <td colSpan={10} className="p-5 sm:p-6 space-y-5">
                                                {/* Card 1: EBA cycle target & inline add variation.
                                                    The cycle length is DECLARED per contract
                                                    (`ordinary_hours_cycle_weeks`, 1-4), so it is read
                                                    from the employee rather than written as 4. Every
                                                    contract in production declares 4 today, which is
                                                    exactly what would keep a hardcoded 4 invisible. */}
                                                <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161c2b] shadow-xs">
                                                    <div className="flex flex-wrap items-center gap-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden="true" />
                                                            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                                                EBA {emp.cycleWeeks}-Week Cycle Target
                                                            </h4>
                                                        </div>
                                                        <span className="font-mono text-xs font-bold text-foreground tabular-nums ml-1">
                                                            {fmtHours(emp.verdict.cycleHours)} / {fmtHours(emp.verdict.ceilingHours)}
                                                        </span>
                                                        <Badge
                                                            variant="outline"
                                                            className={cn('text-[10px] font-semibold py-0 shadow-none', VERDICT_STYLE[emp.verdict.status])}
                                                        >
                                                            {verdictLabel(emp.verdict)}
                                                        </Badge>
                                                        <Popover>
                                                            <PopoverTrigger asChild>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer ml-1"
                                                                >
                                                                    <Info className="h-3 w-3" aria-hidden="true" />
                                                                    Why {emp.cycleWeeks} weeks?
                                                                </button>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-80 text-xs leading-relaxed space-y-2 p-4 shadow-none">
                                                                <p className="font-semibold text-foreground">ICC Sydney EBA cl 35.1</p>
                                                                <p className="text-muted-foreground">
                                                                    cl 35.1(a) caps full-time ordinary hours over the cycle the contract
                                                                    declares — {emp.cycleWeeks} week{emp.cycleWeeks === 1 ? '' : 's'} here,
                                                                    so {fmtHours(emp.contractedWeeklyHours * emp.cycleWeeks)} in total.
                                                                </p>
                                                                <p className="text-muted-foreground">
                                                                    cl 35.1(c) protects employees: a full-time working day cannot be shorter than 7.6 hours. If leftover cycle hours are below 7.6h, they are left unscheduled as an honest variance.
                                                                </p>
                                                            </PopoverContent>
                                                        </Popover>
                                                    </div>

                                                    <div className="flex items-center gap-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-36 h-2 rounded-full overflow-hidden bg-slate-200 dark:bg-white/10">
                                                                {/* Driven by the SAME verdict as the badge beside it.
                                                                    The previous ternary only knew about `over`, so a
                                                                    pattern 8h SHORT of its cycle drew a green bar at
                                                                    94% next to an amber "8h short" badge. */}
                                                                <div
                                                                    className={cn(
                                                                        'h-full transition-all duration-300',
                                                                        VERDICT_PROGRESS_COLOR[emp.verdict.status],
                                                                    )}
                                                                    style={{ width: `${targetPercentage}%` }}
                                                                />
                                                            </div>
                                                            <span className="font-mono text-xs text-muted-foreground font-semibold tabular-nums">
                                                                {targetPercentage}%
                                                            </span>
                                                        </div>

                                                        {emp.rows.length <= 1 && (
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                disabled={disabled}
                                                                onClick={() => onAddRow(emp.employeeId)}
                                                                className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground border-dashed"
                                                            >
                                                                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                                                Add variation
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Card 2: Secondary Schedule Variations (only shown if multi-row) */}
                                                {emp.rows.length > 1 && (
                                                    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161c2b] p-5 shadow-xs space-y-3">
                                                        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-white/5">
                                                            <div className="flex items-center gap-2">
                                                                <span className="h-2 w-2 rounded-full bg-purple-500" aria-hidden="true" />
                                                                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                                                    Schedule Variations ({emp.rows.length})
                                                                </h4>
                                                            </div>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                disabled={disabled}
                                                                onClick={() => onAddRow(emp.employeeId)}
                                                                className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground border-dashed"
                                                            >
                                                                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                                                Add variation
                                                            </Button>
                                                        </div>

                                                        <div className="space-y-2.5 pt-1">
                                                            {emp.rows.slice(1).map((row, idx) => {
                                                                const rowDeriv = deriveRow(row);
                                                                return (
                                                                    <div
                                                                        key={row.rowId}
                                                                        className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200/80 dark:border-white/5 bg-slate-50 dark:bg-[#1f283d]"
                                                                    >
                                                                        <div className="flex items-center gap-3">
                                                                            <span className="text-xs font-bold text-muted-foreground">
                                                                                Var {idx + 2}:
                                                                            </span>
                                                                            <DayToggles
                                                                                days={row.days}
                                                                                disabled={disabled}
                                                                                onChange={days => onChangeRow(row.rowId, { days })}
                                                                            />
                                                                            <TimeInput
                                                                                value={row.startTime || ''}
                                                                                label={`Variation ${idx + 2} start for ${emp.name}`}
                                                                                disabled={disabled}
                                                                                onChange={startTime => onChangeRow(row.rowId, { startTime })}
                                                                            />
                                                                            <span className="text-slate-400 text-xs">→</span>
                                                                            <TimeInput
                                                                                value={row.endTime || ''}
                                                                                label={`Variation ${idx + 2} finish for ${emp.name}`}
                                                                                disabled={disabled}
                                                                                onChange={endTime => onChangeRow(row.rowId, { endTime })}
                                                                            />
                                                                            <BreakSelect
                                                                                value={row.unpaidBreakMinutes}
                                                                                disabled={disabled}
                                                                                onChange={unpaidBreakMinutes =>
                                                                                    onChangeRow(row.rowId, { unpaidBreakMinutes })}
                                                                            />
                                                                        </div>

                                                                        <div className="flex items-center gap-3">
                                                                            <span className="font-mono text-xs text-foreground font-semibold tabular-nums">
                                                                                {fmtMinutes(rowDeriv.netMinutes)} / shift ({fmtHours(rowDeriv.weeklyMinutes / 60)} wk)
                                                                            </span>
                                                                            <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                disabled={disabled}
                                                                                onClick={() => onRemoveRow(row.rowId)}
                                                                                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                                                                            >
                                                                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                                                            </Button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Card 3: Deep Reconciliation Ledger & Shifts */}
                                                {emp.ledger && (
                                                    <EmployeeDetail ledger={emp.ledger} />
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
        </>
    );
};
