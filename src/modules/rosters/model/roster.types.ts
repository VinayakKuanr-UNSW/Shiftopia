






// Hierarchy Data Structure (for useRosterStructure)
export interface RosterSubGroupStructure {
    id: string;
    name: string;
    sortOrder: number;
}

export interface RosterGroupStructure {
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


/**
 * Get group color by name
 */
export function getGroupColor(name: string | null | undefined): string {
    const n = (name || '').toLowerCase();
    if (n.includes('convention')) return 'convention_centre';
    if (n.includes('exhibition')) return 'exhibition_centre';
    if (n.includes('theatre')) return 'theatre';
    if (n.includes('cutaway')) return 'the_cutaway';
    if (n === 'office') return 'office';
    return 'default_yellow';
}






