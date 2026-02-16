import React, { createContext, useContext, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { addDays, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { useAuth } from '@/platform/auth/useAuth';

// ============================================================
// TYPES
// ============================================================

export type CalendarView = 'day' | '3day' | 'week' | 'month';
export type RosterMode = 'group' | 'people' | 'events' | 'roles';
export type ComplianceFilterStatus = 'all' | 'compliant' | 'warning' | 'violation';

interface DateRange {
    from: Date;
    to: Date;
}

export interface AdvancedFilters {
    /** Filter by role ID */
    roleId: string | null;
    /** Filter by required skill IDs */
    skillIds: string[];
    /** Filter by compliance status */
    complianceStatus: ComplianceFilterStatus;
    /** Filter by assignment status */
    assignmentStatus: 'all' | 'assigned' | 'unassigned' | 'on_bidding';
    /** Filter by lifecycle status */
    lifecycleStatus: 'all' | 'draft' | 'published' | 'cancelled';
    /** Filter by shift state ID (S1-S15) */
    stateId: string | null;
    /** Filter by assignment outcome */
    assignmentOutcome: 'all' | 'pending' | 'offered' | 'confirmed' | 'emergency_assigned' | 'none';
    /** Filter by bidding status */
    biddingStatus: 'all' | 'not_on_bidding' | 'on_bidding_normal' | 'on_bidding_urgent' | 'bidding_closed_no_winner';
    /** Filter by trading status */
    tradingStatus: 'all' | 'requested' | 'none';
    /** Text search across shift notes, role names, employee names */
    searchQuery: string;
}

const DEFAULT_ADVANCED_FILTERS: AdvancedFilters = {
    roleId: null,
    skillIds: [],
    complianceStatus: 'all',
    assignmentStatus: 'all',
    lifecycleStatus: 'all',
    stateId: null,
    assignmentOutcome: 'all',
    biddingStatus: 'all',
    tradingStatus: 'all',
    searchQuery: '',
};

interface RosterUIContextValue {
    // View state
    viewType: CalendarView;
    setViewType: (view: CalendarView) => void;

    // Date state
    selectedDate: Date;
    setSelectedDate: (date: Date) => void;

    // Mode state
    activeMode: RosterMode;
    setActiveMode: (mode: RosterMode) => void;

    // Organization/Department state (persists across navigation)
    selectedOrganizationId: string | null;
    setSelectedOrganizationId: (id: string | null) => void;
    selectedDepartmentIds: string[];
    setSelectedDepartmentIds: (ids: string[]) => void;
    selectedSubDepartmentIds: string[];
    setSelectedSubDepartmentIds: (ids: string[]) => void;
    // Backward compatibility for single getters/setters (to avoid massive blast radius)
    selectedDepartmentId: string | null;
    setSelectedDepartmentId: (id: string | null) => void;
    selectedSubDepartmentId: string | null;
    setSelectedSubDepartmentId: (id: string | null) => void;

    // Advanced Filters (Phase 1 Enterprise)
    advancedFilters: AdvancedFilters;
    setAdvancedFilters: (filters: Partial<AdvancedFilters>) => void;
    resetAdvancedFilters: () => void;
    hasActiveFilters: boolean;

    // Navigation helpers (pure, depend only on context state)
    navigatePrevious: () => void;
    navigateNext: () => void;
    navigateToToday: () => void;

    // Bucket View toggle (Groups mode only)
    isBucketView: boolean;
    setIsBucketView: (value: boolean) => void;

    // Utility functions
    getDateRange: () => DateRange;
    getDaysInRange: () => Date[];

    // View options for UI
    viewOptions: readonly { label: string; value: CalendarView }[];
}

// ============================================================
// CONTEXT
// ============================================================

const RosterUIContext = createContext<RosterUIContextValue | null>(null);

// ============================================================
// PROVIDER
// ============================================================

interface RosterUIProviderProps {
    children: React.ReactNode;
}

export const RosterUIProvider: React.FC<RosterUIProviderProps> = ({ children }) => {
    // Freeze initial date at provider mount using useRef
    // This guarantees a stable "session today" even if provider remounts
    const initialDate = useRef(new Date());

    const { activeContract, accessScope } = useAuth();

    // State - initialized to defaults (Day mode, today's date, group mode)
    // State - initialized from localStorage or defaults
    const [viewType, setViewType] = useState<CalendarView>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('roster_viewType');
            if (saved === 'day' || saved === '3day' || saved === 'week' || saved === 'month') {
                return saved;
            }
        }
        return 'day';
    });
    const [selectedDate, setSelectedDate] = useState<Date>(initialDate.current);
    const [activeMode, setActiveMode] = useState<RosterMode>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('roster_activeMode');
            if (saved === 'group' || saved === 'people' || saved === 'events' || saved === 'roles') {
                return saved;
            }
        }
        return 'group';
    });

    // Organization/Department state (persists across navigation)
    const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(() => {
        if (typeof window !== 'undefined') return localStorage.getItem('roster_orgId');
        return null;
    });
    const [selectedDepartmentIds, setSelectedDepartmentIdsState] = useState<string[]>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('roster_deptIds');
            if (saved) return JSON.parse(saved);
            const legacy = localStorage.getItem('roster_deptId');
            if (legacy) return [legacy];
        }
        return [];
    });
    const [selectedSubDepartmentIds, setSelectedSubDepartmentIdsState] = useState<string[]>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('roster_subDeptIds');
            if (saved) return JSON.parse(saved);
            const legacy = localStorage.getItem('roster_subDeptId');
            if (legacy) return [legacy];
        }
        return [];
    });

    const setSelectedDepartmentIds = useCallback((ids: string[]) => {
        setSelectedDepartmentIdsState(ids);
    }, []);

    const setSelectedSubDepartmentIds = useCallback((ids: string[]) => {
        setSelectedSubDepartmentIdsState(ids);
    }, []);

    const setSelectedDepartmentId = useCallback((id: string | null) => {
        setSelectedDepartmentIdsState(id ? [id] : []);
    }, []);

    const setSelectedSubDepartmentId = useCallback((id: string | null) => {
        setSelectedSubDepartmentIdsState(id ? [id] : []);
    }, []);

    const selectedDepartmentId = selectedDepartmentIds.length > 0 ? selectedDepartmentIds[0] : null;
    const selectedSubDepartmentId = selectedSubDepartmentIds.length > 0 ? selectedSubDepartmentIds[0] : null;

    // Advanced Filters (Phase 1 Enterprise)
    const [advancedFilters, setAdvancedFiltersState] = useState<AdvancedFilters>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('roster_advancedFilters');
            if (saved) {
                try {
                    return { ...DEFAULT_ADVANCED_FILTERS, ...JSON.parse(saved) };
                } catch { /* ignore parse errors */ }
            }
        }
        return DEFAULT_ADVANCED_FILTERS;
    });

    // Bucket View toggle (Groups mode only)
    const [isBucketView, setIsBucketView] = useState<boolean>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('roster_bucketView') === 'true';
        }
        return false;
    });

    const setAdvancedFilters = useCallback((partial: Partial<AdvancedFilters>) => {
        setAdvancedFiltersState(prev => ({ ...prev, ...partial }));
    }, []);

    const resetAdvancedFilters = useCallback(() => {
        setAdvancedFiltersState(DEFAULT_ADVANCED_FILTERS);
    }, []);

    const hasActiveFilters = useMemo(() => {
        return (
            advancedFilters.roleId !== null ||
            advancedFilters.skillIds.length > 0 ||
            advancedFilters.complianceStatus !== 'all' ||
            advancedFilters.assignmentStatus !== 'all' ||
            advancedFilters.lifecycleStatus !== 'all' ||
            advancedFilters.stateId !== null ||
            advancedFilters.assignmentOutcome !== 'all' ||
            advancedFilters.biddingStatus !== 'all' ||
            advancedFilters.tradingStatus !== 'all' ||
            advancedFilters.searchQuery.trim() !== ''
        );
    }, [advancedFilters]);

    // ===================================
    // SYNC WITH ACTIVE CONTRACT
    // ===================================
    useEffect(() => {
        if (!activeContract) return;

        // 1. Sync Organization (Always matches active contract)
        if (activeContract.organizationId && selectedOrganizationId !== activeContract.organizationId) {
            setSelectedOrganizationId(activeContract.organizationId);
        }

        // 2. Sync Department (For Gamma/Beta/Alpha - i.e., Managers and below)
        // Delta (Org Admin) and Epsilon (Global Admin) can switch departments.
        // We use accessScope?.accessLevel to determine the REAL restriction (Certificate-based), 
        // as high-level users might select a lower-level contract but still retain global privileges.
        const effectiveAccess = accessScope?.accessLevel || activeContract.accessLevel;
        const isDeptRestricted = ['gamma', 'beta', 'alpha'].includes(effectiveAccess);

        if (isDeptRestricted && activeContract.departmentId && !selectedDepartmentIds.includes(activeContract.departmentId)) {
            setSelectedDepartmentIds([activeContract.departmentId]);
        }

        // 3. Sync Sub-Department (For Beta/Alpha - i.e., Team Leads and Members)
        const isSubDeptRestricted = ['beta', 'alpha'].includes(effectiveAccess);
        if (isSubDeptRestricted && activeContract.subDepartmentId && !selectedSubDepartmentIds.includes(activeContract.subDepartmentId)) {
            setSelectedSubDepartmentIds([activeContract.subDepartmentId]);
        }

    }, [activeContract, selectedOrganizationId, selectedDepartmentId, selectedSubDepartmentId]);

    // Persistence Effects
    React.useEffect(() => {
        localStorage.setItem('roster_viewType', viewType);
    }, [viewType]);

    React.useEffect(() => {
        localStorage.setItem('roster_activeMode', activeMode);
    }, [activeMode]);

    React.useEffect(() => {
        if (selectedOrganizationId) localStorage.setItem('roster_orgId', selectedOrganizationId);
        else localStorage.removeItem('roster_orgId');
    }, [selectedOrganizationId]);

    React.useEffect(() => {
        localStorage.setItem('roster_deptIds', JSON.stringify(selectedDepartmentIds));
        if (selectedDepartmentIds.length > 0) localStorage.setItem('roster_deptId', selectedDepartmentIds[0]);
        else localStorage.removeItem('roster_deptId');
    }, [selectedDepartmentIds]);

    React.useEffect(() => {
        localStorage.setItem('roster_subDeptIds', JSON.stringify(selectedSubDepartmentIds));
        if (selectedSubDepartmentIds.length > 0) localStorage.setItem('roster_subDeptId', selectedSubDepartmentIds[0]);
        else localStorage.removeItem('roster_subDeptId');
    }, [selectedSubDepartmentIds]);

    React.useEffect(() => {
        localStorage.setItem('roster_advancedFilters', JSON.stringify(advancedFilters));
    }, [advancedFilters]);

    React.useEffect(() => {
        localStorage.setItem('roster_bucketView', String(isBucketView));
    }, [isBucketView]);

    // Static view options
    const viewOptions = useMemo(() => [
        { label: 'Day', value: 'day' as const },
        { label: '3-Day', value: '3day' as const },
        { label: 'Week', value: 'week' as const },
        { label: 'Month', value: 'month' as const },
    ] as const, []);

    // Get date range based on current view and selected date
    const getDateRange = useCallback((): DateRange => {
        switch (viewType) {
            case 'day':
                return { from: selectedDate, to: selectedDate };
            case '3day':
                return { from: selectedDate, to: addDays(selectedDate, 2) };
            case 'week':
                const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
                const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
                return { from: weekStart, to: weekEnd };
            case 'month':
                return { from: startOfMonth(selectedDate), to: endOfMonth(selectedDate) };
            default:
                return { from: selectedDate, to: selectedDate };
        }
    }, [viewType, selectedDate]);

    // Get all days in the current range
    const getDaysInRange = useCallback((): Date[] => {
        const { from, to } = getDateRange();
        return eachDayOfInterval({ start: from, end: to });
    }, [getDateRange]);

    // Pure navigation helpers - depend only on context state
    const navigatePrevious = useCallback(() => {
        setSelectedDate(prev => {
            switch (viewType) {
                case 'day':
                    return subDays(prev, 1);
                case '3day':
                    return subDays(prev, 3);
                case 'week':
                    return subDays(prev, 7);
                case 'month':
                    const prevMonth = new Date(prev);
                    prevMonth.setMonth(prevMonth.getMonth() - 1);
                    return prevMonth;
                default:
                    return prev;
            }
        });
    }, [viewType]);

    const navigateNext = useCallback(() => {
        setSelectedDate(prev => {
            switch (viewType) {
                case 'day':
                    return addDays(prev, 1);
                case '3day':
                    return addDays(prev, 3);
                case 'week':
                    return addDays(prev, 7);
                case 'month':
                    const nextMonth = new Date(prev);
                    nextMonth.setMonth(nextMonth.getMonth() + 1);
                    return nextMonth;
                default:
                    return prev;
            }
        });
    }, [viewType]);

    const navigateToToday = useCallback(() => {
        setSelectedDate(initialDate.current);
    }, []);

    // Memoize context value to prevent unnecessary re-renders
    const value = useMemo<RosterUIContextValue>(() => ({
        viewType,
        setViewType,
        selectedDate,
        setSelectedDate,
        activeMode,
        setActiveMode,
        selectedOrganizationId,
        setSelectedOrganizationId,
        selectedDepartmentIds,
        setSelectedDepartmentIds,
        selectedSubDepartmentIds,
        setSelectedSubDepartmentIds,
        selectedDepartmentId,
        setSelectedDepartmentId,
        selectedSubDepartmentId,
        setSelectedSubDepartmentId,
        advancedFilters,
        setAdvancedFilters,
        resetAdvancedFilters,
        hasActiveFilters,
        isBucketView,
        setIsBucketView,
        navigatePrevious,
        navigateNext,
        navigateToToday,
        getDateRange,
        getDaysInRange,
        viewOptions,
    }), [
        viewType,
        selectedDate,
        activeMode,
        selectedOrganizationId,
        selectedDepartmentIds,
        setSelectedDepartmentIds,
        selectedSubDepartmentIds,
        setSelectedSubDepartmentIds,
        selectedDepartmentId,
        selectedSubDepartmentId,
        advancedFilters,
        setAdvancedFilters,
        resetAdvancedFilters,
        hasActiveFilters,
        isBucketView,
        setIsBucketView,
        navigatePrevious,
        navigateNext,
        navigateToToday,
        getDateRange,
        getDaysInRange,
        viewOptions,
    ]);

    return (
        <RosterUIContext.Provider value={value}>
            {children}
        </RosterUIContext.Provider>
    );
};

// ============================================================
// HOOK
// ============================================================

/**
 * Hook to access roster UI state from context.
 * Throws if used outside of RosterUIProvider.
 */
export const useRosterUI = (): RosterUIContextValue => {
    const context = useContext(RosterUIContext);
    if (!context) {
        throw new Error('useRosterUI must be used within a RosterUIProvider');
    }
    return context;
};

/**
 * Optional hook that returns null if context is not available.
 * Useful for backward compatibility.
 */
export const useRosterUIOptional = (): RosterUIContextValue | null => {
    return useContext(RosterUIContext);
};
