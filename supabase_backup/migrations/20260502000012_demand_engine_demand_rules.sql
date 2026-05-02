-- Demand Engine Phase 1 (D): demand_rules.
-- L3 baseline rule library. Versioned, admin-editable. Engine selects rules
-- where applies_when matches the event's L1 features, then evaluates `formula`
-- via the rule DSL (implemented in app code, not the DB).

CREATE TABLE IF NOT EXISTS public.demand_rules (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code     text NOT NULL,
    function_code text NOT NULL,
    level         integer NOT NULL,
    applies_when  jsonb NOT NULL DEFAULT '{}'::jsonb,
    formula       text NOT NULL,
    priority      integer NOT NULL DEFAULT 100,
    version       integer NOT NULL DEFAULT 1,
    is_active     boolean NOT NULL DEFAULT true,
    notes         text,
    created_by    uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT demand_rules_function_code_chk
        CHECK (function_code IN ('F&B','Logistics','AV','FOH','Security')),
    CONSTRAINT demand_rules_level_chk
        CHECK (level BETWEEN 0 AND 7),
    CONSTRAINT demand_rules_priority_chk
        CHECK (priority >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS demand_rules_code_version_uidx
    ON public.demand_rules (rule_code, version);

CREATE INDEX IF NOT EXISTS demand_rules_active_idx
    ON public.demand_rules (function_code, level)
    WHERE is_active = true;

ALTER TABLE public.demand_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_demand_rules" ON public.demand_rules;
CREATE POLICY "authenticated_read_demand_rules"
    ON public.demand_rules
    FOR SELECT
    TO authenticated
    USING (true);

COMMENT ON TABLE public.demand_rules IS
    'Demand engine L3: rule-based baseline headcount library. (rule_code, version) is unique. Only is_active=true rules are evaluated at synthesis time.';
COMMENT ON COLUMN public.demand_rules.applies_when IS
    'JSON predicate over L1 features, e.g. {"service_type":"buffet","alcohol":true,"pax":">300"}. Empty object means always applies.';
COMMENT ON COLUMN public.demand_rules.formula IS
    'Rule DSL expression evaluated by the engine. Variables available: pax, room_count, total_sqm, duration_min, bump_in_min, bump_out_min, slice_idx, staff_at_levels[i].';
