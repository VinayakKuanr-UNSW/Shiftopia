-- Demand Engine Phase 1 (D): demand_tensor (L7 finalized output) and
-- demand_templates (L9). demand_tensor is the new authoritative output of
-- the engine; demand_forecasts (legacy ML-only) stays in place during
-- migration and will be deprecated once the rule engine is the runtime path.

CREATE TABLE IF NOT EXISTS public.demand_tensor (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    synthesis_run_id   uuid REFERENCES public.synthesis_runs(id) ON DELETE CASCADE,
    event_id           text REFERENCES public.venueops_events(event_id) ON DELETE CASCADE,
    slice_idx          integer NOT NULL,
    function_code      text NOT NULL,
    level              integer NOT NULL,
    headcount          integer NOT NULL,
    baseline           integer NOT NULL,
    timecard_mult      numeric NOT NULL DEFAULT 1.0,
    feedback_mult      numeric NOT NULL DEFAULT 1.0,
    binding_constraint text,
    explanation        jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT demand_tensor_function_code_chk
        CHECK (function_code IN ('F&B','Logistics','AV','FOH','Security')),
    CONSTRAINT demand_tensor_level_chk
        CHECK (level BETWEEN 0 AND 7),
    CONSTRAINT demand_tensor_slice_chk
        CHECK (slice_idx BETWEEN 0 AND 47),
    CONSTRAINT demand_tensor_headcount_chk
        CHECK (headcount >= 0 AND baseline >= 0)
);

CREATE INDEX IF NOT EXISTS demand_tensor_run_idx
    ON public.demand_tensor (synthesis_run_id);

CREATE INDEX IF NOT EXISTS demand_tensor_event_idx
    ON public.demand_tensor (event_id);

CREATE INDEX IF NOT EXISTS demand_tensor_lookup_idx
    ON public.demand_tensor (event_id, function_code, level, slice_idx);

ALTER TABLE public.demand_tensor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_demand_tensor" ON public.demand_tensor;
CREATE POLICY "authenticated_read_demand_tensor"
    ON public.demand_tensor
    FOR SELECT
    TO authenticated
    USING (true);

COMMENT ON TABLE public.demand_tensor IS
    'Demand engine L7: finalized headcount per (event, slice, function, level). Carries provenance via explanation JSON. Replaces demand_forecasts as the canonical engine output.';


CREATE TABLE IF NOT EXISTS public.demand_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code   text NOT NULL UNIQUE,
    cluster_key     jsonb NOT NULL,
    shifts          jsonb NOT NULL,
    source_event_ids text[] NOT NULL DEFAULT '{}'::text[],
    is_seeded       boolean NOT NULL DEFAULT false,
    is_active       boolean NOT NULL DEFAULT true,
    superseded_by   uuid REFERENCES public.demand_templates(id) ON DELETE SET NULL,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demand_templates_active_idx
    ON public.demand_templates (is_active);

CREATE INDEX IF NOT EXISTS demand_templates_cluster_key_gin
    ON public.demand_templates USING GIN (cluster_key);

ALTER TABLE public.demand_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_demand_templates" ON public.demand_templates;
CREATE POLICY "authenticated_read_demand_templates"
    ON public.demand_templates
    FOR SELECT
    TO authenticated
    USING (true);

COMMENT ON TABLE public.demand_templates IS
    'Demand engine L9: reusable shift-set templates per cluster_key (event_type, pax_band, service_type, alcohol, room_count_band). Seeded by ops at cold start; auto-generated once a cluster has k=10 events.';
