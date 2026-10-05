/**
 * Where a proposed shift actually lands.
 *
 * `shifts.roster_subgroup_id` is NOT NULL, so every candidate needs a resolved
 * roster → group → subgroup before it can be written. There is no
 * `sm_resolve_roster` in production — the repo migration for it was never
 * applied — so this resolves the chain itself, following the same shape the
 * shift synthesiser already uses.
 *
 * IT NEVER CREATES A ROSTER. Rostering periods are a deliberate act with their
 * own dates and lifecycle, and inventing one as a side effect of Apply would
 * produce a roster nobody planned, sitting outside whatever period the team
 * actually works to. A missing roster is reported as a skip with a reason the
 * manager can act on, which is the honest failure.
 *
 * IT WILL NOT ADD TO A PUBLISHED OR LOCKED ROSTER. cl 38.2 gives full-time,
 * part-time and flexible part-time Team Members 48 hours' notice of a roster
 * change, and a Draft shift dropped into a published roster produces a roster
 * in two states that the publish workflow was not built to reconcile.
 */

import { supabase } from '@/platform/supabase/client';

export interface RosterTargetArgs {
    subDepartmentId: string;
    departmentId: string;
    organizationId: string;
    shiftDate: string;
}

export interface RosterTarget {
    rosterId: string;
    rosterSubgroupId: string;
    /**
     * The DENORMALISED group, normalised the way `getRosterStructure` does it:
     * lower-cased with spaces underscored, so "Convention Centre" becomes
     * "convention_centre".
     *
     * Carried because `shifts.roster_subgroup_id` is the structural link but is
     * NOT what the Roster Planner buckets on — `GroupModeView` filters its
     * cells with `cell.group_type === group.type`. A shift written with a
     * correct subgroup and a null `group_type` is parented properly and appears
     * in no group at all, which is exactly what happened to the first 39 shifts
     * Baseline created.
     */
    groupType: string;
    /** Matches the subgroup row the Planner draws — always "Administration". */
    subGroupName: string;
}

/**
 * Where an Office shift is parented: the roster's Office group, in its fixed
 * sub-group "Administration".
 *
 * Office is the fifth fixed roster group (migrations 20261004160000/160100).
 * Every roster carries it, seeded with Administration, so the lookup below
 * normally finds both. Until then these shifts were parked in Convention Centre
 * under a sub-group of the same name, because a group of their own needed the
 * enum value, the allow-list trigger, the seeding and template-apply functions,
 * and every client-side group→colour map.
 *
 * THIS MODULE NEVER INSERTS A GROUP. `roster_groups` carries a live BEFORE
 * INSERT trigger, `trigger_enforce_exactly_three_groups`, which RAISEs unless
 * `external_id` is one of the five fixed groups — NULL included. A missing group
 * means a malformed roster, reported rather than repaired from here.
 *
 * Resolved by `external_id`, not by name: the id is the stable key and is what
 * `enforce_exactly_three_groups` itself checks.
 */
export const OFFICE_GROUP_EXTERNAL_ID = 'office';
export const OFFICE_SUBGROUP_NAME = 'Administration';

/**
 * Resolve the draft roster covering `shiftDate` for this sub-department, and a
 * subgroup within it.
 *
 * Throws with a message meant for a manager, because Apply surfaces it verbatim
 * as the skip reason on the affected candidate.
 */
export async function resolveRosterTarget(args: RosterTargetArgs): Promise<RosterTarget> {
    const { subDepartmentId, shiftDate } = args;

    const { data: rosters, error } = await supabase
        .from('rosters')
        .select('id, status, is_locked, start_date, end_date')
        .eq('sub_department_id', subDepartmentId)
        .lte('start_date', shiftDate)
        .gte('end_date', shiftDate)
        .order('start_date', { ascending: false });

    if (error) throw new Error(`Could not read rosters: ${error.message}`);

    const covering = (rosters ?? []) as Array<{
        id: string; status: string | null; is_locked: boolean | null;
    }>;

    if (covering.length === 0) {
        throw new Error(
            `No roster covers ${shiftDate} for this team. Create the roster period first, ` +
            `then apply the baseline.`,
        );
    }

    const draft = covering.find(r => !r.is_locked && String(r.status ?? '') === 'draft');
    if (!draft) {
        throw new Error(
            `The roster covering ${shiftDate} is published or locked, so shifts cannot be added ` +
            `to it. Changing a published roster needs 48 hours' notice (ICC EBA cl 38.2).`,
        );
    }

    const subgroup = await resolveSubgroup(draft.id);
    return { rosterId: draft.id, ...subgroup };
}

/**
 * "Convention Centre" -> "convention_centre".
 *
 * Must agree with THREE other things, which is why it is exported and tested:
 *   - `getRosterStructure`, which normalises the same way to build the planner's
 *     group list;
 *   - `GroupModeView`, which buckets cells with `cell.group_type === group.type`;
 *   - the Postgres enum `template_group_type`, whose five labels are exactly
 *     `convention_centre, exhibition_centre, theatre, the_cutaway, office`.
 *
 * A value that is merely plausible is not enough: `shifts.group_type` is that
 * enum, so a wrong transform is a 22P02 at write time, and a missing one is a
 * shift that renders in no group at all.
 */
export function normaliseGroupName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '_');
}

/**
 * The Administration subgroup on this roster, created on first use.
 *
 * It does NOT fall back to "any subgroup that already exists". That fallback is
 * why every Office shift in production landed in `AM Base` — a subgroup a
 * manager had made for something else entirely — so the group and sub-group on
 * those 39 rows say nothing about what they are. Office shifts get one home, and
 * always the same one.
 */
async function resolveSubgroup(
    rosterId: string,
): Promise<Omit<RosterTarget, 'rosterId'>> {
    const { data: group, error } = await supabase
        .from('roster_groups')
        .select('id, name, roster_subgroups(id, name)')
        .eq('roster_id', rosterId)
        .eq('external_id', OFFICE_GROUP_EXTERNAL_ID)
        .maybeSingle();

    if (error) throw new Error(`Could not read roster groups: ${error.message}`);
    if (!group) {
        // Every roster in production has this group; it is seeded when the roster
        // is created. Its absence means the roster is malformed, which is a thing
        // to report rather than repair from here — creating a group is precisely
        // what the trigger forbids.
        throw new Error(
            'This roster has no Office group, so there is nowhere to put '
            + 'a full-time shift. Recreate the roster, or add the group first.',
        );
    }

    const g = group as unknown as {
        id: string;
        name: string;
        roster_subgroups?: Array<{ id: string; name: string }>;
    };

    const own = (g.roster_subgroups ?? []).find(s => s.name === OFFICE_SUBGROUP_NAME);
    if (own) {
        return {
            rosterSubgroupId: own.id,
            groupType: normaliseGroupName(g.name),
            subGroupName: own.name,
        };
    }

    const { data: sub, error: sErr } = await supabase
        .from('roster_subgroups')
        .insert({
            roster_group_id: g.id,
            name: OFFICE_SUBGROUP_NAME,
            sort_order: 0,
            // Both are NOT NULL with no default. A subgroup that exists to hold
            // one person's contracted day has no coverage target of its own.
            required_headcount: 0,
            min_headcount: 0,
        })
        .select('id')
        .single();
    if (sErr || !sub) {
        throw new Error(
            `Could not create the Administration subgroup: ${sErr?.message ?? 'unknown error'}`);
    }

    return {
        rosterSubgroupId: String(sub.id),
        groupType: normaliseGroupName(g.name),
        subGroupName: OFFICE_SUBGROUP_NAME,
    };
}

/* ────────────────────────────────────────────────────────────────────────────
   Pre-flight
   ──────────────────────────────────────────────────────────────────────────── */

export interface RosterCoverage {
    /** Dates in the window with a draft, unlocked roster — where Apply can write. */
    writable: Set<string>;
    /** Dates whose only covering roster is published or locked (cl 38.2). */
    lockedOut: Set<string>;
}

/**
 * Which dates in a window Apply could actually write into.
 *
 * Exists so the answer arrives BEFORE the button rather than as forty skip
 * reasons after it. `resolveRosterTarget` refuses a missing or published
 * roster — correctly — but discovering that one candidate at a time, after
 * committing, is the worst moment to learn it. Free date navigation makes
 * landing on an uncovered window routine rather than exceptional.
 *
 * Read-only, and never creates anything.
 */
export async function loadRosterCoverage(
    subDepartmentId: string,
    fromDate: string,
    toDate: string,
): Promise<RosterCoverage> {
    const { data, error } = await supabase
        .from('rosters')
        .select('id, status, is_locked, start_date, end_date')
        .eq('sub_department_id', subDepartmentId)
        .lte('start_date', toDate)
        .gte('end_date', fromDate);

    if (error) throw new Error(`Could not read rosters: ${error.message}`);

    const writable = new Set<string>();
    const covered = new Set<string>();

    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const isDraft = !row.is_locked && String(row.status ?? '') === 'draft';
        // Iterate the intersection of the roster and the window, so a roster
        // spanning a year does not expand into a year of dates.
        const from = String(row.start_date) > fromDate ? String(row.start_date) : fromDate;
        const to = String(row.end_date) < toDate ? String(row.end_date) : toDate;

        for (let d = new Date(`${from}T00:00:00Z`);
             d <= new Date(`${to}T00:00:00Z`);
             d = new Date(d.getTime() + 86_400_000)) {
            const date = d.toISOString().slice(0, 10);
            covered.add(date);
            if (isDraft) writable.add(date);
        }
    }

    // Covered by SOMETHING, but not by anything writable. A different problem
    // from "no roster at all", and a different remedy — one needs a roster
    // created, the other needs 48 hours' notice of a change (cl 38.2).
    const lockedOut = new Set([...covered].filter(d => !writable.has(d)));
    return { writable, lockedOut };
}
