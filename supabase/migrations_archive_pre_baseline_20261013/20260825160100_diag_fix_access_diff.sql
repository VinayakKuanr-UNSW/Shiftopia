-- ============================================================================
-- Two bugs in the Phase 0 diff, both found by Phase 2 refusing to accept its
-- own result. Neither was visible when the tool was written, and both would
-- have hidden a real regression behind noise.
--
-- ── 1. THE LABEL FILTER WAS INSIDE A FULL JOIN'S ON CLAUSE ──────────────────
--
--     FULL JOIN diag.rbac_baseline b
--            ON b.label = p_label AND b.principal = c.principal AND ...
--
-- In a FULL JOIN, a predicate in ON does not remove rows — it only decides what
-- matches. So every row belonging to a DIFFERENT label came back unmatched, with
-- a NULL current side, and was reported as `policy removed`. With one label in
-- the table that was invisible: the tool returned 0 and looked correct. The
-- moment `post-phase-1` was captured alongside `pre-phase-1`, Phase 2's diff
-- came back with 352 phantom removals — the entire other baseline — around the
-- one row that mattered.
--
-- The label has to be applied BEFORE the join, which is what a CTE does.
--
-- ── 2. A RAW ROW COUNT IS NOT AN ACCESS MEASUREMENT ─────────────────────────
--
-- `matched` counts rows the policy admits, so it moves when the TABLE moves,
-- not only when the POLICY moves. Phase 2's diff flagged
-- dead_shift_cleanup_log as WIDENED, 3843 → 3844, for the org admin. Nothing
-- had changed about the policy: a cron job had appended one cleanup row between
-- the two captures, and the admin could read all of it before and after.
--
-- A WIDENED that means "a cron job ran" is worse than no signal at all, because
-- the next real widening arrives in a column the reader has learned to ignore.
-- So when `of_total` also moved and the policy still admits the same PROPORTION
-- — all rows before and all rows after, or none before and none after — the row
-- is reported as `unchanged (table size moved)` and filtered out. When
-- `of_total` moved and the proportion did NOT hold, it is reported as
-- `CHECK — table size also moved`: that is genuinely ambiguous from counts
-- alone and a human has to look.
-- ============================================================================

CREATE OR REPLACE FUNCTION diag.rbac_access_diff(p_label text DEFAULT 'pre-phase-1')
RETURNS TABLE (
    principal text, level text, tbl text, cmd text, policy_name text,
    was bigint, now_is bigint, was_of bigint, now_of bigint, direction text
)
LANGUAGE sql
AS $function$
    WITH base AS (
        -- Applied BEFORE the join. In the ON clause of a FULL JOIN this would
        -- have admitted every other label as an unmatched row.
        SELECT * FROM diag.rbac_baseline WHERE label = p_label
    ),
    cur AS (
        SELECT * FROM diag.rbac_access_snapshot()
    ),
    joined AS (
        SELECT COALESCE(c.principal, b.principal)     AS principal,
               COALESCE(c.level, b.level)             AS level,
               COALESCE(c.tbl, b.tbl)                 AS tbl,
               COALESCE(c.cmd, b.cmd)                 AS cmd,
               COALESCE(c.policy_name, b.policy_name) AS policy_name,
               b.matched  AS was,      c.matched  AS now_is,
               b.of_total AS was_of,   c.of_total AS now_of
          FROM cur c
          FULL JOIN base b
                 ON b.principal = c.principal AND b.tbl = c.tbl
                AND b.cmd = c.cmd AND b.policy_name = c.policy_name
    )
    SELECT j.principal, j.level, j.tbl, j.cmd, j.policy_name,
           j.was, j.now_is, j.was_of, j.now_of,
           CASE
             WHEN j.was    IS NULL THEN 'policy added'
             WHEN j.now_is IS NULL THEN 'policy removed'
             WHEN j.was_of IS DISTINCT FROM j.now_of
                  AND ((j.was = j.was_of AND j.now_is = j.now_of)
                       OR (j.was = 0 AND j.now_is = 0))
                  THEN 'unchanged (table size moved)'
             WHEN j.was_of IS DISTINCT FROM j.now_of THEN 'CHECK — table size also moved'
             WHEN j.now_is > j.was THEN 'WIDENED'
             WHEN j.now_is < j.was THEN 'narrowed'
             ELSE 'same'
           END AS direction
      FROM joined j
     WHERE NOT (j.was IS NOT DISTINCT FROM j.now_is
                AND j.was_of IS NOT DISTINCT FROM j.now_of)
       AND NOT (j.was_of IS DISTINCT FROM j.now_of
                AND ((j.was = j.was_of AND j.now_is = j.now_of)
                     OR (j.was = 0 AND j.now_is = 0)))
     ORDER BY 1, 3, 5;
$function$;

COMMENT ON FUNCTION diag.rbac_access_diff(text) IS
    'Rows where access moved since the named baseline. Movement caused by the table changing size '
    'rather than the policy changing is filtered out — see migration 20260825160100 for why that '
    'distinction is load-bearing. WIDENED needs justifying; narrowed is what Phase 1 intended; an '
    'empty result is the pass condition for Phase 2.';

REVOKE ALL ON FUNCTION diag.rbac_access_diff(text) FROM PUBLIC, anon, authenticated;

-- Self-test: the tool must now agree with itself.
DO $selftest$
DECLARE
    v_failures text := '';
    v_n int;
BEGIN
    -- (a) A baseline compared against itself, with a second label present, must
    --     be quiet. This is the exact case the ON-clause bug got wrong.
    SELECT count(*) INTO v_n FROM diag.rbac_access_diff('post-phase-1')
     WHERE direction = 'policy removed';
    IF v_n > 0 THEN
        v_failures := v_failures
            || format('(a) %s phantom removals — the label filter is still leaking ; ', v_n);
    END IF;

    -- (b) More than one label must exist, or (a) proves nothing.
    SELECT count(DISTINCT label) INTO v_n FROM diag.rbac_baseline;
    IF v_n < 2 THEN
        v_failures := v_failures
            || '(b) only one baseline label — assertion (a) is vacuous ; ';
    END IF;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'diag_fix_access_diff selftest FAILED: %', v_failures;
    END IF;
    RAISE NOTICE 'diag_fix_access_diff selftest PASSED';
END
$selftest$;
