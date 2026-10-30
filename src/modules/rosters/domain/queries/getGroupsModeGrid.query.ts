/**
 * Get Groups Mode Grid Query
 * Domain layer - builds the visual grid structure from shifts
 * 
 * This moves business logic (grouping, status derivation) out of UI
 */

import { Shift, TemplateGroupType } from '@/modules/rosters/api/shifts.api';
import { ALL_GROUP_TYPES, GROUP_DISPLAY_NAMES } from '@/modules/rosters/domain/projections/constants';

/* ============================================================
   TYPES
   ============================================================ */

interface VisualGroup {
    id: string;
    name: string;
    type: TemplateGroupType;
    color: string;
    subGroups: VisualSubGroup[];
}

interface VisualSubGroup {
    id: string;
    name: string;
    shifts: Record<string, ShiftDisplay[]>;
}

export interface ShiftDisplay {
    id: string;
    role: string;
    startTime: string;
    endTime: string;
    employeeName?: string;
    status: 'Open' | 'Assigned' | 'Completed' | 'Draft' | 'Published';
    isPublished: boolean;
    isDraft: boolean;
    isOnBidding: boolean;
    isCancelled: boolean;
    rawShift: Shift;
}

/* ============================================================
   CONSTANTS
   ============================================================ */

const DEFAULT_SUB_GROUPS = ['AM Base', 'PM Base', 'Evening'];

const GROUP_COLORS: Record<TemplateGroupType, string> = {
    convention_centre: 'blue',
    exhibition_centre: 'emerald',
    theatre: 'red',
    the_cutaway: 'amber',
    office: 'cyan',
};

/* ============================================================
   BUSINESS LOGIC
   ============================================================ */



/**
 * Get default empty groups structure
 */
export function getDefaultGroups(): VisualGroup[] {
    return ALL_GROUP_TYPES.map(
        (type) => ({
            id: type,
            name: GROUP_DISPLAY_NAMES[type],
            type,
            color: GROUP_COLORS[type],
            subGroups: DEFAULT_SUB_GROUPS.map((name) => ({
                id: `${type}-${name}`,
                name,
                shifts: {},
            })),
        })
    );
}

