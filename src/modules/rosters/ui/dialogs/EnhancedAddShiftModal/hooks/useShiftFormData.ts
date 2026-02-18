import React from 'react';
import {
    useRoles,
    useRemunerationLevels,
    useEmployees,
    useSkills,
    useLicenses,
    useEvents,
    useRostersLookup,
    useRosterStructure,
} from '@/modules/rosters/state/useRosterShifts';
import type {
    Role,
    RemunerationLevel,
    Employee,
    Skill,
    License,
    Event,
    Roster,
    ShiftContext
} from '../types';

interface UseShiftFormDataProps {
    isOpen: boolean;
    context: ShiftContext;
    editMode: boolean;
    existingShift?: any;
    selectedRosterId: string;
    setSelectedRosterId: (id: string) => void;
}

interface UseShiftFormDataReturn {
    roles: Role[];
    remunerationLevels: RemunerationLevel[];
    employees: Employee[];
    skills: Skill[];
    licenses: License[];
    events: Event[];
    rosters: Roster[];
    rosterStructure: { groupType: string; subGroupName: string }[];
    isLoadingData: boolean;
}

export function useShiftFormData({
    isOpen,
    context,
    editMode,
    existingShift,
    selectedRosterId,
    setSelectedRosterId,
}: UseShiftFormDataProps): UseShiftFormDataReturn {
    // Determine correct IDs for fetching roles
    // 1. Context IDs (from props/existing shift) - used for fetching generic data
    const contextDeptId = (editMode && existingShift?.department_id) || context.departmentId;
    const contextSubDeptId = (editMode && existingShift?.sub_department_id) || context.subDepartmentId;

    // 2. Fetch Rosters first (to potentialy resolve department context)
    const { data: rosters = [], isLoading: isLoadingRosters } = useRostersLookup(
        isOpen ? context.organizationId : undefined,
        {
            departmentId: isOpen ? contextDeptId : undefined,
            departmentIds: isOpen ? context.departmentIds : undefined,
            subDepartmentId: isOpen ? contextSubDeptId : undefined,
            subDepartmentIds: isOpen ? context.subDepartmentIds : undefined,
        }
    );

    React.useEffect(() => {
        if (isOpen) {
            console.log('[useShiftFormData] Modal Open. Context:', context);
            console.log('[useShiftFormData] Filters:', { contextDeptId, contextSubDeptId });
            console.log('[useShiftFormData] Fetched Rosters:', rosters.length, rosters.map(r => ({ id: r.id, start: r.start_date, sub: r.sub_department_id })));
        }
    }, [isOpen, context, contextDeptId, contextSubDeptId, rosters]);

    // 3. Metadata Hooks (Restored)
    const { data: remunerationLevels = [], isLoading: isLoadingRem } = useRemunerationLevels();
    const { data: employees = [], isLoading: isLoadingEmps } = useEmployees();
    const { data: skills = [], isLoading: isLoadingSkills } = useSkills();
    const { data: licenses = [], isLoading: isLoadingLicenses } = useLicenses();
    const { data: events = [], isLoading: isLoadingEvents } = useEvents();

    // 4. Derive Role Context - Prefer specific roster context if available, fallback to global context
    const selectedRoster = rosters.find(r => r.id === (selectedRosterId || context.rosterId));

    // If context.departmentId is missing (e.g. "All Departments" view), use the roster's department
    // This fixes the issue where "All Roles" are shown because departmentId is undefined
    const roleDeptId = contextDeptId || selectedRoster?.department_id;
    const roleSubDeptId = contextSubDeptId || selectedRoster?.sub_department_id;

    // All queries are enabled only when the modal is open
    const { data: roles = [] } = useRoles(
        isOpen ? roleDeptId : undefined,
        isOpen ? roleSubDeptId : undefined
    );
    const { data: rosterStructure = [] } = useRosterStructure(selectedRosterId || context.rosterId);

    // Auto-select roster matching the date
    React.useEffect(() => {
        // Condition 1: Context specifies a roster ID (Strongest constraint)
        if (context.rosterId) {
            // Only select if it matches the requested ID. 
            // If it's not in the list yet (race condition), we wait. 
            // We DO NOT fall back to other matching rosters to avoid selecting Templates or other incorrect rosters.
            if (!selectedRosterId || selectedRosterId !== context.rosterId) {
                const target = rosters.find(r => r.id === context.rosterId);
                if (target) {
                    console.log('[useShiftFormData] Found roster matching context.rosterId:', target.id);
                    setSelectedRosterId(target.id);
                }
            }
            return;
        }

        // Condition 2: No specific roster requested, try to find one for the date
        // Only run if we don't have a selection yet
        if (!selectedRosterId && rosters.length > 0 && context.date) {
            // Find roster strictly containing the date
            // Prefer rosters matching the current sub-department context if available
            const matchingRoster = rosters.find(r => {
                const dateMatch = context.date! >= r.start_date && context.date! <= r.end_date;
                if (!dateMatch) return false;

                // If we have a sub-department context, prefer rosters matching it
                if (contextSubDeptId && r.sub_department_id === contextSubDeptId) return true;

                // If no sub-department context or no specific match, first one wins
                return true;
            });

            if (matchingRoster) {
                console.log('[useShiftFormData] Found matching roster by date:', matchingRoster.id);
                setSelectedRosterId(matchingRoster.id);
            }
        }
    }, [rosters, selectedRosterId, context.rosterId, context.date, contextSubDeptId, setSelectedRosterId]);

    const isLoadingData = isLoadingRem || isLoadingEmps || isLoadingSkills || isLoadingLicenses || isLoadingEvents || isLoadingRosters;

    return {
        roles: roles as Role[],
        remunerationLevels: remunerationLevels as RemunerationLevel[],
        employees: employees as Employee[],
        skills: skills as Skill[],
        licenses: licenses as License[],
        events: events as Event[],
        rosters: rosters as Roster[],
        rosterStructure,
        isLoadingData,
    };
}
