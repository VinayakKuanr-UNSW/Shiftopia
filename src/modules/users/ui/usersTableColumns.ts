/**
 * The Users table's columns, and which ones this viewer has chosen to show
 * (2026-10-17). Name is always shown — it says whose row it is — and so are the
 * row's actions; every other column can be hidden from the Columns menu. The
 * choice is remembered in this browser only: a convenience, not a setting.
 */
import { useCallback, useState } from 'react';
import type { UsersColumnId } from '../domain/usersTable';

interface UsersColumn {
    id: UsersColumnId;
    label: string;
    /** Shown until the viewer hides it. */
    defaultShown: boolean;
}

export const USERS_COLUMNS: readonly UsersColumn[] = [
    { id: 'name', label: 'Name', defaultShown: true },
    { id: 'email', label: 'Email', defaultShown: false },
    { id: 'organization', label: 'Organization', defaultShown: true },
    { id: 'department', label: 'Department', defaultShown: true },
    { id: 'subDepartment', label: 'Sub-department', defaultShown: true },
    { id: 'role', label: 'Role', defaultShown: true },
    { id: 'employment', label: 'Employment', defaultShown: true },
    { id: 'remuneration', label: 'Remuneration', defaultShown: true },
    { id: 'access', label: 'Access', defaultShown: true },
    { id: 'status', label: 'Status', defaultShown: true },
    { id: 'startDate', label: 'Start date', defaultShown: true },
    { id: 'endDate', label: 'End date', defaultShown: true },
    { id: 'skills', label: 'Skills', defaultShown: true },
    { id: 'licences', label: 'Licences', defaultShown: true },
    { id: 'workRights', label: 'Work rights', defaultShown: true },
];

/** The columns a viewer can hide: all but Name. */
export const HIDEABLE_COLUMNS = USERS_COLUMNS.filter((c) => c.id !== 'name');

/** Only the columns the viewer changed; the rest follow `defaultShown`. */
export type ColumnVisibility = Partial<Record<UsersColumnId, boolean>>;

const KNOWN = new Set<string>(USERS_COLUMNS.map((c) => c.id));
const DEFAULT_SHOWN = new Map(USERS_COLUMNS.map((c) => [c.id, c.defaultShown]));

export const isColumnShown = (visibility: ColumnVisibility | undefined | null, id: UsersColumnId): boolean =>
    id === 'name' || (visibility?.[id] ?? DEFAULT_SHOWN.get(id) ?? true);

const STORAGE_KEY = 'users.table.columns.v1';

/** What this browser remembers; nothing (the defaults) when storage is empty, blocked or unreadable. */
export function readColumnVisibility(): ColumnVisibility {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return {};
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        // Known ids with true/false only: anything else in storage is ignored.
        return Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).filter(([id, shown]) => KNOWN.has(id) && typeof shown === 'boolean'),
        ) as ColumnVisibility;
    } catch {
        return {};
    }
}

export function writeColumnVisibility(visibility: ColumnVisibility): void {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility ?? {}));
    } catch {
        // Private window or blocked storage: the choice lasts for this visit only.
    }
}

/** The viewer's column choice, remembered across visits in this browser. */
export function useColumnVisibility(): [ColumnVisibility, (next: ColumnVisibility) => void] {
    const [visibility, setVisibility] = useState<ColumnVisibility>(() => {
        try {
            return readColumnVisibility() ?? {};
        } catch {
            return {};
        }
    });
    const update = useCallback((next: ColumnVisibility) => {
        const safe = next && typeof next === 'object' && !Array.isArray(next) ? next : {};
        setVisibility(safe);
        writeColumnVisibility(safe);
    }, []);
    return [visibility ?? {}, update];
}

