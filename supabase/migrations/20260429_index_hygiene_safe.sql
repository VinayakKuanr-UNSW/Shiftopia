-- =====================================================================
--  Index hygiene — safe additions and duplicate removal
--
--  This migration is purely additive or removes redundant duplicates;
--  no behavior change, no risk of regressing query plans.
--
--   1. Add btree indexes for every foreign-key column that lacks one.
--      Performance advisor: unindexed_foreign_keys (66 hits). Without an
--      index the FK column triggers a sequential scan on every JOIN or
--      cascading delete from the parent.
--
--   2. Drop one of each duplicate-index pair. Performance advisor:
--      duplicate_index (5 hits). Two indexes on the same column set
--      double the write cost without adding any benefit.
--
--  Naming convention for new indexes: idx_<table>_<col1>[_<col2>]...
--  Names are checked for length / collision; existing same-name indexes
--  are left alone (CREATE INDEX IF NOT EXISTS).
--
--  Idempotent: skips FKs that already have a covering index.
--
--  NOTE: Dropping the 91 advisor-reported "unused" indexes was deferred.
--  74 of them are on currently-empty tables (idx_scan=0 is meaningless
--  there) and another large chunk are the FK indexes added by this very
--  migration. Revisit after 2–4 weeks of real query traffic accumulates
--  in pg_stat_user_indexes. Documented in things_I_missed.txt.
-- =====================================================================

-- ── 1. Add missing FK indexes ────────────────────────────────────────
DO $$
DECLARE
    fk record;
    idx_name text;
    col_list text;
    sql_cmd text;
    created int := 0;
BEGIN
    FOR fk IN
        SELECT
            cl.relname AS table_name,
            con.conname AS fk_name,
            array_agg(att.attname ORDER BY u.ord) AS fk_columns
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        JOIN unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord) ON true
        JOIN pg_attribute att ON att.attrelid = cl.oid AND att.attnum = u.attnum
        WHERE con.contype = 'f'
          AND n.nspname = 'public'
          AND NOT EXISTS (
              SELECT 1 FROM pg_index idx
              WHERE idx.indrelid = con.conrelid
                AND (idx.indkey::int2[])[0:array_length(con.conkey,1)-1] = con.conkey
          )
        GROUP BY cl.relname, con.conname, con.conrelid, con.conkey
    LOOP
        col_list := array_to_string(fk.fk_columns, ', ');
        idx_name := 'idx_' || fk.table_name || '_' || array_to_string(fk.fk_columns, '_');
        IF length(idx_name) > 63 THEN
            idx_name := substr(idx_name, 1, 63);
        END IF;

        sql_cmd := format(
            'CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)',
            idx_name, fk.table_name, col_list
        );
        EXECUTE sql_cmd;
        created := created + 1;
    END LOOP;
    RAISE NOTICE 'Created % FK index(es)', created;
END
$$;

-- ── 2. Drop duplicate indexes (keeping the more descriptive names) ───
DROP INDEX IF EXISTS public.idx_departments_org;
DROP INDEX IF EXISTS public.idx_epm_employee;
DROP INDEX IF EXISTS public.idx_epm_quarter;
DROP INDEX IF EXISTS public.idx_sub_departments_dept;

-- The 5th duplicate is a UNIQUE CONSTRAINT, not just an index. Drop
-- one of the constraints; the other still enforces uniqueness on
-- (roster_shift_id, employee_id).
ALTER TABLE public.roster_shift_assignments
    DROP CONSTRAINT IF EXISTS roster_assignments_shift_employee_unique;
