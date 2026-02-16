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
    const targetDeptId = (editMode && existingShift?.department_id) || context.departmentId;
    const targetSubDeptId = (editMode && existingShift?.sub_department_id) || context.subDepartmentId;

    // All queries are enabled only when the modal is open
    const { data: roles = [] } = useRoles(
        isOpen ? targetDeptId : undefined,
        isOpen ? targetSubDeptId : undefined
    );
    const { data: remunerationLevels = [], isLoading: isLoadingRem } = useRemunerationLevels();
    const { data: employees = [], isLoading: isLoadingEmps } = useEmployees();
    const { data: skills = [], isLoading: isLoadingSkills } = useSkills();
    const { data: licenses = [], isLoading: isLoadingLicenses } = useLicenses();
    const { data: events = [], isLoading: isLoadingEvents } = useEvents();
    const { data: rosters = [], isLoading: isLoadingRosters } = useRostersLookup(
        isOpen ? context.organizationId : undefined,
        {
            departmentId: isOpen ? targetDeptId : undefined,
            departmentIds: isOpen ? context.departmentIds : undefined,
            subDepartmentIds: isOpen ? context.subDepartmentIds : undefined,
        }
    );
    const { data: rosterStructure = [] } = useRosterStructure(selectedRosterId);

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
                    setSelectedRosterId(target.id);
                }
            }
            return;
        }

        // Condition 2: No specific roster requested, try to find one for the date
        // Only run if we don't have a selection yet
        if (!selectedRosterId && rosters.length > 0 && context.date) {
            // Find roster strictly containing the date
            // Prefer "Daily" rosters over "Template" rosters if possible? 
            // For now, just finding the first match is standard, but usually daily rosters are what we want for ad-hoc shifts.
            const matchingRoster = rosters.find(r =>
                context.date >= r.start_date && context.date <= r.end_date
            );

            if (matchingRoster) {
                setSelectedRosterId(matchingRoster.id);
            }
        }
    }, [rosters, selectedRosterId, context.rosterId, context.date, setSelectedRosterId]);

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
