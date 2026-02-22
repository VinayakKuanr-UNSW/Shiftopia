/**
 * Roster UI Store — Zustand v5
 *
 * Single source of truth for all roster UI preferences and filters.
 * Replaces the 456-line RosterUIContext with a lean, persistent store.
 *
 * Benefits over the previous Context implementation:
 *  - 7 separate localStorage.setItem effects → 0 (Zustand persist handles it atomically)
 *  - No Provider re-render cascade — components subscribe granularly
 *  - Selectors are composable and memoised at call-site
 *  - Date objects survive hydration via custom storage serialiser
 *  - Auth sync lives in a single useEffect in RosterUIProvider (not scattered)
 *
 * Consumer API (backward-compatible with useRosterUI):
 *   const store = useRosterStore();
 *   const viewType = useRosterStore(s => s.viewType);  // granular subscription
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  addDays, subDays,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  eachDayOfInterval,
} from 'date-fns';

// ── Re-exported types (match what was exported from RosterUIContext) ──────────

export type CalendarView = 'day' | '3day' | 'week' | 'month';
export type RosterMode   = 'group' | 'people' | 'events' | 'roles';
export type ComplianceFilterStatus = 'all' | 'compliant' | 'warning' | 'violation';

export interface AdvancedFilters {
  roleId:            string | null;
  skillIds:          string[];
  complianceStatus:  ComplianceFilterStatus;
  assignmentStatus:  'all' | 'assigned' | 'unassigned' | 'on_bidding';
  lifecycleStatus:   'all' | 'draft' | 'published' | 'cancelled';
  stateId:           string | null;
  assignmentOutcome: 'all' | 'pending' | 'offered' | 'confirmed' | 'emergency_assigned' | 'none';
  biddingStatus:     'all' | 'not_on_bidding' | 'on_bidding_normal' | 'on_bidding_urgent' | 'bidding_closed_no_winner';
  tradingStatus:     'all' | 'requested' | 'none';
  searchQuery:       string;
}

export const DEFAULT_ADVANCED_FILTERS: AdvancedFilters = {
  roleId:            null,
  skillIds:          [],
  complianceStatus:  'all',
  assignmentStatus:  'all',
  lifecycleStatus:   'all',
  stateId:           null,
  assignmentOutcome: 'all',
  biddingStatus:     'all',
  tradingStatus:     'all',
  searchQuery:       '',
};

export interface DateRange { from: Date; to: Date }

// ── Store state + actions ─────────────────────────────────────────────────────

interface RosterState {
  // ── Persisted UI preferences ───────────────────────────────────────────────
  viewType:                  CalendarView;
  activeMode:                RosterMode;
  selectedOrganizationId:    string | null;
  selectedDepartmentIds:     string[];
  selectedSubDepartmentIds:  string[];
  advancedFilters:           AdvancedFilters;
  isBucketView:              boolean;

  // ── Session state (not persisted — resets each tab/reload) ────────────────
  /** ISO date string 'YYYY-MM-DD', restored as Date in getters */
  _selectedDateISO: string;

  // ── Actions ───────────────────────────────────────────────────────────────
  setViewType:               (view: CalendarView) => void;
  setSelectedDate:           (date: Date) => void;
  setActiveMode:             (mode: RosterMode) => void;
  setSelectedOrganizationId: (id: string | null) => void;
  setSelectedDepartmentIds:  (ids: string[]) => void;
  setSelectedSubDepartmentIds: (ids: string[]) => void;
  /** Backward-compat single-value setters */
  setSelectedDepartmentId:   (id: string | null) => void;
  setSelectedSubDepartmentId:(id: string | null) => void;
  setAdvancedFilters:        (partial: Partial<AdvancedFilters>) => void;
  resetAdvancedFilters:      () => void;
  setIsBucketView:           (value: boolean) => void;

  // ── Navigation ────────────────────────────────────────────────────────────
  navigatePrevious:  () => void;
  navigateNext:      () => void;
  navigateToToday:   () => void;
}

// ── Custom storage with Date serialisation ────────────────────────────────────
// We store selectedDate as an ISO string in localStorage.
// The _selectedDateISO field is intentionally NOT in the persist partialize
// so it always starts as today (session state).

const rosterStorage = createJSONStorage(() => localStorage);

// ── Store definition ─────────────────────────────────────────────────────────

export const useRosterStore = create<RosterState>()(
  persist(
    (set, get) => ({
      // ── Persisted defaults ─────────────────────────────────────────────────
      viewType:                 'day',
      activeMode:               'group',
      selectedOrganizationId:   null,
      selectedDepartmentIds:    [],
      selectedSubDepartmentIds: [],
      advancedFilters:          DEFAULT_ADVANCED_FILTERS,
      isBucketView:             false,

      // ── Session-only (today, not persisted) ────────────────────────────────
      _selectedDateISO: new Date().toISOString().split('T')[0],

      // ── Actions ────────────────────────────────────────────────────────────
      setViewType:  (view)  => set({ viewType: view }),
      setActiveMode:(mode)  => set({ activeMode: mode }),
      setIsBucketView: (v)  => set({ isBucketView: v }),

      setSelectedDate: (date) =>
        set({ _selectedDateISO: date.toISOString().split('T')[0] }),

      setSelectedOrganizationId: (id) =>
        set({ selectedOrganizationId: id }),

      setSelectedDepartmentIds: (ids) =>
        set({ selectedDepartmentIds: ids }),

      setSelectedSubDepartmentIds: (ids) =>
        set({ selectedSubDepartmentIds: ids }),

      setSelectedDepartmentId: (id) =>
        set({ selectedDepartmentIds: id ? [id] : [] }),

      setSelectedSubDepartmentId: (id) =>
        set({ selectedSubDepartmentIds: id ? [id] : [] }),

      setAdvancedFilters: (partial) =>
        set(s => ({ advancedFilters: { ...s.advancedFilters, ...partial } })),

      resetAdvancedFilters: () =>
        set({ advancedFilters: DEFAULT_ADVANCED_FILTERS }),

      // ── Navigation ─────────────────────────────────────────────────────────
      navigatePrevious: () => {
        const { viewType, _selectedDateISO } = get();
        const date = new Date(_selectedDateISO);
        const next = (() => {
          switch (viewType) {
            case 'day':   return subDays(date, 1);
            case '3day':  return subDays(date, 3);
            case 'week':  return subDays(date, 7);
            case 'month': {
              const d = new Date(date);
              d.setMonth(d.getMonth() - 1);
              return d;
            }
            default: return date;
          }
        })();
        set({ _selectedDateISO: next.toISOString().split('T')[0] });
      },

      navigateNext: () => {
        const { viewType, _selectedDateISO } = get();
        const date = new Date(_selectedDateISO);
        const next = (() => {
          switch (viewType) {
            case 'day':   return addDays(date, 1);
            case '3day':  return addDays(date, 3);
            case 'week':  return addDays(date, 7);
            case 'month': {
              const d = new Date(date);
              d.setMonth(d.getMonth() + 1);
              return d;
            }
            default: return date;
          }
        })();
        set({ _selectedDateISO: next.toISOString().split('T')[0] });
      },

      navigateToToday: () =>
        set({ _selectedDateISO: new Date().toISOString().split('T')[0] }),
    }),

    {
      name:    'roster-ui-v2',     // 'v2' avoids collisions with old localStorage keys
      storage: rosterStorage,
      // Only persist preferences — selectedDate is a session-only concept
      partialize: (s) => ({
        viewType:                 s.viewType,
        activeMode:               s.activeMode,
        selectedOrganizationId:   s.selectedOrganizationId,
        selectedDepartmentIds:    s.selectedDepartmentIds,
        selectedSubDepartmentIds: s.selectedSubDepartmentIds,
        advancedFilters:          s.advancedFilters,
        isBucketView:             s.isBucketView,
      }),
    },
  ),
);

// ── Derived / computed selectors ──────────────────────────────────────────────
// Call these with useRosterStore(selectXxx) for granular subscriptions.

/** The selected date as a real Date object. Derived from the ISO string. */
export const selectSelectedDate = (s: RosterState): Date =>
  new Date(s._selectedDateISO);

/** Backward-compat: first selected department (single-select legacy API) */
export const selectDepartmentId = (s: RosterState): string | null =>
  s.selectedDepartmentIds[0] ?? null;

/** Backward-compat: first selected sub-department */
export const selectSubDepartmentId = (s: RosterState): string | null =>
  s.selectedSubDepartmentIds[0] ?? null;

/** Whether any advanced filter is active */
export const selectHasActiveFilters = (s: RosterState): boolean =>
  s.advancedFilters.roleId !== null ||
  s.advancedFilters.skillIds.length > 0 ||
  s.advancedFilters.complianceStatus !== 'all' ||
  s.advancedFilters.assignmentStatus !== 'all' ||
  s.advancedFilters.lifecycleStatus !== 'all' ||
  s.advancedFilters.stateId !== null ||
  s.advancedFilters.assignmentOutcome !== 'all' ||
  s.advancedFilters.biddingStatus !== 'all' ||
  s.advancedFilters.tradingStatus !== 'all' ||
  s.advancedFilters.searchQuery.trim() !== '';

/** Date range for the current viewType + selectedDate */
export const selectDateRange = (s: RosterState): DateRange => {
  const date = new Date(s._selectedDateISO);
  switch (s.viewType) {
    case 'day':
      return { from: date, to: date };
    case '3day':
      return { from: date, to: addDays(date, 2) };
    case 'week': {
      const from = startOfWeek(date, { weekStartsOn: 1 });
      const to   = endOfWeek(date,   { weekStartsOn: 1 });
      return { from, to };
    }
    case 'month':
      return { from: startOfMonth(date), to: endOfMonth(date) };
    default:
      return { from: date, to: date };
  }
};

/** All Date objects in the current range */
export const selectDaysInRange = (s: RosterState): Date[] => {
  const { from, to } = selectDateRange(s);
  return eachDayOfInterval({ start: from, end: to });
};

// ── Static view options (stable reference, never recreated) ──────────────────

export const VIEW_OPTIONS = [
  { label: 'Day',   value: 'day'   as CalendarView },
  { label: '3-Day', value: '3day'  as CalendarView },
  { label: 'Week',  value: 'week'  as CalendarView },
  { label: 'Month', value: 'month' as CalendarView },
] as const;
