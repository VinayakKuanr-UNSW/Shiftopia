-- Retire the 14 pre-catalogue sub-departments and 2 departments.
--
-- 20261008130022 / 20261008215856 loaded the ICC catalogue (14 departments,
-- 75 sub-departments, 374 roles) beside the old structure. These are the old
-- rows that are not in the catalogue. Prod has no shifts (2026-10-09), so what
-- hangs off them is roster shells, availability, contracts and config.
--
-- THREE CARRY DATA AND ARE MERGED INTO THEIR CATALOGUE EQUIVALENT. The legacy
-- row KEEPS ITS UUID — every roster, availability slot, contract and access
-- certificate already points at it — and takes the catalogue name and
-- department. The empty catalogue duplicate's roles move across, same-named
-- duplicates are dropped (the legacy role, which contracts reference, stays).
--   Event Delivery / Set-up         → Events / Event Setup        (365 rosters, 181 availability slots, both contracts, 1 access certificate, template, FT run, 3 planning periods)
--   Live Entertainment / Front of House → Customer Services / Ushering  (6 rosters, the Usher role, 1 planning period)
--   Building Services / Security    → Security & Risk / Building Security (3 rosters, 1 planning period)
-- department_id is rewritten on every row that carries the moved sub-department.
--
-- ELEVEN ARE DELETED. Their only references are function_map rows (demand
-- engine: function code → sub-department), re-pointed to the catalogue first,
-- and — for Building Services / Operations — 31 roster shells with no shifts.
-- Then the two departments left empty ('Assets and Trades', 'Logistics').
--
-- SAFETY. hr.roles → hr.subdepartments is ON DELETE CASCADE, and
-- hr.user_contracts → hr.roles is ON DELETE CASCADE: deleting a sub-department
-- that still owns a referenced role would silently delete contracts. So every
-- delete is preceded by a check that nothing references the rows, and every
-- deleted row is copied to _backup_retired_structure_20261009 first.

-- ── 0. Backup ─────────────────────────────────────────────────────────────────
CREATE TABLE public._backup_retired_structure_20261009 (
    source      text        NOT NULL,
    row_data    jsonb       NOT NULL,
    backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._backup_retired_structure_20261009 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._backup_retired_structure_20261009 FROM PUBLIC, anon, authenticated;

CREATE TEMP TABLE _retire_ids (id uuid PRIMARY KEY, kind text NOT NULL) ON COMMIT DROP;
INSERT INTO _retire_ids VALUES
    -- folded catalogue duplicates
    ('522e1632-0f9d-4a88-8c55-1f619a37cc41', 'fold'),   -- Events / Event Setup
    ('ddbe96ab-2535-4b6e-93d5-343682e7cae4', 'fold'),   -- Customer Services / Ushering
    ('8c1e0cea-bf34-4cb8-a728-8577af12d344', 'fold'),   -- Security & Risk / Building Security
    -- deleted legacy sub-departments
    ('b0041153-0275-4ec1-a5e2-ebd73e1645dd', 'delete'), -- Assets and Trades / Electrical
    ('815e0c5d-8cad-4f4a-bda5-ec4c8527c43b', 'delete'), -- Assets and Trades / Facilities
    ('ffb835eb-bf40-4124-8484-ad08ca73b8eb', 'delete'), -- Assets and Trades / Maintenance
    ('6f762d2a-6697-44ee-9163-62b739165e8e', 'delete'), -- Assets and Trades / Mechanical
    ('96ad8905-395f-4f18-8d67-04f71d62687d', 'delete'), -- Building Services / Operations
    ('938d09c9-94c2-4eb4-b55e-f70ad054d19c', 'delete'), -- Event Delivery / Kitchen
    ('766ae5b3-ca30-41ba-8e18-3c9ce0f95512', 'delete'), -- Event Delivery / Logistics
    ('1f48ccc4-9053-46c2-81c0-8af84206c5fc', 'delete'), -- Event Delivery / Operations
    ('ff4b5399-b2a9-4f4c-9cc3-7041bfa33eb5', 'delete'), -- Event Delivery / Security
    ('8dd23f9c-3d61-418f-ae45-07c936cd616b', 'delete'), -- Live Entertainment / Technical
    ('33dcd02c-2789-4bb2-ad4b-5bec2e569dab', 'delete'); -- Logistics / Operations

INSERT INTO public._backup_retired_structure_20261009 (source, row_data)
SELECT 'hr.subdepartments', to_jsonb(s) FROM hr.subdepartments s WHERE s.id IN (SELECT id FROM _retire_ids)
UNION ALL
SELECT 'public.sub_departments', to_jsonb(s) FROM public.sub_departments s WHERE s.id IN (SELECT id FROM _retire_ids)
UNION ALL
SELECT 'hr.roles', to_jsonb(r) FROM hr.roles r
 WHERE r.subdepartment_id IN (SELECT id FROM _retire_ids)
    OR r.id = 'bb725bc6-3a19-4ab2-957f-6b57bcb18a9d'
UNION ALL
SELECT 'public.function_map', to_jsonb(f) FROM public.function_map f WHERE f.sub_department_id IN (SELECT id FROM _retire_ids)
UNION ALL
SELECT 'public.rosters', to_jsonb(r) FROM public.rosters r WHERE r.sub_department_id = '96ad8905-395f-4f18-8d67-04f71d62687d'
UNION ALL
SELECT 'public.roster_groups', to_jsonb(g) FROM public.roster_groups g
  JOIN public.rosters r ON r.id = g.roster_id WHERE r.sub_department_id = '96ad8905-395f-4f18-8d67-04f71d62687d'
UNION ALL
SELECT 'public.roster_subgroups', to_jsonb(sg) FROM public.roster_subgroups sg
  JOIN public.roster_groups g ON g.id = sg.roster_group_id
  JOIN public.rosters r ON r.id = g.roster_id WHERE r.sub_department_id = '96ad8905-395f-4f18-8d67-04f71d62687d'
UNION ALL
SELECT 'hr.departments', to_jsonb(d) FROM hr.departments d WHERE d.name IN ('Assets and Trades', 'Logistics')
UNION ALL
SELECT 'public.departments', to_jsonb(d) FROM public.departments d WHERE d.name IN ('Assets and Trades', 'Logistics');

-- ── Helpers (dropped at the end) ──────────────────────────────────────────────
-- Rewrites department_id on every base table that carries the sub-department.
CREATE FUNCTION pg_temp.move_subdepartment(p_sub uuid, p_dept uuid, p_name text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    UPDATE hr.subdepartments   SET name = p_name, department_id = p_dept, updated_at = now() WHERE id = p_sub;
    UPDATE public.sub_departments SET name = p_name, department_id = p_dept, updated_at = now() WHERE id = p_sub;
    FOR r IN
        SELECT c1.table_schema, c1.table_name
          FROM information_schema.columns c1
          JOIN information_schema.columns c2
            ON c2.table_schema = c1.table_schema AND c2.table_name = c1.table_name AND c2.column_name = 'department_id'
          JOIN information_schema.tables t
            ON t.table_schema = c1.table_schema AND t.table_name = c1.table_name AND t.table_type = 'BASE TABLE'
         WHERE c1.table_schema IN ('public', 'hr') AND c1.column_name = 'sub_department_id'
           AND c1.table_name <> 'sub_departments'
    LOOP
        EXECUTE format('UPDATE %I.%I SET department_id = $1 WHERE sub_department_id = $2 AND department_id IS DISTINCT FROM $1',
                       r.table_schema, r.table_name) USING p_dept, p_sub;
    END LOOP;
    UPDATE public.planning_periods SET department_id = p_dept WHERE p_sub = ANY (sub_department_ids);
END $$;

-- References to sub-department ids anywhere (uuid columns and uuid[] arrays).
CREATE FUNCTION pg_temp.subdepartment_refs(p_ids uuid[]) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r record; n bigint; res text := '';
BEGIN
    FOR r IN
        SELECT c.table_schema, c.table_name, c.column_name, c.data_type
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
         WHERE c.table_schema IN ('public', 'hr')
           AND c.table_name NOT IN ('subdepartments', 'sub_departments', '_backup_retired_structure_20261009')
           AND ((c.data_type = 'uuid' AND c.column_name IN ('sub_department_id', 'subdepartment_id'))
             OR (c.data_type = 'ARRAY' AND c.column_name IN ('sub_department_ids', 'subdepartment_ids')))
    LOOP
        IF r.data_type = 'uuid' THEN
            EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = ANY ($1)', r.table_schema, r.table_name, r.column_name) INTO n USING p_ids;
        ELSE
            EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I && $1', r.table_schema, r.table_name, r.column_name) INTO n USING p_ids;
        END IF;
        IF n > 0 THEN res := res || format('%s.%s.%s=%s ', r.table_schema, r.table_name, r.column_name, n); END IF;
    END LOOP;
    RETURN res;
END $$;

-- ── 1. Set-up → Events / Event Setup ─────────────────────────────────────────
-- Same-named catalogue roles are dropped; the legacy ones (contracts and the
-- template reference them) take the catalogue definition.
DELETE FROM hr.roles
 WHERE subdepartment_id = '522e1632-0f9d-4a88-8c55-1f619a37cc41'
   AND name IN ('Event Setup Supervisor', 'Event Setup Team Leader', 'Assistant Manager, Event Setup');
UPDATE hr.roles
   SET name = 'Assistant Manager, Event Setup', eba_level_min = NULL, eba_level_max = NULL,
       remuneration_level = NULL, typically_salaried = true, updated_at = now()
 WHERE id = 'bb725bc6-3a19-4ab2-957f-6b57bcb18a9d';
UPDATE hr.roles SET subdepartment_id = '6fefad95-9cf9-468c-8724-424cc2f7b640', updated_at = now()
 WHERE subdepartment_id = '522e1632-0f9d-4a88-8c55-1f619a37cc41';

-- ── 2. Front of House → Customer Services / Ushering ─────────────────────────
DELETE FROM hr.roles WHERE subdepartment_id = 'ddbe96ab-2535-4b6e-93d5-343682e7cae4' AND name = 'Usher';
UPDATE hr.roles SET subdepartment_id = 'a9209099-350d-4e9c-afb0-71f8ae50aee0', updated_at = now()
 WHERE subdepartment_id = 'ddbe96ab-2535-4b6e-93d5-343682e7cae4';

-- ── 3. Building Services / Security → Security & Risk / Building Security ────
UPDATE hr.roles SET subdepartment_id = 'af07db1d-89cc-4d90-9fff-e81a12c912f7', updated_at = now()
 WHERE subdepartment_id = '8c1e0cea-bf34-4cb8-a728-8577af12d344';

-- The emptied catalogue duplicates go before the renames (UNIQUE (department_id, name)).
DO $$
DECLARE v text;
BEGIN
    v := pg_temp.subdepartment_refs(ARRAY(SELECT id FROM _retire_ids WHERE kind = 'fold'));
    IF v <> '' THEN RAISE EXCEPTION 'catalogue duplicates still referenced: %', v; END IF;
    IF EXISTS (SELECT 1 FROM hr.roles WHERE subdepartment_id IN (SELECT id FROM _retire_ids WHERE kind = 'fold')) THEN
        RAISE EXCEPTION 'catalogue duplicates still own roles';
    END IF;
END $$;
DELETE FROM public.sub_departments WHERE id IN (SELECT id FROM _retire_ids WHERE kind = 'fold');
DELETE FROM hr.subdepartments      WHERE id IN (SELECT id FROM _retire_ids WHERE kind = 'fold');

SELECT pg_temp.move_subdepartment('6fefad95-9cf9-468c-8724-424cc2f7b640', 'c0000000-0000-0000-0000-000000000003', 'Event Setup');
SELECT pg_temp.move_subdepartment('a9209099-350d-4e9c-afb0-71f8ae50aee0', 'b9c69241-3e99-4e33-a135-c3169929f144', 'Ushering');
SELECT pg_temp.move_subdepartment('af07db1d-89cc-4d90-9fff-e81a12c912f7', 'c0000000-0000-0000-0000-000000000010', 'Building Security');

-- ── 4. function_map onto the catalogue ───────────────────────────────────────
INSERT INTO public.function_map (function_code, sub_department_id, weight, created_at, updated_at)
SELECT f.function_code, m.new_id, f.weight, f.created_at, now()
  FROM public.function_map f
  JOIN (VALUES
        ('ff4b5399-b2a9-4f4c-9cc3-7041bfa33eb5'::uuid, '129634db-7e75-4514-8f84-8b0db24011ee'::uuid), -- ED/Security        → Event Security
        ('96ad8905-395f-4f18-8d67-04f71d62687d'::uuid, 'af07db1d-89cc-4d90-9fff-e81a12c912f7'::uuid), -- BS/Operations      → Building Security
        ('938d09c9-94c2-4eb4-b55e-f70ad054d19c'::uuid, '05690496-2a8a-458c-806a-83b8d2b4c955'::uuid), -- ED/Kitchen         → Events & Catering Kitchen
        ('766ae5b3-ca30-41ba-8e18-3c9ce0f95512'::uuid, '380289f2-8f13-4a79-ae1d-52b9f7c6effd'::uuid), -- ED/Logistics       → Car Park & Logistics
        ('33dcd02c-2789-4bb2-ad4b-5bec2e569dab'::uuid, '380289f2-8f13-4a79-ae1d-52b9f7c6effd'::uuid)  -- Logistics/Operations → Car Park & Logistics
       ) AS m(old_id, new_id) ON m.old_id = f.sub_department_id
ON CONFLICT (function_code, sub_department_id) DO NOTHING;
-- ED/Operations (Logistics) and LE/Technical (AV) are already covered elsewhere.
DELETE FROM public.function_map WHERE sub_department_id IN (SELECT id FROM _retire_ids WHERE kind = 'delete');

-- ── 5. Building Services / Operations' roster shells (no shifts) ─────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.shifts s JOIN public.rosters r ON r.id = s.roster_id
                WHERE r.sub_department_id = '96ad8905-395f-4f18-8d67-04f71d62687d') THEN
        RAISE EXCEPTION 'Building Services / Operations rosters hold shifts — not deleting';
    END IF;
END $$;
DELETE FROM public.roster_subgroups WHERE roster_group_id IN (
    SELECT g.id FROM public.roster_groups g JOIN public.rosters r ON r.id = g.roster_id
     WHERE r.sub_department_id = '96ad8905-395f-4f18-8d67-04f71d62687d');
DELETE FROM public.roster_groups WHERE roster_id IN (
    SELECT id FROM public.rosters WHERE sub_department_id = '96ad8905-395f-4f18-8d67-04f71d62687d');
DELETE FROM public.rosters WHERE sub_department_id = '96ad8905-395f-4f18-8d67-04f71d62687d';

-- ── 6. Delete the eleven ─────────────────────────────────────────────────────
DO $$
DECLARE v text;
BEGIN
    v := pg_temp.subdepartment_refs(ARRAY(SELECT id FROM _retire_ids WHERE kind = 'delete'));
    IF v <> '' THEN RAISE EXCEPTION 'retired sub-departments still referenced: %', v; END IF;
    IF EXISTS (SELECT 1 FROM hr.roles WHERE subdepartment_id IN (SELECT id FROM _retire_ids WHERE kind = 'delete')) THEN
        RAISE EXCEPTION 'retired sub-departments still own roles';
    END IF;
END $$;
DELETE FROM public.sub_departments WHERE id IN (SELECT id FROM _retire_ids WHERE kind = 'delete');
DELETE FROM hr.subdepartments      WHERE id IN (SELECT id FROM _retire_ids WHERE kind = 'delete');

-- ── 7. The two emptied departments ───────────────────────────────────────────
DO $$
DECLARE r record; n bigint; v text := '';
    ids uuid[] := ARRAY(SELECT id FROM hr.departments WHERE name IN ('Assets and Trades', 'Logistics'));
BEGIN
    FOR r IN
        SELECT c.table_schema, c.table_name, c.column_name, c.data_type
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
         WHERE c.table_schema IN ('public', 'hr')
           AND c.table_name NOT IN ('departments', '_backup_retired_structure_20261009')
           AND ((c.data_type = 'uuid' AND c.column_name IN ('department_id', 'dept_id'))
             OR (c.data_type = 'ARRAY' AND c.column_name IN ('department_ids', 'dept_ids')))
    LOOP
        IF r.data_type = 'uuid' THEN
            EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = ANY ($1)', r.table_schema, r.table_name, r.column_name) INTO n USING ids;
        ELSE
            EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I && $1', r.table_schema, r.table_name, r.column_name) INTO n USING ids;
        END IF;
        IF n > 0 THEN v := v || format('%s.%s.%s=%s ', r.table_schema, r.table_name, r.column_name, n); END IF;
    END LOOP;
    IF v <> '' THEN RAISE EXCEPTION 'retired departments still referenced: %', v; END IF;
END $$;
DELETE FROM public.departments WHERE name IN ('Assets and Trades', 'Logistics');
DELETE FROM hr.departments     WHERE name IN ('Assets and Trades', 'Logistics');

DROP FUNCTION pg_temp.move_subdepartment(uuid, uuid, text);
DROP FUNCTION pg_temp.subdepartment_refs(uuid[]);
