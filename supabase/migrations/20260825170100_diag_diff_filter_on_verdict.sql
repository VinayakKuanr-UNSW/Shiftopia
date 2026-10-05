-- ============================================================================
-- The third bug in diag.rbac_access_diff, and the last one of its kind, because
-- this removes the thing that produced all three.
--
-- 20260825160100 fixed two real faults but kept the shape that caused them: a
-- CASE expression computing the verdict, and a WHERE clause RE-DERIVING the
-- same conditions to decide what to show. Two copies of one rule — which is,
-- with no irony available, the exact defect this whole consolidation exists to
-- remove.
--
-- The copies then disagreed. Phase 2b dropped `shifts_select_managers`, so four
-- baseline rows had no current match: was = 180, now_is = NULL. The CASE said
-- `policy removed`. The WHERE said:
--
--     NOT (was_of IS DISTINCT FROM now_of
--          AND ((was = was_of AND now_is = now_of) OR (was = 0 AND now_is = 0)))
--
-- where `now_is = now_of` is `NULL = NULL` → NULL, so the inner disjunction is
-- NULL, so `NOT (true AND NULL)` is NULL, and a WHERE of NULL drops the row.
-- Four deleted grants reported as no change at all — the failure mode this tool
-- exists to make impossible, occurring inside the tool.
--
-- It returned EMPTY for Phase 2b and empty was also the correct answer for the
-- fairness_ledger half, so the result looked like a pass. That is the dangerous
-- kind of wrong: a verification that agrees with you for the wrong reason.
--
-- THE FIX IS STRUCTURAL, not another condition. The verdict is computed once in
-- a CTE and the filter tests the verdict — `WHERE direction NOT IN (...)`. There
-- is now one statement of the rule, so there is nothing left to disagree with.
-- ============================================================================

CREATE OR REPLACE FUNCTION diag.rbac_access_diff(p_label text DEFAULT 'pre-phase-1')
RETURNS TABLE (
    principal text, level text, tbl text, cmd text, policy_name text,
    was bigint, now_is bigint, was_of bigint, now_of bigint, direction text
)
LANGUAGE sql
AS $function$
    WITH base AS (
        SELECT * FROM diag.rbac_baseline WHERE label = p_label
    ),
    cur AS (
        SELECT * FROM diag.rbac_access_snapshot()
    ),
    verdict AS (
        SELECT COALESCE(c.principal, b.principal)     AS principal,
               COALESCE(c.level, b.level)             AS level,
               COALESCE(c.tbl, b.tbl)                 AS tbl,
               COALESCE(c.cmd, b.cmd)                 AS cmd,
               COALESCE(c.policy_name, b.policy_name) AS policy_name,
               b.matched  AS was,    c.matched  AS now_is,
               b.of_total AS was_of, c.of_total AS now_of,
               CASE
                 WHEN b.matched IS NULL THEN 'policy added'
                 WHEN c.matched IS NULL THEN 'policy removed'
                 WHEN b.of_total IS DISTINCT FROM c.of_total
                      AND ((b.matched = b.of_total AND c.matched = c.of_total)
                           OR (b.matched = 0 AND c.matched = 0))
                      THEN 'unchanged (table size moved)'
                 WHEN b.of_total IS DISTINCT FROM c.of_total THEN 'CHECK — table size also moved'
                 WHEN c.matched > b.matched THEN 'WIDENED'
                 WHEN c.matched < b.matched THEN 'narrowed'
                 ELSE 'same'
               END AS direction
          FROM cur c
          FULL JOIN base b
                 ON b.principal = c.principal AND b.tbl = c.tbl
                AND b.cmd = c.cmd AND b.policy_name = c.policy_name
    )
    -- One statement of the rule, tested directly. The previous version restated
    -- it here and the two copies disagreed on NULLs.
    SELECT v.principal, v.level, v.tbl, v.cmd, v.policy_name,
           v.was, v.now_is, v.was_of, v.now_of, v.direction
      FROM verdict v
     WHERE v.direction NOT IN ('same', 'unchanged (table size moved)')
     ORDER BY v.principal, v.tbl, v.policy_name;
$function$;

COMMENT ON FUNCTION diag.rbac_access_diff(text) IS
    'Rows where access moved since the named baseline. The verdict is computed once and filtered on '
    'directly — an earlier version restated the conditions in its WHERE clause and the two copies '
    'disagreed on NULLs, silently hiding four dropped grants (migration 20260825170100). '
    'WIDENED and `policy added` need justifying; `narrowed` and `policy removed` are what a '
    'tightening phase intends; empty is the pass condition for a behaviour-preserving one.';

REVOKE ALL ON FUNCTION diag.rbac_access_diff(text) FROM PUBLIC, anon, authenticated;

-- Self-test: the tool must now report the removal it just hid.
DO $selftest$
DECLARE
    v_failures text := '';
    v_removed  int;
    v_orphans  int;
BEGIN
    -- (a) Phase 2b dropped shifts_select_managers for 4 principals. The tool
    --     must say so. This is the exact case the previous version swallowed.
    SELECT count(*) INTO v_removed FROM diag.rbac_access_diff('post-phase-2a')
     WHERE direction = 'policy removed' AND policy_name = 'shifts_select_managers';

    SELECT count(*) INTO v_orphans
      FROM diag.rbac_baseline b
     WHERE b.label = 'post-phase-2a'
       AND NOT EXISTS (SELECT 1 FROM diag.rbac_access_snapshot() c
                        WHERE c.principal = b.principal AND c.tbl = b.tbl
                          AND c.cmd = b.cmd AND c.policy_name = b.policy_name);

    IF v_removed <> v_orphans THEN
        v_failures := v_failures
            || format('(a) %s baseline rows have no current match but the diff reports %s ; ',
                      v_orphans, v_removed);
    END IF;

    IF v_orphans = 0 THEN
        v_failures := v_failures
            || '(b) no removed policy to test against — assertion (a) is vacuous ; ';
    END IF;

    -- (c) And it must still be quiet where nothing moved.
    IF EXISTS (SELECT 1 FROM diag.rbac_access_diff('post-phase-2a')
                WHERE direction = 'same') THEN
        v_failures := v_failures || '(c) unchanged rows are being reported ; ';
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'diag_diff_filter_on_verdict selftest FAILED: %', v_failures;
    END IF;
    RAISE NOTICE 'diag_diff_filter_on_verdict selftest PASSED';
END
$selftest$;
