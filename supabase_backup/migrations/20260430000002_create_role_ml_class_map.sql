-- DB-backed mapping from internal roles → ML model classes.
-- Replaces the regex heuristic in mlClient.service.ts (resolveMLRole).
-- Initial population mirrors the regex precedence so behavior is unchanged.
-- Going forward, ops can edit the mapping (admin UI or direct SQL) without a code deploy.

CREATE TABLE IF NOT EXISTS public.role_ml_class_map (
    role_id    uuid PRIMARY KEY REFERENCES public.roles(id) ON DELETE CASCADE,
    ml_class   text NOT NULL CHECK (ml_class IN ('Usher','Security','Food Staff','Supervisor')),
    source     text NOT NULL DEFAULT 'auto_regex' CHECK (source IN ('auto_regex','manual')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);

COMMENT ON TABLE  public.role_ml_class_map IS
    'Maps each internal role to one of the 4 ML model classes (Usher/Security/Food Staff/Supervisor). '
    'Roles without a row here are skipped by the shift synthesiser (no ML predictions available).';
COMMENT ON COLUMN public.role_ml_class_map.source IS
    'auto_regex = seeded from the original regex heuristic; manual = adjusted by ops.';

CREATE INDEX IF NOT EXISTS role_ml_class_map_class_idx ON public.role_ml_class_map (ml_class);

ALTER TABLE public.role_ml_class_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_role_ml_class_map"   ON public.role_ml_class_map;
DROP POLICY IF EXISTS "authenticated_write_role_ml_class_map"  ON public.role_ml_class_map;
DROP POLICY IF EXISTS "authenticated_update_role_ml_class_map" ON public.role_ml_class_map;

CREATE POLICY "authenticated_read_role_ml_class_map"
    ON public.role_ml_class_map FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "authenticated_write_role_ml_class_map"
    ON public.role_ml_class_map FOR INSERT
    TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = role_ml_class_map.role_id
          AND user_has_action_in_scope('shift.edit', NULL, r.department_id, r.sub_department_id)
    ));

CREATE POLICY "authenticated_update_role_ml_class_map"
    ON public.role_ml_class_map FOR UPDATE
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = role_ml_class_map.role_id
          AND user_has_action_in_scope('shift.edit', NULL, r.department_id, r.sub_department_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = role_ml_class_map.role_id
          AND user_has_action_in_scope('shift.edit', NULL, r.department_id, r.sub_department_id)
    ));

INSERT INTO public.role_ml_class_map (role_id, ml_class, source)
SELECT id,
       CASE
         WHEN name ~* '(supervisor|\ymanager\y|team\s*lead|coordinator|director|\yhead\y|\ychief\y|\yceo\y|duty)' THEN 'Supervisor'
         WHEN name ~* '(usher|greeter|ticketing)' THEN 'Usher'
         WHEN name ~* '(food|catering|f&b|beverage|\ybar\y|chef|cook|\ycafe\y|kitchen|waiter|waitress|\yserver\y)' THEN 'Food Staff'
         WHEN name ~* '(security|guard|\yrisk\y|safety)' THEN 'Security'
       END,
       'auto_regex'
FROM public.roles
WHERE is_active IS NOT FALSE
  AND CASE
        WHEN name ~* '(supervisor|\ymanager\y|team\s*lead|coordinator|director|\yhead\y|\ychief\y|\yceo\y|duty)' THEN 'Supervisor'
        WHEN name ~* '(usher|greeter|ticketing)' THEN 'Usher'
        WHEN name ~* '(food|catering|f&b|beverage|\ybar\y|chef|cook|\ycafe\y|kitchen|waiter|waitress|\yserver\y)' THEN 'Food Staff'
        WHEN name ~* '(security|guard|\yrisk\y|safety)' THEN 'Security'
      END IS NOT NULL
ON CONFLICT (role_id) DO NOTHING;
