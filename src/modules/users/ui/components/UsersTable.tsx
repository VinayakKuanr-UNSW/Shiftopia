/**
 * The Users page body (2026-10-17): one table, a row per contract, inside the
 * page's global scope and narrowed by the page's search.
 *
 * Each row is one line. It shows the person, where the contract is
 * (organization, department, sub-department), the role, the employment type
 * (EBA cl 12.1), the remuneration basis, the access the position gives
 * (contracts carry access) and its status, which follows its dates: Upcoming
 * before the start, Active, Expired after the end date. The dates are edited in
 * place with the shared date picker. Every column sorts; the Columns menu in the
 * function bar hides any but Name.
 *
 * Each row's ⋯ menu edits the contract, adds another for the person, or revokes
 * it: the contract ends today (its access with it), or, when it hasn't started,
 * is deleted. No dollar figures: money lives in Gross Pay only. Without the
 * Admin suite the table is read-only.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Ban, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreHorizontal, Pencil, Plus, X } from 'lucide-react';
import { supabase } from '@/platform/supabase/client';
import { assertWrote } from '@/platform/supabase/writes';
import { ACCESS_LEVEL_CONFIG, accessLevelLabel } from '@/platform/auth/constants';
import type { AccessLevel } from '@/platform/auth/types';
import { Button } from '@/modules/core/ui/primitives/button';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { cn } from '@/modules/core/lib/utils';
import { todayISO } from '@/modules/core/lib/date.utils';
import { DatePicker } from '@/modules/core/ui/calendar/DatePicker';
import { text, touch } from '@/modules/core/ui/typography';
import { getSwsTrialStatus } from '../../domain/swsTrial';
import {
    accessOf,
    contractStatus,
    employmentText,
    remunerationText,
    type ContractRow,
    type ContractStatus,
} from '../../domain/contractRows';
import {
    DEFAULT_SORT,
    licencesSummary,
    rowsOf,
    skillsSummary,
    sortRows,
    workRightsSummary,
    type PersonGroup,
    type PersonRef,
    type Summary,
    type UsersColumnId,
    type UsersRow,
    type UsersSort,
} from '../../domain/usersTable';
import { USERS_COLUMNS, isColumnShown, type ColumnVisibility } from '../usersTableColumns';
import { UserEditDialog, type UserEditTab } from './UserEditDialog';
import {
    DESIGN_CARD,
    PageMenu,
    PageMenuContent,
    PageMenuItem,
    PageMenuLabel,
    PageMenuRadioGroup,
    PageMenuRadioItem,
    PageMenuSeparator,
    PageMenuTrigger,
} from './PageMenu';

export interface UsersTableProps {
    /** In scope and matching the search. */
    groups: readonly PersonGroup[];
    /** In scope before the search: "Showing 2 of 9 people". Defaults to `groups`. */
    totals?: { people: number; contracts: number };
    /** The page's search, for the counts and the no-match message. */
    search?: string;
    onClearSearch?: () => void;
    /** The viewer's column choice (Columns menu). */
    columns?: ColumnVisibility;
    isLoading: boolean;
    isError: boolean;
    onRetry: () => void;
    /** All of a person's contracts (the wizard's checks weigh every one, in scope or not). */
    contractsOf: (personId: string) => ContractRow[];
    /** Reload after a change. */
    refresh: () => void;
    /** The Admin suite: adds, edits, revokes, and changes dates in place. */
    canManage: boolean;
}

// ── Cells ────────────────────────────────────────────────────────────────────

const dateText = (iso: string | null | undefined) => (iso ? format(parseISO(iso), 'd MMM yyyy') : '—');
const isoOf = (d: Date) => format(d, 'yyyy-MM-dd');
const roleOf = (c: ContractRow) => c.roles?.name ?? 'contract';

/** An empty cell: a dash to the eye, "None" to a screen reader. */
const Empty = () => (
    <>
        <span aria-hidden="true" className="text-muted-foreground">—</span>
        <span className="sr-only">None</span>
    </>
);

const STATUS_LOOK: Record<ContractStatus, { label: string; textClass: string }> = {
    upcoming: { label: 'Upcoming', textClass: 'text-sky-600 dark:text-sky-400' },
    active: { label: 'Active', textClass: 'text-emerald-600 dark:text-emerald-400' },
    expired: { label: 'Expired', textClass: 'text-muted-foreground' },
};

const statusText = (c: ContractRow) => {
    const look = STATUS_LOOK[contractStatus(c)];
    return (
        <span className={cn('text-sm font-medium whitespace-nowrap', look.textClass)}>
            {look.label}
        </span>
    );
};

/** The access a row gives, on one line; struck through (and said) once the contract has ended. */
const accessCell = (c: ContractRow) => {
    const level = accessOf(c);
    if (!level) return <span className="text-sm text-muted-foreground whitespace-nowrap">Not set</span>;
    if (contractStatus(c) === 'expired') {
        return (
            <span className="text-sm text-muted-foreground line-through decoration-muted-foreground/60 whitespace-nowrap">
                {accessLevelLabel(level)}
                <span className="sr-only"> (ended)</span>
            </span>
        );
    }
    return (
        <span className="text-sm font-medium text-foreground whitespace-nowrap" title={ACCESS_LEVEL_CONFIG[level].description}>
            {accessLevelLabel(level)}
        </span>
    );
};

const roleCell = (c: ContractRow) => (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {c.roles?.name ?? 'Unknown role'}
        {c.engagement_kind === 'multi_hire' && (
            <span className="text-xs text-muted-foreground font-normal" title={c.multi_hire_request_ref ? `Request to Multi-Hire: ${c.multi_hire_request_ref}` : undefined}>
                (Multi-hire · cl 13)
            </span>
        )}
    </span>
);

/** A supported wage trial run past 12 weeks (Sch 6): the one employment cue worth a look. */
const swsWarning = (c: ContractRow): string | null => {
    const sws = getSwsTrialStatus({
        isSws: (c as any).is_sws,
        isSwsTrial: (c as any).is_sws_trial,
        swsTrialStartDate: (c as any).sws_trial_start_date,
    } as never);
    return sws.overrun ? `Supported wage trial past 12 weeks (${sws.weeksElapsed} weeks, Sch 6)` : null;
};

/**
 * Something in a cell worth a look (expired or expiring, missing, unverified).
 * Off the line: an icon that opens the words, and says them to a screen reader
 * without being opened. A component, defined once here, so it keeps its state.
 */
const WarningPopover: React.FC<{
    /** "Licences", "Work rights" … */
    topic: string;
    person: string;
    message: string;
    /** Open the place to fix it, e.g. the person's Licences tab. */
    action?: { label: string; run: (returnTo: HTMLElement | null) => void };
}> = ({ topic, person, message, action }) => {
    const [open, setOpen] = useState(false);
    const titleId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const acting = useRef(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    ref={triggerRef}
                    type="button"
                    aria-label={`${topic} warning for ${person}: ${message}`}
                    className={cn(
                        touch.target,
                        'md:h-7 md:w-7 md:min-h-7 md:min-w-7 inline-flex shrink-0 items-center justify-center rounded-lg',
                        'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    )}
                >
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                aria-labelledby={titleId}
                align="start"
                sideOffset={8}
                collisionPadding={16}
                className={cn(DESIGN_CARD, 'w-72 p-0 text-foreground')}
                // Opening the edit panel from here: let it take focus.
                onCloseAutoFocus={(e) => { if (acting.current) { e.preventDefault(); acting.current = false; } }}
            >
                <div className="p-4 space-y-1.5">
                    <p id={titleId} className="flex items-center gap-2 text-sm font-semibold">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                        {topic} · {person}
                    </p>
                    <p className="text-sm text-muted-foreground">{message}</p>
                    {action && (
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn(touch.targetY, 'md:min-h-9 mt-2 rounded-lg')}
                            onClick={() => { acting.current = true; setOpen(false); action.run(triggerRef.current); }}
                        >
                            {action.label}
                        </Button>
                    )}
                </div>
                <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 text-[9px] font-black uppercase tracking-[0.2em] text-primary/50 dark:text-muted-foreground/50" aria-hidden="true">
                    <span className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">esc</kbd> Close
                    </span>
                </div>
            </PopoverContent>
        </Popover>
    );
};

/** The Name column stays in view while the table scrolls sideways… */
const STICKY_NAME = 'sticky left-0 bg-card shadow-[1px_0_0_hsl(var(--border))]';
/** …and so do the actions. */
const STICKY_ACTIONS = 'sticky right-0 bg-card shadow-[-1px_0_0_hsl(var(--border))]';

const SORT_WORDS: Record<UsersSort['direction'], string> = { ascending: 'ascending', descending: 'descending' };

export const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

// ── The table ────────────────────────────────────────────────────────────────

export const UsersTable: React.FC<UsersTableProps> = ({
    groups, totals, search = '', onClearSearch, columns = {}, isLoading, isError, onRetry, contractsOf, refresh, canManage,
}) => {
    const { toast } = useToast();
    const today = todayISO();
    const titleId = useId();
    const contractCount = groups.reduce((n, g) => n + g.contracts.length, 0);
    const searching = search.trim().length > 0;

    const shownColumns = USERS_COLUMNS.filter((c) => isColumnShown(columns, c.id));
    const columnLabel = (id: UsersColumnId) => USERS_COLUMNS.find((c) => c.id === id)?.label ?? id;

    // ── Sorting ──────────────────────────────────────────────────────────────
    const [sort, setSort] = useState<UsersSort>(DEFAULT_SORT);
    /** Said once, after the viewer sorts: the headers' aria-sort carries it from then on. */
    const [sortNews, setSortNews] = useState('');
    const applySort = (next: UsersSort) => {
        setSort(next);
        setSortNews(`Sorted by ${columnLabel(next.column)}, ${SORT_WORDS[next.direction]}.`);
    };
    const toggleSort = (column: UsersColumnId) => applySort({
        column,
        direction: sort.column === column && sort.direction === 'ascending' ? 'descending' : 'ascending',
    });
    // A hidden column can't stay the sort: fall back to Name.
    const effectiveSort = isColumnShown(columns, sort.column) ? sort : DEFAULT_SORT;
    const rows = useMemo(() => sortRows(rowsOf(groups), effectiveSort, today), [groups, effectiveSort, today]);

    // ── Pagination ───────────────────────────────────────────────────────────
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<number>(15);

    useEffect(() => {
        setPage(1);
    }, [search, effectiveSort.column, effectiveSort.direction, groups.length]);

    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);

    const paginatedRows = useMemo(() => {
        const start = (safePage - 1) * pageSize;
        return rows.slice(start, start + pageSize);
    }, [rows, safePage, pageSize]);

    // ── Focus: back to the row's ⋯ button when a dialog it opened closes ─────
    const triggers = useRef(new Map<string, HTMLButtonElement>());
    const regionRef = useRef<HTMLDivElement>(null);
    /** What opened the dialog now open: focus goes back there when it closes. */
    const returnTo = useRef<(() => HTMLElement | null) | null>(null);
    /** A dialog is opening from the menu: the closing menu mustn't pull focus back to its button. */
    const dialogOpening = useRef(false);
    const restoreFocus = (e: Event) => {
        e.preventDefault();
        const el = returnTo.current?.() ?? null;
        if (el?.isConnected) el.focus();
        else regionRef.current?.focus();
    };
    const fromMenu = (triggerKey: string, open: () => void) => () => {
        returnTo.current = () => triggers.current.get(triggerKey) ?? null;
        dialogOpening.current = true;
        open();
    };
    /** A warning's "Open licences" etc.: the panel on that tab, focus back on the warning after. */
    const fixFrom = (person: PersonRef, contract: ContractRow | null, tab: UserEditTab) => (el: HTMLElement | null) => {
        returnTo.current = () => el;
        setEditing({ person, contract, tab });
    };

    // ── Edit / add ───────────────────────────────────────────────────────────
    const [editing, setEditing] = useState<{ person: PersonRef; contract: ContractRow | null; tab: UserEditTab } | null>(null);
    const openEdit = (person: PersonRef, contract: ContractRow | null, tab: UserEditTab = 'contract') =>
        setEditing({ person, contract, tab });

    // ── Dates, in place ──────────────────────────────────────────────────────
    const [savingDate, setSavingDate] = useState<string | null>(null);
    const saveDate = async (person: PersonRef, c: ContractRow, field: 'start_date' | 'end_date', value: string | null) => {
        setSavingDate(`${c.id}:${field}`);
        const result = await (supabase as any).schema('hr').from('user_contracts')
            .update({ [field]: value }, { count: 'exact' })
            .eq('id', c.id);
        setSavingDate(null);
        refresh();
        try {
            // e.g. a shift rostered outside the new dates, or the only Administrator's end date
            if (result.error) throw result.error;
            assertWrote(result, 'change this contract');
        } catch (e) {
            toast({
                variant: 'destructive',
                title: field === 'start_date' ? 'Start date not changed' : 'End date not changed',
                description: (e as { message?: string })?.message ?? String(e),
            });
            return;
        }
        toast({
            title: field === 'start_date' ? `Start date: ${dateText(value)}`
                : value ? `End date: ${dateText(value)}` : 'No end date: ongoing',
            description: `${person.name} — ${roleOf(c)}`,
        });
    };

    // A render function, not a component: defined in here, a component would be a
    // new type each render and remount the picker (closing it mid-pick).
    const dateCell = (person: PersonRef, c: ContractRow, field: 'start_date' | 'end_date') => {
        const value = c[field] ?? null;
        if (!canManage) {
            return field === 'end_date' && !value
                ? <span className="text-muted-foreground">Ongoing</span>
                : <span className="whitespace-nowrap tabular-nums">{dateText(value)}</span>;
        }
        const busy = savingDate === `${c.id}:${field}`;
        const what = `${person.name}'s ${roleOf(c)}`;
        return (
            <span className="inline-flex items-center gap-0.5">
                {/* The shared picker, as every other date in the app: outline trigger, Monday-start month. */}
                <DatePicker
                    value={value ? parseISO(value) : undefined}
                    onChange={(d) => { if (isoOf(d) !== value) void saveDate(person, c, field, isoOf(d)); }}
                    label={`${field === 'start_date' ? 'Start date' : 'End date'} of ${what}`}
                    placeholder="Ongoing"
                    disabled={busy}
                    // End not before Start, and Start not after End
                    fromDate={field === 'end_date' && c.start_date ? parseISO(c.start_date) : undefined}
                    toDate={field === 'start_date' && c.end_date ? parseISO(c.end_date) : undefined}
                    triggerClassName={cn(touch.targetY, 'md:min-h-9 md:h-9 rounded-lg px-2.5 tabular-nums whitespace-nowrap')}
                />
                {field === 'end_date' && value && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(touch.target, 'md:h-9 md:w-9 md:min-h-9 md:min-w-9 shrink-0 text-muted-foreground')}
                        onClick={() => void saveDate(person, c, 'end_date', null)}
                        disabled={busy}
                        aria-label={`Clear the end date of ${what} (ongoing)`}
                        title="No end date (ongoing)"
                    >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                )}
            </span>
        );
    };

    // ── Revoke: end today, or delete one that hasn't started ─────────────────
    const [revoking, setRevoking] = useState<{ person: PersonRef; c: ContractRow } | null>(null);
    const [isRevoking, setIsRevoking] = useState(false);
    /** Ending today does something only while the last day is still to come. */
    const canRevoke = (c: ContractRow) => contractStatus(c) !== 'expired' && !(c.end_date && c.end_date <= today);
    const confirmRevoke = async () => {
        if (!revoking) return;
        const { person, c } = revoking;
        const notStarted = contractStatus(c) === 'upcoming';
        setIsRevoking(true);
        const contracts = (supabase as any).schema('hr').from('user_contracts');
        const result = notStarted
            ? await contracts.delete({ count: 'exact' }).eq('id', c.id)
            : await contracts.update({ end_date: today }, { count: 'exact' }).eq('id', c.id);
        setIsRevoking(false);
        refresh();
        try {
            // e.g. shifts rostered under it after today, or the only Administrator
            if (result.error) throw result.error;
            assertWrote(result, 'revoke this contract');
        } catch (e) {
            const message = (e as { message?: string })?.message ?? String(e);
            toast({
                variant: 'destructive',
                title: 'Contract not revoked',
                description: /toil_ledger/.test(message)
                    ? 'Time off in lieu is recorded against this contract, so it can’t be deleted.'
                    : message,
            });
            return;
        }
        toast({
            title: 'Contract revoked',
            description: notStarted
                ? `${person.name} — ${roleOf(c)}: deleted, as it hadn't started`
                : `${person.name} — ${roleOf(c)}: ends today, ${dateText(today)}`,
        });
        setRevoking(null);
    };

    /** `surface`: the table and the phone cards each have their own ⋯ button for a row. */
    const actionsMenu = (row: UsersRow, surface: 'table' | 'card') => {
        if (!canManage) return null;
        const { group: g, contract: c } = row;
        const triggerKey = `${surface}:${row.key}`;
        const what = c ? `${g.person.name}, ${roleOf(c)}` : g.person.name;
        const item = 'min-h-11 md:min-h-9 gap-2';
        return (
            <PageMenu modal={false}>
                <PageMenuTrigger asChild>
                    <Button
                        ref={(el) => { if (el) triggers.current.set(triggerKey, el); else triggers.current.delete(triggerKey); }}
                        variant="ghost"
                        size="icon"
                        className={cn(touch.target, 'md:h-9 md:w-9 md:min-h-9 md:min-w-9 rounded-lg text-muted-foreground hover:text-foreground')}
                        aria-label={`Actions for ${what}`}
                    >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                </PageMenuTrigger>
                <PageMenuContent
                    align="end"
                    heading={c ? roleOf(c) : g.person.name}
                    onCloseAutoFocus={(e) => { if (dialogOpening.current) { e.preventDefault(); dialogOpening.current = false; } }}
                >
                    <PageMenuItem icon={<Pencil />} onSelect={fromMenu(triggerKey, () => openEdit(g.person, c, c ? 'contract' : 'skills'))}>
                        Edit
                    </PageMenuItem>
                    <PageMenuItem icon={<Plus />} onSelect={fromMenu(triggerKey, () => openEdit(g.person, null))}>
                        Add contract
                    </PageMenuItem>
                    {c && canRevoke(c) && (
                        <>
                            <PageMenuSeparator />
                            <PageMenuItem danger icon={<Ban />} onSelect={fromMenu(triggerKey, () => setRevoking({ person: g.person, c }))}>
                                Revoke
                            </PageMenuItem>
                        </>
                    )}
                </PageMenuContent>
            </PageMenu>
        );
    };

    /** A person's summary, with an icon for anything worth a look (the words in its popover). */
    const summaryCell = (person: PersonRef, topic: string, s: Summary, tab: UserEditTab) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {s.text === '—' ? <Empty /> : s.text}
            {s.warning && (
                <WarningPopover
                    topic={topic}
                    person={person.name}
                    message={s.warning}
                    action={canManage ? { label: `Open ${topic.toLowerCase()}`, run: fixFrom(person, null, tab) } : undefined}
                />
            )}
        </span>
    );

    /** One cell's content; the same words the export uses. */
    const cell = (row: UsersRow, column: UsersColumnId): React.ReactNode => {
        const { group: g, contract: c } = row;
        switch (column) {
            case 'name': return g.person.name;
            case 'email': return g.person.email ?? <Empty />;
            case 'skills': return summaryCell(g.person, 'Skills', skillsSummary(g.skills, today), 'skills');
            case 'licences': return summaryCell(g.person, 'Licences', licencesSummary(g.licences, today), 'licences');
            case 'workRights': return summaryCell(g.person, 'Work rights', workRightsSummary(g.workRights, today), 'work-rights');
            default: break;
        }
        if (!c) return column === 'role' ? <span className="italic text-muted-foreground">No contract yet</span> : <Empty />;
        switch (column) {
            case 'organization': return c.organizations?.name ?? <Empty />;
            case 'department': return c.departments?.name ?? <Empty />;
            case 'subDepartment': return c.sub_departments?.name ?? <Empty />;
            case 'role': return roleCell(c);
            case 'employment': {
                const warning = swsWarning(c);
                return (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        {employmentText(c)}
                        {warning && (
                            <WarningPopover
                                topic="Employment"
                                person={g.person.name}
                                message={warning}
                                action={canManage ? { label: 'Open the contract', run: fixFrom(g.person, c, 'contract') } : undefined}
                            />
                        )}
                    </span>
                );
            }
            case 'remuneration': return remunerationText(c);
            case 'access': return accessCell(c);
            case 'status': return statusText(c);
            case 'startDate': return dateCell(g.person, c, 'start_date');
            case 'endDate': return dateCell(g.person, c, 'end_date');
            default: return null;
        }
    };

    const sortIcon = (column: UsersColumnId) => {
        if (effectiveSort.column !== column) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />;
        return effectiveSort.direction === 'ascending'
            ? <ArrowUp className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            : <ArrowDown className="h-3.5 w-3.5 text-primary" aria-hidden="true" />;
    };

    // ── Render ───────────────────────────────────────────────────────────────
    const counts = isLoading || isError ? '' : searching
        ? `Showing ${groups.length} of ${totals?.people ?? groups.length} ${(totals?.people ?? groups.length) === 1 ? 'person' : 'people'} · ${contractCount} of ${totals?.contracts ?? contractCount} contracts`
        : `${groups.length} ${groups.length === 1 ? 'person' : 'people'} · ${contractCount} contract${contractCount === 1 ? '' : 's'}`;

    let body: React.ReactNode;
    if (isLoading) {
        body = (
            <div className="divide-y divide-border" aria-busy="true" aria-label="Loading users">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-4">
                        <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                        <div className="h-4 w-24 rounded bg-muted animate-pulse hidden md:block" />
                        <div className="h-4 w-28 rounded bg-muted animate-pulse hidden md:block" />
                        <div className="ml-auto h-6 w-20 rounded bg-muted animate-pulse" />
                    </div>
                ))}
            </div>
        );
    } else if (isError) {
        body = (
            <div className="px-5 py-12 text-center" role="alert">
                <p className={text.body}>Couldn&apos;t load users.</p>
                <p className={text.caption}>Check your connection and try again.</p>
                <Button variant="outline" size="sm" className={cn(touch.targetY, 'mt-3 rounded-lg')} onClick={onRetry}>
                    Try again
                </Button>
            </div>
        );
    } else if (groups.length === 0 && searching) {
        body = (
            <div className="px-5 py-12 text-center">
                <p className={text.body}>No one matches &ldquo;{search.trim()}&rdquo;</p>
                <p className={cn(text.caption, 'mx-auto max-w-sm')}>Search by name, email, role, place, employment, access or status.</p>
                {onClearSearch && (
                    <Button variant="outline" size="sm" className={cn(touch.targetY, 'mt-3 rounded-lg')} onClick={onClearSearch}>
                        Clear search
                    </Button>
                )}
            </div>
        );
    } else if (groups.length === 0) {
        body = (
            <div className="px-5 py-12 text-center">
                <p className={text.body}>Nobody here yet</p>
                <p className={cn(text.caption, 'mx-auto max-w-sm')}>
                    No one holds a contract in this scope. Choose another scope above, or add a user.
                </p>
            </div>
        );
    } else {
        body = (
            <>
                {/* Desktop: the table. Focusable so the keyboard can scroll it sideways. */}
                <div
                    ref={regionRef}
                    role="region"
                    aria-labelledby={titleId}
                    tabIndex={0}
                    className="hidden md:block flex-1 min-h-0 min-w-0 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                    <table className="w-full text-sm">
                        <caption className="sr-only">
                            Users and their contracts, one row per contract. Column headers are buttons that sort the table.
                        </caption>
                        <thead className="sticky top-0 z-20 bg-card">
                            <tr className="border-b border-border text-left">
                                {shownColumns.map((col) => (
                                    <th
                                        key={col.id}
                                        scope="col"
                                        aria-sort={effectiveSort.column === col.id ? effectiveSort.direction : undefined}
                                        className={cn('px-1.5 py-1.5 font-normal whitespace-nowrap', col.id === 'name' && cn(STICKY_NAME, 'z-30 pl-3'))}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => toggleSort(col.id)}
                                            className={cn(
                                                'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-semibold whitespace-nowrap',
                                                effectiveSort.column === col.id ? 'text-foreground' : 'text-muted-foreground',
                                                'hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                            )}
                                        >
                                            {col.label}
                                            {sortIcon(col.id)}
                                        </button>
                                    </th>
                                ))}
                                {canManage && (
                                    <th scope="col" className={cn('px-3 py-1.5 w-0', STICKY_ACTIONS, 'z-30')}>
                                        <span className="sr-only">Actions</span>
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRows.map((row) => {
                                const expired = !!row.contract && contractStatus(row.contract) === 'expired';
                                return (
                                    <tr key={row.key} className={cn('border-b border-border hover:bg-muted/30', expired && 'text-muted-foreground')}>
                                        {shownColumns.map((col) => (col.id === 'name' ? (
                                            <th key={col.id} scope="row" className={cn('py-1.5 pl-5 pr-3 text-left font-medium text-foreground whitespace-nowrap', STICKY_NAME, 'z-10')}>
                                                {row.group.person.name}
                                            </th>
                                        ) : (
                                            <td
                                                key={col.id}
                                                className={cn(
                                                    'whitespace-nowrap',
                                                    canManage && (col.id === 'startDate' || col.id === 'endDate') ? 'px-1 py-1' : 'px-3.5 py-1.5',
                                                )}
                                            >
                                                {cell(row, col.id)}
                                            </td>
                                        )))}
                                        {canManage && <td className={cn('px-3 py-1 text-right', STICKY_ACTIONS, 'z-10')}>{actionsMenu(row, 'table')}</td>}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Phone: a card per row, sorted the same way */}
                <div className="md:hidden shrink-0 flex items-center gap-2 border-b border-border px-4 py-2">
                    <PageMenu modal={false}>
                        <PageMenuTrigger asChild>
                            <Button variant="outline" size="sm" className={cn(touch.targetY, 'gap-1.5 rounded-lg')}>
                                Sort: {columnLabel(effectiveSort.column)}
                                {effectiveSort.direction === 'ascending'
                                    ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                                    : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />}
                                <span className="sr-only">, {SORT_WORDS[effectiveSort.direction]}</span>
                                <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                            </Button>
                        </PageMenuTrigger>
                        <PageMenuContent align="start" heading="Sort by">
                            <PageMenuRadioGroup
                                value={effectiveSort.column}
                                onValueChange={(v) => applySort({ column: v as UsersColumnId, direction: effectiveSort.direction })}
                            >
                                {shownColumns.map((col) => (
                                    <PageMenuRadioItem key={col.id} value={col.id} checked={effectiveSort.column === col.id}>{col.label}</PageMenuRadioItem>
                                ))}
                            </PageMenuRadioGroup>
                            <PageMenuSeparator />
                            <PageMenuLabel>Order</PageMenuLabel>
                            <PageMenuRadioGroup
                                value={effectiveSort.direction}
                                onValueChange={(v) => applySort({ ...effectiveSort, direction: v as UsersSort['direction'] })}
                            >
                                <PageMenuRadioItem value="ascending" checked={effectiveSort.direction === 'ascending'}>Ascending</PageMenuRadioItem>
                                <PageMenuRadioItem value="descending" checked={effectiveSort.direction === 'descending'}>Descending</PageMenuRadioItem>
                            </PageMenuRadioGroup>
                        </PageMenuContent>
                    </PageMenu>
                </div>
                <ul className="md:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-border" aria-label="Users and their contracts">
                    {paginatedRows.map((row) => {
                        const { group: g, contract: c } = row;
                        return (
                            <li key={row.key} className="px-4 py-3 space-y-1.5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-medium text-foreground">{g.person.name}</p>
                                        <p className={text.caption}>{c ? roleOf(c) : 'No contract yet'}</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {c && statusText(c)}
                                        {actionsMenu(row, 'card')}
                                    </div>
                                </div>
                                {c && (
                                    <>
                                        <p className={text.caption}>
                                            {[c.organizations?.name, c.departments?.name, c.sub_departments?.name].filter(Boolean).join(' › ') || '—'}
                                        </p>
                                        <p className={text.body}>{employmentText(c)} · {remunerationText(c)}</p>
                                        <div>{accessCell(c)}</div>
                                        <div className="flex flex-wrap items-center gap-x-2 text-sm">
                                            <span className="text-muted-foreground">From</span>{dateCell(g.person, c, 'start_date')}
                                            <span className="text-muted-foreground">to</span>{dateCell(g.person, c, 'end_date')}
                                        </div>
                                    </>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </>
        );
    }

    return (
        <div className="h-full w-full min-w-0 flex flex-col rounded-2xl border border-border bg-card overflow-hidden">
            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
                <h2 id={titleId} className={text.title}>Users</h2>
                {/* Polite: the counts change as the viewer types a search. */}
                <p role="status" className={text.caption}>{counts}</p>
            </div>
            <p role="status" className="sr-only">{sortNews}</p>
            {body}

            {/* Pagination Controls */}
            {totalRows > 0 && (
                <div
                    role="navigation"
                    aria-label="Pagination"
                    className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 sm:px-5 bg-card/60 backdrop-blur-sm"
                >
                    <p className="text-xs text-muted-foreground font-medium" role="status" aria-live="polite">
                        Showing {(safePage - 1) * pageSize + 1}–{Math.min(totalRows, safePage * pageSize)} of {totalRows} {totalRows === 1 ? 'contract' : 'contracts'}
                    </p>

                    <div className="flex items-center gap-3 sm:gap-4 ml-auto">
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="font-medium text-[11px] uppercase tracking-wider hidden sm:inline">Rows</span>
                            <select
                                aria-label="Rows per page"
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(Number(e.target.value));
                                    setPage(1);
                                }}
                                className={cn(
                                    'h-8 rounded-lg px-2 text-xs font-semibold tabular-nums border border-border bg-background text-foreground transition-colors',
                                    'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                                )}
                            >
                                {PAGE_SIZE_OPTIONS.map((size) => (
                                    <option key={size} value={size}>
                                        {size}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="First page"
                                disabled={safePage <= 1}
                                onClick={() => setPage(1)}
                                className="h-8 w-8 rounded-lg"
                            >
                                <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Previous page"
                                disabled={safePage <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                className="h-8 w-8 rounded-lg"
                            >
                                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                            </Button>

                            <span className="px-1.5 text-xs font-semibold tabular-nums text-foreground min-w-[64px] text-center" aria-current="page">
                                {safePage} / {totalPages}
                            </span>

                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Next page"
                                disabled={safePage >= totalPages}
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                className="h-8 w-8 rounded-lg"
                            >
                                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Last page"
                                disabled={safePage >= totalPages}
                                onClick={() => setPage(totalPages)}
                                className="h-8 w-8 rounded-lg"
                            >
                                <ChevronsRight className="h-4 w-4" aria-hidden="true" />
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <UserEditDialog
                open={!!editing}
                onOpenChange={(open) => { if (!open) setEditing(null); }}
                person={editing?.person ?? null}
                contract={editing?.contract ?? null}
                personContracts={editing ? contractsOf(editing.person.id) : []}
                initialTab={editing?.tab}
                onChanged={refresh}
                onCloseAutoFocus={restoreFocus}
            />

            <AlertDialog open={!!revoking} onOpenChange={(open) => { if (!open && !isRevoking) setRevoking(null); }}>
                <AlertDialogContent onCloseAutoFocus={restoreFocus}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Revoke this contract?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {revoking && revokeWords(revoking.person, revoking.c, today)}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isRevoking}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); void confirmRevoke(); }}
                            disabled={isRevoking}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isRevoking ? 'Revoking…' : 'Revoke contract'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

/** What revoking does to this contract, in words. */
function revokeWords(person: PersonRef, c: ContractRow, today: string): string {
    const level = accessOf(c);
    if (contractStatus(c) === 'upcoming') {
        return `${person.name}'s ${roleOf(c)} hasn't started (it starts ${dateText(c.start_date)}), so revoking deletes it`
            + `${level ? `, with the ${accessLevelLabel(level)} access it would give` : ''}. A contract with shifts rostered under it can't be deleted.`;
    }
    return `${person.name}'s ${roleOf(c)} ends today (${dateText(today)}).`
        + `${level ? ` Its ${accessLevelLabel(level)} access ends with it.` : ''}`
        + ' From tomorrow it shows as Expired. Shifts rostered under it after today must be reassigned or unassigned first.';
}

export default UsersTable;
