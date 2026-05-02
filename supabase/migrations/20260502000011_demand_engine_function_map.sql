-- Demand Engine Phase 1 (D): function_map.
-- Maps the 5 demand functions (F&B, Logistics, AV, FOH, Security) to
-- sub_departments. Many-to-many. Weight allows a sub_dept to be split across
-- functions when needed; weights for a given sub_dept must sum to 1.0
-- (enforced in app code at edit time, not as a constraint, since partial
-- inserts during admin edits would otherwise fail).

CREATE TABLE IF NOT EXISTS public.function_map (
    function_code     text NOT NULL,
    sub_department_id uuid NOT NULL REFERENCES public.sub_departments(id) ON DELETE CASCADE,
    weight            numeric NOT NULL DEFAULT 1.0,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (function_code, sub_department_id),
    CONSTRAINT function_map_function_code_chk
        CHECK (function_code IN ('F&B','Logistics','AV','FOH','Security')),
    CONSTRAINT function_map_weight_chk
        CHECK (weight > 0 AND weight <= 1.0)
);

CREATE INDEX IF NOT EXISTS function_map_sub_department_id_idx
    ON public.function_map (sub_department_id);

ALTER TABLE public.function_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_function_map" ON public.function_map;
CREATE POLICY "authenticated_read_function_map"
    ON public.function_map
    FOR SELECT
    TO authenticated
    USING (true);

COMMENT ON TABLE public.function_map IS
    'Demand engine L2: maps demand functions (F&B/Logistics/AV/FOH/Security) to sub_departments. Weight splits a sub_dept across functions when applicable.';
