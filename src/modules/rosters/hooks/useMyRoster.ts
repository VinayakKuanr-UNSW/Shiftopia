import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, subDays, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';
import { useAuth } from '@/platform/auth/useAuth';
import { CalendarView } from '@/modules/rosters/contexts/RosterUIContext';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { Shift, ShiftWithDetails, doesShiftTrulyCrossMidnight } from '@/modules/rosters/domain/shift.entity';

import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';

import { ScopeSelection } from '@/platform/auth/types';

/**
 * Local-field `YYYY-MM-DD`. Deliberately NOT `date-fns#format`: this is called
 * once per calendar cell per render, and `format` re-parses its pattern and
 * walks the locale on every call. Same output, no allocation beyond the string.
 */
const toDateKey = (date: Date): string => {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
};

/**
 * Shared empty result, so "no shifts" keeps a stable identity across renders —
 * most cells in a month grid take this path, and a fresh `[]` per cell would
 * defeat any downstream memo comparing by reference. Never mutated.
 */
const NO_SHIFTS: ShiftWithDetails[] = [];

/**
 * `Map`, not a plain object, and deliberately so.
 *
 * These replaced a ternary chain during the date-index refactor, and an object
 * lookup is NOT a safe translation of one: `GROUP_NAMES['constructor']` returns
 * a function off `Object.prototype`, not `undefined`, so `?? 'General'` never
 * fires and a FUNCTION lands in `groupName` — which React then refuses to render
 * as a child. Same for `__proto__`, `toString`, `valueOf`, `hasOwnProperty`.
 *
 * `shifts.group_type` is a 4-value Postgres enum today, so the DB cannot produce
 * those. But the wrapper is also built from optimistic cache writes and offer
 * mappings, and this codebase does use `ALTER TYPE ... ADD VALUE`. A `Map` has no
 * prototype chain to fall through, so the question cannot arise.
 */
const GROUP_NAMES = new Map<string, string>([
    ['convention_centre', 'Convention'],
    ['exhibition_centre', 'Exhibition'],
    ['theatre', 'Theatre'],
    ['the_cutaway', 'The Cutaway'],
]);
const GROUP_COLORS = new Map<string, string>([
    ['convention_centre', 'convention'],
    ['exhibition_centre', 'exhibition'],
    ['theatre', 'theatre'],
    ['the_cutaway', 'cutaway'],
]);

interface DayBucket {
    /** Shifts starting on this day, plus continuations spilling in from the day before. */
    all: ShiftWithDetails[];
    /** Shifts starting on this day only. */
    startingOnly: ShiftWithDetails[];
}

export const useMyRoster = (view: CalendarView, selectedDate: Date, scope?: ScopeSelection | null) => {
    const { user } = useAuth();
    // We still use orgSelection for legacy/fallback context if needed, but scope takes precedence for filtering
    const { organizationId, departmentId, subDepartmentId } = useOrgSelection();

    // Calculate date range based on the view
    const calculateDateRange = () => {
        let start: Date;
        let end: Date;

        if (view === 'day') {
            start = selectedDate;
            end = selectedDate;
        } else if (view === '3day') {
            start = selectedDate;
            end = addDays(selectedDate, 2);
        } else if (view === 'week') {
            start = startOfWeekAU(selectedDate);
            end = endOfWeekAU(selectedDate);
        } else if (view === 'month') {
            start = startOfMonth(selectedDate);
            end = endOfMonth(selectedDate);
        } else {
            start = selectedDate;
            end = selectedDate;
        }

        return { start, end };
    };

    // Update date range when view or selectedDate changes
    const { start: rawStart, end } = calculateDateRange();

    // Buffer for overnight shifts (catch shifts starting day before but ending today)
    const start = subDays(rawStart, 1);

    const startDateStr = toDateKey(start);
    const endDateStr = toDateKey(end);

    // Fetch shifts for the date range using unified keys
    const { data: shifts = [], isLoading, error } = useQuery({
        // Use the centralized query key factory
        queryKey: shiftKeys.byEmployee(user?.id || '', startDateStr, endDateStr),
        queryFn: async () => {
            if (!user?.id) return [];
            return shiftsQueries.getEmployeeShifts(user.id, startDateStr, endDateStr);
        },
        enabled: !!user?.id,
        staleTime: 30000, // Consistent with useRosterShifts
    });

    const resolvedDateRange = useMemo(
        () => eachDayOfInterval({ start: new Date(startDateStr), end: new Date(endDateStr) }),
        [startDateStr, endDateStr],
    );

    /**
     * Scope identity, flattened.
     *
     * `useScopeFilter` hands back `currentGlobalScope || defaultScope`, and the
     * fallback branch can produce a fresh object. Keying the index on the ids
     * themselves means a re-render with an equal-but-new scope object does not
     * throw the index away.
     */
    const scopeKey = scope
        ? `${scope.org_ids?.join()}|${scope.dept_ids?.join()}|${scope.subdept_ids?.join()}`
        : `ctx:${organizationId ?? ''}`;

    /**
     * Date → shifts index, built ONCE per fetch/scope change.
     *
     * This used to be a `shifts.filter(...)` inside `getShiftsForDate`, which was
     * re-created on every render and called once per calendar cell — the desktop
     * month view asks three times per cell (accessible label, day content, chip
     * overlay), so 42 cells cost 126 full scans of the roster plus 252
     * `date-fns#format` calls, every render. Now it is one pass, and each lookup
     * is a `Map.get`.
     *
     * Entries are appended in source-array order, which reproduces exactly what
     * the old `.filter()` returned — including the interleaving of same-day
     * shifts with continuations from the night before. That ordering is load
     * bearing: the month view renders `dayShifts.slice(0, 3)`.
     */
    const index = useMemo(() => {
        const byDate = new Map<string, DayBucket>();

        const bucket = (key: string): DayBucket => {
            let b = byDate.get(key);
            if (!b) {
                b = { all: [], startingOnly: [] };
                byDate.set(key, b);
            }
            return b;
        };

        const inScope = (s: Shift): boolean => {
            // 1. Priority: Multi-select Scope (from MyRosterPage ScopeFilterBanner)
            if (scope) {
                if (scope.org_ids && scope.org_ids.length > 0) {
                    if (!s.organization_id || !scope.org_ids.includes(s.organization_id)) return false;
                }
                if (scope.dept_ids && scope.dept_ids.length > 0) {
                    if (!scope.dept_ids.includes(s.department_id)) return false;
                }
                if (scope.subdept_ids && scope.subdept_ids.length > 0) {
                    // Inclusion Fix: Include shifts that match selected sub-depts,
                    // OR are at the Department level (null sub_dept) if their parent department is match.
                    const subDeptMatch = s.sub_department_id && scope.subdept_ids.includes(s.sub_department_id);
                    const isDeptLevel = !s.sub_department_id;
                    if (!subDeptMatch && !isDeptLevel) return false;
                }
                return true;
            }
            // 2. Fallback: Global Context (Single Select) - only if no explicit scope passed.
            // Deliberately relaxed beyond the org: tightening it here previously hid
            // shifts the user expected to see.
            if (organizationId) return s.organization_id === organizationId;
            return true;
        };

        for (const s of shifts) {
            // Exclude S3 (Published+Offered, awaiting acceptance) — they appear in MyOffers modal only.
            // S3 encoding: lifecycle=Published, assignment_status=assigned, assignment_outcome=NULL
            if (s.lifecycle_status === 'Published' && s.assignment_status === 'assigned' && !s.assignment_outcome) continue;
            if (!inScope(s)) continue;

            const entry: ShiftWithDetails = {
                shift: s,
                groupName: GROUP_NAMES.get(s.group_type as string) ?? 'General',
                groupColor: GROUP_COLORS.get(s.group_type as string) ?? 'default',
                subGroupName: s.sub_group_name || '',
            };

            const own = bucket(s.shift_date);
            own.all.push(entry);
            own.startingOnly.push(entry);

            if (doesShiftTrulyCrossMidnight(s)) {
                // Spills into the following day; visible there only when the caller
                // asks for continuations.
                const [y, m, d] = s.shift_date.split('-').map(Number);
                const next = toDateKey(new Date(y, m - 1, d + 1));
                bucket(next).all.push(entry);
            }
        }

        return byDate;
        // `shifts` is a react-query array: stable until the query data changes.
    }, [shifts, scopeKey, scope, organizationId]);

    /**
     * Stable across renders, so the month/week views' `useCallback`s — and the
     * `MonthGrid` config memo they feed — are no longer invalidated every render.
     */
    const getShiftsForDate = useCallback(
        (date: Date, options?: { includeContinuations?: boolean }): ShiftWithDetails[] => {
            const bucket = index.get(toDateKey(date));
            if (!bucket) return NO_SHIFTS;
            const includeContinuations = options?.includeContinuations ?? true;
            return includeContinuations ? bucket.all : bucket.startingOnly;
        },
        [index],
    );

    // Navigation functions
    const goToPrevious = () => {
        if (view === 'day') {
            return subDays(selectedDate, 1);
        } else if (view === '3day') {
            return subDays(selectedDate, 3);
        } else if (view === 'week') {
            return subDays(selectedDate, 7);
        } else if (view === 'month') {
            const newDate = new Date(selectedDate);
            newDate.setMonth(newDate.getMonth() - 1);
            return newDate;
        }
        return selectedDate;
    };

    const goToNext = () => {
        if (view === 'day') {
            return addDays(selectedDate, 1);
        } else if (view === '3day') {
            return addDays(selectedDate, 3);
        } else if (view === 'week') {
            return addDays(selectedDate, 7);
        } else if (view === 'month') {
            const newDate = new Date(selectedDate);
            newDate.setMonth(newDate.getMonth() + 1);
            return newDate;
        }
        return selectedDate;
    };

    return {
        dateRange: resolvedDateRange,
        shifts,
        isLoading,
        error,
        getShiftsForDate,
        goToPrevious,
        goToNext
    };
};
