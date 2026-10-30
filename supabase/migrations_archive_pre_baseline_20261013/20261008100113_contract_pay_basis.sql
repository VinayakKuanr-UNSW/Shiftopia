-- Contract pay basis: how a contract is paid, separate from how it is engaged.
--
-- The ICC Sydney EA 2025 splits pay by COVERAGE, not employment type:
--   • Every covered Team Member — Full-Time, Part-Time, Flexible Part-Time or
--     Casual — sits on a Schedule 1 level and is paid the Schedule 2 §1 rate
--     for it (weekly / ordinary hourly / casual hourly).
--   • Full-Time Security are paid an annualised salary, but still at a level,
--     and only Levels 3–6 (Sch 2 §2, Sch 3).
--   • Salaried or managerial staff are outside the Agreement (cl 2.2(a)), as is
--     a Full-Time Team Member earning more than its highest rate (cl 2.2(b)).
--     They have a salary and no level.
--
-- Business rules (user decisions 2026-10-08):
--   • A casual ALWAYS has a level — there is no casual salaried basis.
--   • Someone on a level is paid exactly that level: no custom hourly rates.
--   • Salaried overtime is time in lieu, not pay (handled in a later phase).
--
-- Pay terms change over a contract's life (Level 0 → 1 after 375 hours under
-- Sch 1 §1(b), reclassification, salary review), and a past shift must be
-- priced on the terms in force on its date. hr.contract_pay_terms keeps that
-- history; the columns on hr.user_contracts stay the CURRENT terms.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE hr.user_contracts
    ADD COLUMN pay_basis              text NOT NULL DEFAULT 'eba_level',
    ADD COLUMN eba_exclusion_reason   text,
    ADD COLUMN annual_salary          numeric(12,2),
    ADD COLUMN engagement_kind        text NOT NULL DEFAULT 'primary',
    ADD COLUMN multi_hire_request_ref text;

COMMENT ON COLUMN hr.user_contracts.pay_basis IS
  'eba_level (Sch 2 §1, any employment type; the only basis for casuals) | eba_security_annualised (Sch 2 §2, Full-Time security, L3–6) | salary (outside the EA under cl 2.2; Full-Time or Part-Time; no level).';
COMMENT ON COLUMN hr.user_contracts.eba_exclusion_reason IS
  'Why a salaried contract is outside the EA: managerial (cl 2.2(a)) or above_threshold (cl 2.2(b)). NULL for EA-covered contracts.';
COMMENT ON COLUMN hr.user_contracts.annual_salary IS
  'Annual salary for pay_basis = salary. NULL otherwise — EA pay comes from public.eba_rate by level and date.';
COMMENT ON COLUMN hr.user_contracts.engagement_kind IS
  'primary, or multi_hire: a separate casual engagement in a different classification requested by the Team Member (cl 13).';
COMMENT ON COLUMN hr.user_contracts.multi_hire_request_ref IS
  'Reference to the Request to Multi-Hire form (cl 13.1(d)).';
COMMENT ON COLUMN hr.user_contracts.custom_hourly_rate IS
  'DEPRECATED — must stay NULL: someone on a level is paid that level. To be dropped once no client selects it.';

-- ── 2. Rules ────────────────────────────────────────────────────────────────
-- A CHECK passes when its expression is NULL, so every nullable operand is
-- tested with IS [NOT] NULL explicitly.
ALTER TABLE hr.user_contracts
    ADD CONSTRAINT user_contracts_pay_basis_valid
        CHECK (pay_basis IN ('eba_level', 'eba_security_annualised', 'salary')),
    ADD CONSTRAINT user_contracts_eba_exclusion_reason_valid
        CHECK (eba_exclusion_reason IS NULL OR eba_exclusion_reason IN ('managerial', 'above_threshold')),
    ADD CONSTRAINT user_contracts_engagement_kind_valid
        CHECK (engagement_kind IN ('primary', 'multi_hire')),

    -- Sch 2 §1: a level, and nothing else that sets pay.
    ADD CONSTRAINT user_contracts_eba_level_terms
        CHECK (pay_basis <> 'eba_level' OR (
                   remuneration_level IS NOT NULL
               AND remuneration_level BETWEEN 0 AND 7
               AND annual_salary IS NULL
               AND eba_exclusion_reason IS NULL)),

    -- Sch 2 §2 / Sch 3: Full-Time security only, Levels 3–6; the salary comes
    -- from eba_rate, so none is stored here.
    ADD CONSTRAINT user_contracts_security_annualised_terms
        CHECK (pay_basis <> 'eba_security_annualised' OR (
                   employment_status IS NOT NULL
               AND employment_status = 'Full-Time'
               AND remuneration_level IS NOT NULL
               AND remuneration_level BETWEEN 3 AND 6
               AND annual_salary IS NULL
               AND eba_exclusion_reason IS NULL)),

    -- cl 2.2: outside the EA — a salary, a reason, no level, no EA wage schemes.
    -- Full-Time or Part-Time only (fPT has no guaranteed weekly hours).
    ADD CONSTRAINT user_contracts_salary_terms
        CHECK (pay_basis <> 'salary' OR (
                   annual_salary IS NOT NULL
               AND annual_salary > 0
               AND remuneration_level IS NULL
               AND employment_status IS NOT NULL
               AND employment_status IN ('Full-Time', 'Part-Time')
               AND eba_exclusion_reason IS NOT NULL
               AND NOT COALESCE(is_apprentice, false)
               AND NOT COALESCE(is_trainee, false)
               AND NOT COALESCE(is_sws, false))),

    -- A casual always has a level. Implied by the two rules above; stated so
    -- the violation names the actual rule.
    ADD CONSTRAINT user_contracts_casual_has_level
        CHECK (employment_status IS NULL
               OR employment_status <> 'Casual'
               OR pay_basis = 'eba_level'),

    -- cl 13.1: a multi-hire engagement is a casual one.
    ADD CONSTRAINT user_contracts_multi_hire_is_casual
        CHECK (engagement_kind <> 'multi_hire' OR (
                   employment_status IS NOT NULL
               AND employment_status = 'Casual')),

    -- Someone on a level is paid that level.
    ADD CONSTRAINT user_contracts_no_custom_hourly_rate
        CHECK (custom_hourly_rate IS NULL);

-- ── 3. Pay terms history ────────────────────────────────────────────────────
CREATE TABLE hr.contract_pay_terms (
    contract_id        uuid NOT NULL REFERENCES hr.user_contracts(id) ON DELETE CASCADE,
    effective_from     date NOT NULL,
    pay_basis          text NOT NULL,
    remuneration_level smallint REFERENCES hr.remuneration_levels(level_number),
    annual_salary      numeric(12,2),
    change_reason      text NOT NULL,
    recorded_at        timestamptz NOT NULL DEFAULT now(),
    recorded_by        uuid,
    PRIMARY KEY (contract_id, effective_from),
    CONSTRAINT contract_pay_terms_pay_basis_valid
        CHECK (pay_basis IN ('eba_level', 'eba_security_annualised', 'salary')),
    CONSTRAINT contract_pay_terms_change_reason_valid
        CHECK (change_reason IN ('hire', 'progression', 'reclassification',
                                 'salary_review', 'correction', 'backfill'))
);

COMMENT ON TABLE hr.contract_pay_terms IS
  'Effective-dated history of a contract''s pay terms. Written only by trg_contract_pay_terms_*; read through hr.contract_pay_terms_on(contract, date).';

ALTER TABLE hr.contract_pay_terms ENABLE ROW LEVEL SECURITY;

-- Mirrors hr.user_contracts' read policies. Writes have no policy: only the
-- SECURITY DEFINER trigger below writes this table.
CREATE POLICY contract_pay_terms_select_own ON hr.contract_pay_terms
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM hr.user_contracts c
         WHERE c.id = contract_pay_terms.contract_id
           AND c.user_id = (SELECT auth.uid())));

CREATE POLICY contract_pay_terms_select_delta ON hr.contract_pay_terms
    FOR SELECT TO authenticated
    USING (public.user_has_delta_access((SELECT auth.uid())));

-- The hr schema's default privileges grant anon/authenticated full access to
-- new tables; this one is read-only to clients.
REVOKE ALL ON hr.contract_pay_terms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hr.contract_pay_terms TO authenticated;
GRANT ALL ON hr.contract_pay_terms TO service_role;

-- Backfill the existing contracts: their current terms, from their start date.
INSERT INTO hr.contract_pay_terms
    (contract_id, effective_from, pay_basis, remuneration_level, annual_salary, change_reason)
SELECT id,
       COALESCE(start_date, (now() AT TIME ZONE 'Australia/Sydney')::date),
       pay_basis, remuneration_level, annual_salary, 'backfill'
  FROM hr.user_contracts;

-- Records a contract's terms whenever they are set or change. A change made
-- twice on one Sydney day keeps the later value. The reason defaults from what
-- changed; a caller can name it with  SET LOCAL hr.pay_change_reason = '...'.
CREATE OR REPLACE FUNCTION hr.record_contract_pay_terms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'hr', 'public'
AS $function$
DECLARE
    v_effective date;
    v_reason    text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_effective := COALESCE(NEW.start_date, (now() AT TIME ZONE 'Australia/Sydney')::date);
        v_reason    := 'hire';
    ELSE
        v_effective := (now() AT TIME ZONE 'Australia/Sydney')::date;
        v_reason    := COALESCE(
            NULLIF(current_setting('hr.pay_change_reason', true), ''),
            CASE WHEN NEW.pay_basis = 'salary'
                  AND OLD.pay_basis = 'salary'
                 THEN 'salary_review'
                 ELSE 'reclassification' END);
    END IF;

    INSERT INTO hr.contract_pay_terms
        (contract_id, effective_from, pay_basis, remuneration_level,
         annual_salary, change_reason, recorded_by)
    VALUES
        (NEW.id, v_effective, NEW.pay_basis, NEW.remuneration_level,
         NEW.annual_salary, v_reason, auth.uid())
    ON CONFLICT (contract_id, effective_from) DO UPDATE
       SET pay_basis          = EXCLUDED.pay_basis,
           remuneration_level = EXCLUDED.remuneration_level,
           annual_salary      = EXCLUDED.annual_salary,
           change_reason      = EXCLUDED.change_reason,
           recorded_at        = now(),
           recorded_by        = EXCLUDED.recorded_by;

    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION hr.record_contract_pay_terms() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_contract_pay_terms_on_insert
    AFTER INSERT ON hr.user_contracts
    FOR EACH ROW EXECUTE FUNCTION hr.record_contract_pay_terms();

CREATE TRIGGER trg_contract_pay_terms_on_update
    AFTER UPDATE OF pay_basis, remuneration_level, annual_salary ON hr.user_contracts
    FOR EACH ROW
    WHEN (OLD.pay_basis          IS DISTINCT FROM NEW.pay_basis
       OR OLD.remuneration_level IS DISTINCT FROM NEW.remuneration_level
       OR OLD.annual_salary      IS DISTINCT FROM NEW.annual_salary)
    EXECUTE FUNCTION hr.record_contract_pay_terms();

-- The terms in force on a date: the latest change on or before it. A date
-- earlier than every recorded change gets the earliest terms, so a shift dated
-- before a contract's recorded start still prices on that contract's terms.
CREATE OR REPLACE FUNCTION hr.contract_pay_terms_on(p_contract_id uuid, p_on date)
 RETURNS hr.contract_pay_terms
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'hr'
AS $function$
    SELECT t.*
      FROM hr.contract_pay_terms t
     WHERE t.contract_id = p_contract_id
     ORDER BY (t.effective_from <= p_on) DESC,
              CASE WHEN t.effective_from <= p_on THEN t.effective_from END DESC,
              t.effective_from ASC
     LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION hr.contract_pay_terms_on(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hr.contract_pay_terms_on(uuid, date) TO authenticated, service_role;

-- ── 4. Expose the new columns through the public compat view ────────────────
-- CREATE OR REPLACE VIEW resets reloptions, so security_invoker is restated
-- (see migration close_user_contracts_view_escalation). New columns are
-- appended after the existing ones, which CREATE OR REPLACE permits.
CREATE OR REPLACE VIEW public.user_contracts
WITH (security_invoker = on) AS
SELECT id,
    user_id,
    organization_id,
    department_id,
    sub_department_id,
    role_id,
    status,
    start_date,
    end_date,
    custom_hourly_rate,
    notes,
    created_at,
    updated_at,
    created_by,
    access_level,
    employment_status,
    contracted_weekly_hours,
    is_apprentice,
    apprentice_type,
    apprentice_year,
    has_completed_year_12,
    is_trainee,
    trainee_category,
    trainee_level,
    trainee_exit_year,
    trainee_years_out,
    trainee_aqf_level,
    trainee_year,
    is_training_on_job,
    prefers_sba_loading,
    is_sws,
    sws_capacity_percentage,
    is_sws_trial,
    sws_trial_start_date,
    annual_guaranteed_hours,
    remuneration_level,
    ordinary_span_start,
    ordinary_span_end,
    ordinary_days,
    position_id,
    ordinary_hours_cycle_weeks,
    ordinary_hours_cycle_anchor,
    pay_basis,
    eba_exclusion_reason,
    annual_salary,
    engagement_kind,
    multi_hire_request_ref
   FROM hr.user_contracts;
