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
}

/** Group a baseline shift belongs to when one has to be created. */
const BASELINE_GROUP_NAME = 'Baseline';
const BASELINE_SUBGROUP_NAME = 'Full-Time';

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

    return {
        rosterId: draft.id,
        rosterSubgroupId: await resolveSubgroup(draft.id),
    };
}

/**
 * A subgroup on this roster, creating the baseline one only if the roster has
 * none at all.
 *
 * Prefers a subgroup that already exists, because a roster's groups are how a
 * manager has chosen to organise their team and a generator should slot into
 * that rather than impose a parallel structure beside it.
 */
async function resolveSubgroup(rosterId: string): Promise<string> {
    const { data: groups, error } = await supabase
        .from('roster_groups')
        .select('id, name, roster_subgroups(id, name)')
        .eq('roster_id', rosterId);

    if (error) throw new Error(`Could not read roster groups: ${error.message}`);

    const existing = (groups ?? []) as Array<{
        id: string;
        name: string;
        roster_subgroups?: Array<{ id: string; name: string }>;
    }>;

    // A subgroup this generator made earlier — the most specific match.
    for (const g of existing) {
        if (g.name !== BASELINE_GROUP_NAME) continue;
        const own = (g.roster_subgroups ?? []).find(s => s.name === BASELINE_SUBGROUP_NAME);
        if (own) return own.id;
    }

    // Any subgroup at all. The manager's own structure beats a new one.
    for (const g of existing) {
        const first = (g.roster_subgroups ?? [])[0];
        if (first) return first.id;
    }

    // The roster has no subgroups. Make the baseline one.
    let groupId = existing.find(g => g.name === BASELINE_GROUP_NAME)?.id;
    if (!groupId) {
        const { data: created, error: gErr } = await supabase
            .from('roster_groups')
            .insert({ roster_id: rosterId, name: BASELINE_GROUP_NAME, sort_order: 0 })
            .select('id')
            .single();
        if (gErr || !created) {
            throw new Error(`Could not create a roster group: ${gErr?.message ?? 'unknown error'}`);
        }
        groupId = String(created.id);
    }

    const { data: sub, error: sErr } = await supabase
        .from('roster_subgroups')
        .insert({ roster_group_id: groupId, name: BASELINE_SUBGROUP_NAME, sort_order: 0 })
        .select('id')
        .single();
    if (sErr || !sub) {
        throw new Error(`Could not create a roster subgroup: ${sErr?.message ?? 'unknown error'}`);
    }
    return String(sub.id);
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
