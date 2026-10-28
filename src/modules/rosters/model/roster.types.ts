






// Hierarchy Data Structure (for useRosterStructure)
interface RosterSubGroupStructure {
    id: string;
    name: string;
    sortOrder: number;
}

interface RosterGroupStructure {
    id: string;
    name: string;
    externalId: string | null;
    sortOrder: number;
    subGroups: RosterSubGroupStructure[];
}

export interface RosterStructure {
    rosterId: string;
    startDate: string;
    endDate: string;
    groups: RosterGroupStructure[];
    appliedTemplateIds: string[];
}




















// ============================================================
// HELPER FUNCTIONS
// ============================================================








