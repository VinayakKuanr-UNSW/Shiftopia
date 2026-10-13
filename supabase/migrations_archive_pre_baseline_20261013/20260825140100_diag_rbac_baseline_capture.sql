-- ============================================================================
-- The captured baseline, and the diff that makes it useful.
--
-- WHY IT LIVES IN THE DATABASE. The obvious alternative was a 350-line text
-- dump committed to git. Comparing two dumps by eye is exactly the kind of
-- verification that passes when it should fail, and the dump's column layout
-- would drift from the function that produced it the first time either changed.
-- Held as a table, the comparison is a SQL join and the row shape cannot
-- diverge from its producer.
--
-- WHAT THE FIRST CAPTURE FOUND, before a single policy had been touched:
-- `shift_events."Managers can view all shift events"` returns 720 of 720 rows
-- for an ordinary alpha employee. Its level test reads
--
--     access_level = ANY (ARRAY['alpha','beta','gamma','delta','epsilon','zeta'])
--
-- which is every member of the enum — a no-op wearing the shape of a check. So
-- a policy named for managers admits everyone holding any active contract, and
-- all 100 alpha users can read the full shift-event history: who dropped which
-- shift, when, and why. `"Users can view their own shift events"` already
-- covers the legitimate case, so this grants nothing anyone needs.
--
-- That is a LIVE exposure, not a dormant one, and it was found by the baseline
-- on its first run rather than by the audit that preceded it — the audit
-- classified the policy as unscoped but could not see that its level list was
-- vacuous. It is the first thing Phase 1 should close.
-- ============================================================================

CREATE TABLE IF NOT EXISTS diag.rbac_baseline (
    label       text        NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now(),
    principal   text        NOT NULL,
    level       text,
    tbl         text        NOT NULL,
    cmd         text        NOT NULL,
    policy_name text        NOT NULL,
    matched     bigint,
    of_total    bigint,
    PRIMARY KEY (label, principal, tbl, cmd, policy_name)
);

COMMENT ON TABLE diag.rbac_baseline IS
    'Captured output of diag.rbac_access_snapshot(), one labelled set per consolidation phase. '
    'Compare with diag.rbac_access_diff(label) after a change: a phase is done when the diff is '
    'exactly the set of changes it intended and nothing else.';

REVOKE ALL ON TABLE diag.rbac_baseline FROM PUBLIC, anon, authenticated;

INSERT INTO diag.rbac_baseline (label, principal, level, tbl, cmd, policy_name, matched, of_total)
SELECT 'pre-phase-1', principal, level, tbl, cmd, policy_name, matched, of_total
  FROM diag.rbac_access_snapshot()
ON CONFLICT (label, principal, tbl, cmd, policy_name) DO NOTHING;

-- What changed since a labelled baseline. Rows appear only when access moved,
-- so a behaviour-preserving change produces an empty result — which is the pass
-- condition for Phase 2, and a much stronger statement than "the tests pass".
CREATE OR REPLACE FUNCTION diag.rbac_access_diff(p_label text DEFAULT 'pre-phase-1')
RETURNS TABLE (
    principal text, level text, tbl text, cmd text, policy_name text,
    was bigint, now_is bigint, direction text
)
LANGUAGE sql
AS $function$
    WITH cur AS (SELECT * FROM diag.rbac_access_snapshot())
    SELECT COALESCE(c.principal, b.principal),
           COALESCE(c.level, b.level),
           COALESCE(c.tbl, b.tbl),
           COALESCE(c.cmd, b.cmd),
           COALESCE(c.policy_name, b.policy_name),
           b.matched,
           c.matched,
           CASE
             WHEN b.matched IS NULL THEN 'policy added'
             WHEN c.matched IS NULL THEN 'policy removed'
             WHEN c.matched > b.matched THEN 'WIDENED'
             WHEN c.matched < b.matched THEN 'narrowed'
             ELSE 'same'
           END
      FROM cur c
      FULL JOIN diag.rbac_baseline b
             ON b.label = p_label
            AND b.principal = c.principal AND b.tbl = c.tbl
            AND b.cmd = c.cmd AND b.policy_name = c.policy_name
     WHERE b.matched IS DISTINCT FROM c.matched
     ORDER BY 1, 3, 5;
$function$;

COMMENT ON FUNCTION diag.rbac_access_diff(text) IS
    'Rows where access moved since the named baseline. WIDENED is the direction that needs '
    'justifying; narrowed is the direction Phase 1 intends. An empty result means a change was '
    'behaviour-preserving, which is the pass condition for Phase 2.';

REVOKE ALL ON FUNCTION diag.rbac_access_diff(text) FROM PUBLIC, anon, authenticated;
