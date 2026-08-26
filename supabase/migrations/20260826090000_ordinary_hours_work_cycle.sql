-- ============================================================================
-- Phase 1 — record the declared ordinary-hours work cycle.
--
-- THE PROVISION. ICC EBA cl 35.1(a) (full-time), 35.2(b) (part-time), 35.3(b)
-- (flexible part-time) and 35.4(a) (CASUAL) all state the same ladder of
-- ordinary-hours ceilings:
--
--     38 hours in one (1) week;
--     76 hours in two (2) weeks;
--     114 hours in three (3) weeks;  OR
--     152 hours in four (4) weeks.
--
-- The list is a DISJUNCTION, not four simultaneous caps. cl 12.2(b), 12.3(b) and
-- 12.4(b) supply the other half: the engagement is worked "over a work cycle of
-- up to four (4) weeks". So the cycle length is a declared property of the
-- ENGAGEMENT, and 35.x(a) merely prices each permissible length.
--
-- WHY THIS COLUMN HAS TO EXIST. Until now that fact lived nowhere. The TS config
-- carried one global `ord_avg_cycle_weeks: 4`; the solver carried a module
-- constant ORD_AVG_CYCLE_DAYS = 28; and the Availability Manager applied all
-- four windows at once as blocking. Three layers, three readings, none of them
-- per-employee — so a cohort engaged on a shorter cycle was silently
-- under-enforced by up to 76 hours a fortnight, while everyone on the four-week
-- cycle was shown violations for rosters the Agreement permits.
--
-- THE ANCHOR. A work cycle is a bounded, repeating period — cl 42.6 lets a
-- full-timer substitute a day off "during the work cycle", and cl 35.1(e) wants
-- two consecutive days off per week "during each work cycle". Both presuppose
-- edges, so a cycle needs a start as well as a length.
--
-- The default is a fixed Monday epoch, NOT each contract's start_date. Rosters
-- are published team-wide on seven days' notice (cl 38.1); if every engagement
-- ran its own boundary, the identical roster would be compliant for one person
-- and breaching for the next purely by hire date, and no manager could reason
-- about a team's cycle at all. Override per contract only where an engagement
-- genuinely runs to its own cycle.
--
-- SCHEDULE 3 IS DELIBERATELY NOT EXPRESSIBLE HERE. Full-time Security work an
-- "even time" 42h/week average over an EIGHT week cycle (Sch 3 §3.1(d)), and
-- §1.1 makes the Schedule prevail over the Agreement to the extent of any
-- inconsistency. That stays a discriminated branch on (is_security_role AND
-- Full-Time) in both the solver and the V8 auditor. The CHECK below pins this
-- column to the 1-4 range clause 35 enumerates precisely so there are never two
-- rival ways to say "eight weeks".
--
-- BEHAVIOUR CHANGE ON APPLY: none. Every existing row lands on 4 weeks, which is
-- exactly what the hardcoded constants already assumed. The enforcement layers
-- start reading these columns in Phase 3.
-- ============================================================================

ALTER TABLE hr.user_contracts
    ADD COLUMN IF NOT EXISTS ordinary_hours_cycle_weeks smallint NOT NULL DEFAULT 4,
    ADD COLUMN IF NOT EXISTS ordinary_hours_cycle_anchor date NOT NULL DEFAULT DATE '2024-01-01';

-- 1..4 only — the four cycle lengths cl 35.x(a) actually enumerates.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'hr.user_contracts'::regclass
          AND conname  = 'chk_ordinary_hours_cycle_weeks_range'
    ) THEN
        ALTER TABLE hr.user_contracts
            ADD CONSTRAINT chk_ordinary_hours_cycle_weeks_range
            CHECK (ordinary_hours_cycle_weeks BETWEEN 1 AND 4);
    END IF;
END $$;

-- The anchor is only meaningful as a cycle boundary, and every enumerated cycle
-- length is a whole number of weeks, so an anchor that is not a Monday would put
-- cycle edges mid-week for every employee on the contract. ISODOW 1 = Monday.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'hr.user_contracts'::regclass
          AND conname  = 'chk_ordinary_hours_cycle_anchor_monday'
    ) THEN
        ALTER TABLE hr.user_contracts
            ADD CONSTRAINT chk_ordinary_hours_cycle_anchor_monday
            CHECK (EXTRACT(ISODOW FROM ordinary_hours_cycle_anchor) = 1);
    END IF;
END $$;

COMMENT ON COLUMN hr.user_contracts.ordinary_hours_cycle_weeks IS
    'Declared ordinary-hours work cycle length in weeks (ICC EBA cl 35.x(a) / '
    '12.2(b)). 1=38h, 2=76h, 3=114h, 4=152h. Full-time Security IGNORE this: '
    'Sch 3 §3.1(d) gives them 42h/week over an 8-week cycle and §1.1 prevails.';

COMMENT ON COLUMN hr.user_contracts.ordinary_hours_cycle_anchor IS
    'Monday on which this contract''s ordinary-hours cycles are anchored. Cycle N '
    'runs [anchor + N*weeks*7, anchor + (N+1)*weeks*7). Defaults to a shared epoch '
    'so a team''s cycles line up; override only for a genuinely independent cycle.';

-- ── public.user_contracts ───────────────────────────────────────────────────
-- CREATE OR REPLACE (not DROP/CREATE) so the existing grants and reloptions
-- survive untouched. Both new columns are appended at the END of the select
-- list, which is the only shape REPLACE accepts.
--
-- NOTE, NOT CHANGED HERE: this view carries no `security_invoker`, so it runs as
-- its owner (postgres) and therefore bypasses the three RLS policies on
-- hr.user_contracts. That is pre-existing and out of scope for this migration —
-- flipping it is a deliberate decision with its own blast radius, not a side
-- effect of adding two columns.
CREATE OR REPLACE VIEW public.user_contracts AS
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
    ordinary_hours_cycle_anchor
   FROM hr.user_contracts;
