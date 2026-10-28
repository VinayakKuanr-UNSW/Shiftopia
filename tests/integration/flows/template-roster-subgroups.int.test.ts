/**
 * Templates → rosters, over HTTP (migration 20261017111129).
 *
 * A template sub-group reaches a roster by NAME, so the name is a key inside its
 * group, and every sub-group operation must stay inside the group and the
 * sub-department it was asked about, leave days before today alone, and need the
 * right permissions. Office keeps exactly one sub-group, Administration.
 *
 * Callers: G2 is the gamma of S2, the sub-department these rosters belong to;
 * G is the gamma of S1 (same department); X is an employee.
 *
 * Fixture days are relative to today: F is a Wednesday about a month out, F2 the
 * day after, P a Wednesday in the past.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { personaClient, personaId, stack } from '../support/clients';
import { psql, resetFixtures } from '../support/stack';

const ORG = '00000000-0000-0000-0000-000000000001';
const D1 = '54c4c466-8d56-41c1-bf36-98ee4d7364f3';
const S2 = 'ed004483-7cb4-40cf-a151-57053e009ea8';

const R_F  = 'e4000000-0000-4000-8000-000000000001';
const R_F2 = 'e4000000-0000-4000-8000-000000000002';
const R_P  = 'e4000000-0000-4000-8000-000000000003';
const SH_CONV_F = 'e5000000-0000-4000-8000-000000000001'; // Convention "AM Base", F
const SH_TH_F   = 'e5000000-0000-4000-8000-000000000002'; // Theatre "AM Base", F
const SH_TH_P   = 'e5000000-0000-4000-8000-000000000003'; // Theatre "AM Base", P (past)
const T1 = 'e6000000-0000-4000-8000-000000000001';
const T2 = 'e6000000-0000-4000-8000-000000000002';

function db(sql: string): string[][] {
    return psql(stack().dbContainer, sql);
}

const exists = (table: string, id: string) =>
    db(`SELECT count(*) FROM public.${table} WHERE id = '${id}'`)[0][0] === '1';

let F = '';
let F2 = '';
let P = '';

function setUp(): void {
    db(`
        SET app.shift_purge = 'user';
        DELETE FROM public.shifts WHERE roster_id IN (SELECT id FROM public.rosters WHERE id::text LIKE 'e4000000-%');
        DELETE FROM public.rosters WHERE id::text LIKE 'e4000000-%';
        DELETE FROM public.roster_templates WHERE id::text LIKE 'e6000000-%';
        RESET app.shift_purge;

        WITH d AS (SELECT (now() AT TIME ZONE 'Australia/Sydney')::date AS today),
        days AS (
            SELECT today + 30 + ((3 - extract(dow FROM today + 30)::int + 7) % 7) AS f,
                   today - 7  - ((extract(dow FROM today - 7)::int - 3 + 7) % 7)  AS p
              FROM d)
        INSERT INTO public.rosters (id, organization_id, department_id, sub_department_id, start_date, end_date, status, is_locked)
        SELECT '${R_F}'::uuid,  '${ORG}'::uuid, '${D1}'::uuid, '${S2}'::uuid, f,     f,     'draft'::roster_status, false FROM days UNION ALL
        SELECT '${R_F2}', '${ORG}', '${D1}', '${S2}', f + 1, f + 1, 'draft', false FROM days UNION ALL
        SELECT '${R_P}',  '${ORG}', '${D1}', '${S2}', p,     p,     'draft', false FROM days;

        INSERT INTO public.roster_subgroups (roster_group_id, name)
        SELECT g.id, s.name
          FROM (VALUES ('${R_F}', 'convention_centre', 'AM Base'),
                       ('${R_F}', 'theatre', 'AM Base'),
                       ('${R_P}', 'theatre', 'AM Base'),
                       ('${R_F2}', 'theatre', 'AM Base'),
                       ('${R_F2}', 'theatre', 'PM Base')) AS s(roster_id, ext, name)
          JOIN public.roster_groups g ON g.roster_id = s.roster_id::uuid AND g.external_id = s.ext;

        INSERT INTO public.shifts (id, roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id,
                                   shift_date, start_time, end_time, target_employment_type)
        SELECT s.id::uuid, r.id, rs.id, '${ORG}', '${D1}', '${S2}', r.start_date, '09:00', '12:00', 'Casual'
          FROM (VALUES ('${SH_CONV_F}', '${R_F}', 'convention_centre'),
                       ('${SH_TH_F}',   '${R_F}', 'theatre'),
                       ('${SH_TH_P}',   '${R_P}', 'theatre')) AS s(id, roster_id, ext)
          JOIN public.rosters r          ON r.id = s.roster_id::uuid
          JOIN public.roster_groups g    ON g.roster_id = r.id AND g.external_id = s.ext
          JOIN public.roster_subgroups rs ON rs.roster_group_id = g.id AND rs.name = 'AM Base';
    `);
    const [[f, f2, p]] = db(`SELECT (SELECT start_date FROM public.rosters WHERE id = '${R_F}'),
                                    (SELECT start_date FROM public.rosters WHERE id = '${R_F2}'),
                                    (SELECT start_date FROM public.rosters WHERE id = '${R_P}')`);
    F = f; F2 = f2; P = p;
}

const scope = (group: string, start = P, end = F2) => ({
    p_org_id: ORG, p_dept_id: D1, p_sub_dept_id: S2, p_group_external_id: group,
    p_start_date: start, p_end_date: end,
});

beforeEach(() => {
    resetFixtures(stack().dbContainer);
    setUp();
});

describe('deleting a roster sub-group', () => {
    it('previews without changing anything, then deletes only that group, from today on', async () => {
        const dry = await personaClient('G2').rpc('delete_roster_subgroup_v2', {
            ...scope('theatre', P, F), p_name: 'am base', p_dry_run: true,
        });
        expect(dry.error).toBeNull();
        expect(dry.data).toMatchObject({ days: 1, shifts_deleted: 1, past_days: 1, past_shifts: 1, shifts_kept: 0 });
        expect(exists('shifts', SH_TH_F)).toBe(true);

        const real = await personaClient('G2').rpc('delete_roster_subgroup_v2', { ...scope('theatre', P, F), p_name: 'AM Base' });
        expect(real.error).toBeNull();
        expect(exists('shifts', SH_TH_F)).toBe(false);
        // Regression: the old RPC matched the NAME only, so Convention's "AM Base" went too.
        expect(exists('shifts', SH_CONV_F)).toBe(true);
        // Regression: a past shift in range used to abort the whole delete; now it simply stays.
        expect(exists('shifts', SH_TH_P)).toBe(true);
    });

    it.each([
        ['X', 'an employee'],
        ['G', 'the gamma of another sub-department'],
        ['D', 'the department\'s delta — view-only'],
    ] as const)('refuses %s (%s) and deletes nothing', async (p, _who) => {
        const r = await personaClient(p).rpc('delete_roster_subgroup_v2', { ...scope('theatre'), p_name: 'AM Base' });
        expect(r.error?.code).toBe('42501');
        expect(exists('shifts', SH_TH_F)).toBe(true);
    });

    it('will not delete Office\'s Administration', async () => {
        const r = await personaClient('G2').rpc('delete_roster_subgroup_v2', { ...scope('office'), p_name: 'Administration' });
        expect(r.error?.message).toMatch(/Administration/);
    });
});

describe('cloning a roster sub-group', () => {
    // Regression: clone_roster_subgroup_v2 had no permission check at all until 2026-10-17.
    it('refuses an employee', async () => {
        const r = await personaClient('X').rpc('clone_roster_subgroup_v2', {
            ...scope('theatre'), p_source_name: 'AM Base', p_new_name: 'Copy',
        });
        expect(r.error?.code).toBe('42501');
        expect(db(`SELECT count(*) FROM public.roster_subgroups WHERE name = 'Copy'`)[0][0]).toBe('0');
    });

    it('copies that group\'s shifts from today on, and only that group\'s', async () => {
        const r = await personaClient('G2').rpc('clone_roster_subgroup_v2', {
            ...scope('theatre'), p_source_name: 'AM Base', p_new_name: 'AM Base 2',
        });
        expect(r.error).toBeNull();
        expect(r.data).toMatchObject({ days: 2, shifts_copied: 1, past_days: 1 });
        const [[copies, inConvention]] = db(`
            SELECT count(*) FILTER (WHERE g.external_id = 'theatre'), count(*) FILTER (WHERE g.external_id = 'convention_centre')
              FROM public.shifts s
              JOIN public.roster_subgroups rs ON rs.id = s.roster_subgroup_id
              JOIN public.roster_groups g ON g.id = rs.roster_group_id
             WHERE rs.name = 'AM Base 2'`);
        expect([copies, inConvention]).toEqual(['1', '0']);
    });
});

describe('renaming a roster sub-group', () => {
    it('reports and refuses a name the group already uses on a day in range', async () => {
        const dry = await personaClient('G2').rpc('rename_roster_subgroup_v2', {
            ...scope('theatre', F, F2), p_old_name: 'AM Base', p_new_name: 'pm base', p_dry_run: true,
        });
        expect(dry.data).toMatchObject({ days: 2, conflicts: [F2] });

        const real = await personaClient('G2').rpc('rename_roster_subgroup_v2', {
            ...scope('theatre', F, F2), p_old_name: 'AM Base', p_new_name: 'pm base',
        });
        expect(real.error?.code).toBe('23505');
        expect(db(`SELECT sub_group_name FROM public.shifts WHERE id = '${SH_TH_F}'`)[0][0]).toBe('AM Base');
    });

    it('renames from today on and moves the shifts with it', async () => {
        const r = await personaClient('G2').rpc('rename_roster_subgroup_v2', {
            ...scope('theatre'), p_old_name: 'AM Base', p_new_name: 'Morning',
        });
        expect(r.error).toBeNull();
        expect(db(`SELECT sub_group_name FROM public.shifts WHERE id = '${SH_TH_F}'`)[0][0]).toBe('Morning');
        expect(db(`SELECT sub_group_name FROM public.shifts WHERE id = '${SH_TH_P}'`)[0][0]).toBe('AM Base');
    });
});

describe('Office keeps one sub-group, Administration', () => {
    const officeGroup = () => db(`SELECT id FROM public.roster_groups WHERE roster_id = '${R_F}' AND external_id = 'office'`)[0][0];

    it('refuses another Office sub-group, even through the table', async () => {
        const r = await personaClient('G2').from('roster_subgroups').insert({ roster_group_id: officeGroup(), name: 'Front desk' });
        expect(r.error?.code).toBe('23514');
    });

    it('refuses deleting Administration through the table', async () => {
        const r = await personaClient('G2').from('roster_subgroups').delete().eq('roster_group_id', officeGroup());
        expect(r.error?.code).toBe('23514');
        expect(db(`SELECT count(*) FROM public.roster_subgroups WHERE roster_group_id = '${officeGroup()}'`)[0][0]).toBe('1');
    });

    it('gives every new template Office with Administration', () => {
        db(`INSERT INTO public.roster_templates (id, name, organization_id, department_id, sub_department_id, status)
            VALUES ('${T1}', 'Int T1', '${ORG}', '${D1}', '${S2}', 'draft')`);
        expect(db(`SELECT ts.name FROM public.template_subgroups ts JOIN public.template_groups tg ON tg.id = ts.group_id
                    WHERE tg.template_id = '${T1}' AND tg.name = 'Office'`)).toEqual([['Administration']]);
    });
});

describe('a second template adds on top', () => {
    function makeTemplate(id: string, name: string, subGroup: string) {
        db(`
            INSERT INTO public.roster_templates (id, name, organization_id, department_id, sub_department_id, status)
            VALUES ('${id}', '${name}', '${ORG}', '${D1}', '${S2}', 'draft');
            WITH sg AS (
                INSERT INTO public.template_subgroups (group_id, name)
                SELECT id, '${subGroup}' FROM public.template_groups WHERE template_id = '${id}' AND name = 'Theatre'
                RETURNING id)
            INSERT INTO public.template_shifts (subgroup_id, start_time, end_time, target_employment_type, day_of_week)
            SELECT id, '14:00', '17:00', 'Casual', NULL FROM sg;
        `);
    }
    const apply = (templateId: string) => personaClient('G2').rpc('apply_template_to_date_range_v2', {
        p_template_id: templateId, p_start_date: F2, p_end_date: F2, p_user_id: personaId('G2'),
        p_source: 'roster_modal', p_target_department_id: D1, p_target_sub_department_id: S2,
    });
    const preview = (templateId: string) => personaClient('G2').rpc('preview_template_application', {
        p_template_id: templateId, p_start_date: F2, p_end_date: F2,
        p_target_department_id: D1, p_target_sub_department_id: S2,
    });
    const amBaseOnF2 = () => db(`
        SELECT count(DISTINCT rs.id), count(s.id)
          FROM public.roster_subgroups rs
          JOIN public.roster_groups g ON g.id = rs.roster_group_id AND g.roster_id = '${R_F2}' AND g.external_id = 'theatre'
          LEFT JOIN public.shifts s ON s.roster_subgroup_id = rs.id
         WHERE lower(rs.name) = 'am base'`)[0];

    it('merges by name whatever the case, stacks, previews honestly, and undoes one application', async () => {
        makeTemplate(T1, 'Int T1', 'am base');
        makeTemplate(T2, 'Int T2', 'AM BASE');

        expect((await preview(T1)).data).toMatchObject({ would_create: 1, already_applied: 0, duplicates: 0 });
        const a1 = await apply(T1);
        expect(a1.data).toMatchObject({ shifts_created: 1 });
        expect(amBaseOnF2()).toEqual(['1', '1']); // into the existing "AM Base", no second sub-group

        expect((await apply(T1)).data).toMatchObject({ shifts_created: 0 }); // same template again: skipped

        const p2 = await preview(T2);
        expect(p2.data).toMatchObject({ would_create: 1, duplicates: 1 });
        expect(p2.data.existing_templates).toEqual([expect.objectContaining({ template_id: T1, is_this_template: false })]);
        const a2 = await apply(T2);
        expect(amBaseOnF2()).toEqual(['1', '2']); // on top, not instead

        const dry = await personaClient('G2').rpc('undo_template_batch', { p_batch_id: a2.data.batch_id, p_dry_run: true });
        expect(dry.data).toMatchObject({ success: true, shifts_deleted: 1, shifts_kept: 0 });
        expect(amBaseOnF2()).toEqual(['1', '2']);

        const undo = await personaClient('G2').rpc('undo_template_batch', { p_batch_id: a2.data.batch_id });
        expect(undo.error).toBeNull();
        expect(undo.data).toMatchObject({ success: true, shifts_deleted: 1 });
        expect(amBaseOnF2()).toEqual(['1', '1']); // T1's shift is untouched
    });
});

describe('client grants', () => {
    it('no client role can run the unguarded legacy writers', () => {
        const rows = db(`
            SELECT p.oid::regprocedure::text
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname IN ('clone_roster_subgroup', 'apply_monthly_template')
               AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))`);
        expect(rows).toEqual([]);
    });
});
