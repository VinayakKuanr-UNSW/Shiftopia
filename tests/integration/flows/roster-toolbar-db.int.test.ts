/**
 * The database half of the Roster Planner toolbar audit (2026-10-18), over
 * HTTP — migration 20261018075304_roster_toolbar_audit_db_fixes.
 *
 * Persona fixtures as in shift-lifecycle.int.test.ts: S1 (assigned X, Casual)
 * and S2 (unassigned) are Draft shifts on 2026-12-01 in department D1; G2 is the
 * gamma of S2's sub-department.
 *
 * Not covered here: the row lock in sm_bulk_publish_shifts (two sessions racing
 * on one shift). It rests on PostgreSQL's FOR UPDATE semantics; the publish
 * results below pin that the lock changed nothing else.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { personaClient, personaId, stack } from '../support/clients';
import { psql, resetFixtures } from '../support/stack';

const ORG = '00000000-0000-0000-0000-000000000001';
const D1 = '54c4c466-8d56-41c1-bf36-98ee4d7364f3';
const SUB_S2 = 'ed004483-7cb4-40cf-a151-57053e009ea8';
const S1 = 'b1000000-0000-4000-8000-000000000001';
const S2 = 'b1000000-0000-4000-8000-000000000002';
const T9 = 'e6000000-0000-4000-8000-000000000009';

function db(sql: string): string[][] {
    return psql(stack().dbContainer, sql);
}

beforeEach(() => resetFixtures(stack().dbContainer));

describe('sm_bulk_publish_shifts — lock first, then decide', () => {
    it('publishes a draft once; a second call changes nothing', async () => {
        const first = await personaClient('G2').rpc('sm_bulk_publish_shifts', { p_shift_ids: [S2], p_actor_id: personaId('G2') });
        expect(first.data).toMatchObject({ success: true, success_count: 1, failure_count: 0 });
        const [[version, publishedAt, bidding]] = db(`SELECT version, published_at, bidding_status FROM public.shifts WHERE id = '${S2}'`);
        expect(bidding).toBe('on_bidding');

        const second = await personaClient('G2').rpc('sm_bulk_publish_shifts', { p_shift_ids: [S2], p_actor_id: personaId('G2') });
        expect(second.data).toMatchObject({ success: true, success_count: 0, failure_count: 1 });
        expect(db(`SELECT version, published_at FROM public.shifts WHERE id = '${S2}'`)).toEqual([[version, publishedAt]]);
    });

    it('still refuses the whole batch when any shift is outside the caller\'s scope', async () => {
        const r = await personaClient('G2').rpc('sm_bulk_publish_shifts', { p_shift_ids: [S2, S1], p_actor_id: personaId('G2') });
        expect(r.data).toMatchObject({ success: false });
        expect(r.data.error).toMatch(/not authorised/i);
        expect(db(`SELECT lifecycle_status FROM public.shifts WHERE id = '${S2}'`)).toEqual([['Draft']]);
    });
});

describe('trg_shift_notifications — confirmed is not an offer', () => {
    const notice = (id: string) => db(`SELECT title, message FROM public.notifications WHERE dedup_key = 'SHIFT_ASSIGNED_${id}'`);

    // The notice is deduped per shift and fixtures reset doesn't clear it: without this the
    // second test reads the first test's row.
    beforeEach(() => { db(`DELETE FROM public.notifications WHERE dedup_key = 'SHIFT_ASSIGNED_${S1}'`); });

    it('a shift published straight to Confirmed tells the employee it is confirmed', () => {
        db(`UPDATE public.shifts
               SET lifecycle_status = 'Published', assignment_outcome = 'confirmed',
                   fulfillment_status = 'scheduled', confirmed_at = now(), published_at = now()
             WHERE id = '${S1}'`);

        const [[title, message]] = notice(S1);
        expect(title).toBe('Shift confirmed');
        expect(message).not.toMatch(/accept or decline/i);
    });

    it('a shift published as an offer still asks the employee to accept or decline', () => {
        db(`UPDATE public.shifts
               SET lifecycle_status = 'Published', assignment_outcome = NULL,
                   fulfillment_status = 'offered', offer_sent_at = now(), published_at = now()
             WHERE id = '${S1}'`);

        const [[title, message]] = notice(S1);
        expect(title).toBe('New shift offer');
        expect(message).toMatch(/accept or decline/i);
    });
});

describe('add_roster_subgroup_range — bounded, by the Sydney date', () => {
    const call = (start: string, end: string) => personaClient('G2').rpc('add_roster_subgroup_range', {
        p_org_id: ORG, p_dept_id: D1, p_sub_dept_id: SUB_S2, p_group_external_id: 'theatre',
        p_name: 'Int Range', p_start_date: start, p_end_date: end,
    });
    const sydneyDay = (offset: number) =>
        db(`SELECT ((now() AT TIME ZONE 'Australia/Sydney')::date + ${offset})::text`)[0][0];

    it('refuses a backwards range', async () => {
        const r = await call(sydneyDay(20), sydneyDay(10));
        expect(r.error?.code).toBe('22023');
    });

    it('refuses a range over 366 days', async () => {
        const r = await call(sydneyDay(1), sydneyDay(400));
        expect(r.error?.code).toBe('22023');
        expect(r.error?.message).toMatch(/366/);
    });

    it('never adds the sub-group to a day already past in Sydney', async () => {
        const yesterday = sydneyDay(-1);
        const r = await call(yesterday, yesterday);
        expect(r.error).toBeNull();
        expect(db(`SELECT count(*) FROM public.rosters
                    WHERE sub_department_id = '${SUB_S2}' AND start_date = '${yesterday}'
                      AND id IN (SELECT g.roster_id FROM public.roster_groups g
                                   JOIN public.roster_subgroups s ON s.roster_group_id = g.id
                                  WHERE s.name = 'Int Range')`)[0][0]).toBe('0');
    });
});

describe('apply_template_to_date_range_v2 — the caller is the actor', () => {
    it('records the signed-in manager, not the user id the client sent', async () => {
        const day = db(`SELECT ((now() AT TIME ZONE 'Australia/Sydney')::date + 35)::text`)[0][0];
        db(`
            DELETE FROM public.roster_templates WHERE id = '${T9}';
            INSERT INTO public.roster_templates (id, name, organization_id, department_id, sub_department_id, status)
            VALUES ('${T9}', 'Int T9', '${ORG}', '${D1}', '${SUB_S2}', 'draft');
            WITH sg AS (
                INSERT INTO public.template_subgroups (group_id, name)
                SELECT id, 'Int Actor' FROM public.template_groups WHERE template_id = '${T9}' AND name = 'Theatre'
                RETURNING id)
            INSERT INTO public.template_shifts (subgroup_id, start_time, end_time, target_employment_type, day_of_week)
            SELECT id, '14:00', '17:00', 'Casual', NULL FROM sg;
        `);

        const r = await personaClient('G2').rpc('apply_template_to_date_range_v2', {
            p_template_id: T9, p_start_date: day, p_end_date: day, p_user_id: personaId('X'),
            p_source: 'roster_modal', p_target_department_id: D1, p_target_sub_department_id: SUB_S2, p_force_stack: false,
        });
        expect(r.error).toBeNull();
        expect(r.data).toMatchObject({ success: true, shifts_created: 1 });

        const batch = r.data.batch_id as string;
        expect(db(`SELECT applied_by::text FROM public.roster_template_batches WHERE id = '${batch}'`)).toEqual([[personaId('G2')]]);
        expect(db(`SELECT DISTINCT created_by_user_id::text FROM public.shifts WHERE template_batch_id = '${batch}'`)).toEqual([[personaId('G2')]]);
    });
});
