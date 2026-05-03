-- Without this seed, mapRowsToTensors returns zero tensors and rules_primary mode produces no shifts.
-- Idempotent: ON CONFLICT prevents duplicates. Weights default to 1.0; admin can edit later via a future UI.
--
-- Priority order used to prevent a sub-department from being mapped to more than one function:
--   Security > AV > F&B > Logistics > FOH
--
-- Back-office sub-departments intentionally skipped (no event-day demand signal):
--   Leadership, Accounts, Payroll, HR Operations, Partnering, Support, Infrastructure,
--   Maintenance, Electrical, Mechanical, Facilities
--
-- Sub-departments with ambiguous names that are intentionally scoped to one function:
--   "Technical" under AV dept            → AV     (priority wins over any Logistics reading)
--   "Technical" under Live Events dept   → AV     (same logic)
--   "Operations" under Security dept     → Security
--   "Operations" under Logistics dept    → Logistics
--   "Operations" under Event Delivery    → Logistics (generic ops; closest demand signal)
--   "Operations" under Live Events       → Logistics (same)
--   "Frontline" under Customer Services  → FOH    (customer-facing, maps to Front-of-House demand)
--   "Set-up" under Event Delivery        → Logistics
--   "Front of House" under Live Events   → FOH
--   "F&B" under Event Delivery           → F&B
--   "Kitchen" under Event Delivery       → F&B
--   "Logistics" under Event Delivery     → Logistics
--   "Security" under Event Delivery      → Security

DO $$
DECLARE
  v_sub_id   uuid;
  v_mapped   uuid[];   -- tracks already-mapped IDs to enforce single-function rule
BEGIN
  v_mapped := ARRAY[]::uuid[];

  -- -----------------------------------------------------------------------
  -- 1. SECURITY  (highest priority)
  --    Matches: 'security', 'guard', 'risk'
  --    Also captures: "Operations" sub-dept whose *parent department* is 'Security'
  -- -----------------------------------------------------------------------

  -- Named 'Security' (Event Delivery > Security)
  FOR v_sub_id IN
    SELECT sd.id
    FROM   public.sub_departments sd
    WHERE  sd.name ILIKE '%security%'
       OR  sd.name ILIKE '%guard%'
       OR  sd.name ILIKE '%risk%'
  LOOP
    IF NOT (v_sub_id = ANY(v_mapped)) THEN
      INSERT INTO public.function_map (function_code, sub_department_id, weight)
      VALUES ('Security', v_sub_id, 1.0)
      ON CONFLICT (function_code, sub_department_id) DO NOTHING;
      v_mapped := array_append(v_mapped, v_sub_id);
    END IF;
  END LOOP;

  -- "Operations" sub-dept whose parent department is named 'Security'
  FOR v_sub_id IN
    SELECT sd.id
    FROM   public.sub_departments sd
    JOIN   public.departments      d  ON d.id = sd.department_id
    WHERE  sd.name ILIKE 'operations'
      AND  d.name  ILIKE '%security%'
  LOOP
    IF NOT (v_sub_id = ANY(v_mapped)) THEN
      INSERT INTO public.function_map (function_code, sub_department_id, weight)
      VALUES ('Security', v_sub_id, 1.0)
      ON CONFLICT (function_code, sub_department_id) DO NOTHING;
      v_mapped := array_append(v_mapped, v_sub_id);
    END IF;
  END LOOP;

  -- -----------------------------------------------------------------------
  -- 2. AV  (second priority)
  --    Matches: 'av', 'audio', 'visual', 'media', 'production', 'tech'
  --    Also captures: "Technical" sub-depts whose parent is AV or Live Events
  -- -----------------------------------------------------------------------

  -- Generic name-based AV match (av, audio, visual, media, production)
  FOR v_sub_id IN
    SELECT sd.id
    FROM   public.sub_departments sd
    WHERE  sd.name ILIKE '%audio%'
       OR  sd.name ILIKE '%visual%'
       OR  sd.name ILIKE '%media%'
       OR  sd.name ILIKE '%production%'
       OR  sd.name ILIKE '% av %'
       OR  sd.name ILIKE 'av'
       OR  sd.name ILIKE 'av %'
       OR  sd.name ILIKE '% av'
  LOOP
    IF NOT (v_sub_id = ANY(v_mapped)) THEN
      INSERT INTO public.function_map (function_code, sub_department_id, weight)
      VALUES ('AV', v_sub_id, 1.0)
      ON CONFLICT (function_code, sub_department_id) DO NOTHING;
      v_mapped := array_append(v_mapped, v_sub_id);
    END IF;
  END LOOP;

  -- "Technical" sub-depts whose parent department is 'AV' or 'Live Events'
  FOR v_sub_id IN
    SELECT sd.id
    FROM   public.sub_departments sd
    JOIN   public.departments      d  ON d.id = sd.department_id
    WHERE  sd.name ILIKE 'technical'
      AND  (d.name ILIKE '%av%' OR d.name ILIKE '%live events%' OR d.name ILIKE '%audio%' OR d.name ILIKE '%visual%')
  LOOP
    IF NOT (v_sub_id = ANY(v_mapped)) THEN
      INSERT INTO public.function_map (function_code, sub_department_id, weight)
      VALUES ('AV', v_sub_id, 1.0)
      ON CONFLICT (function_code, sub_department_id) DO NOTHING;
      v_mapped := array_append(v_mapped, v_sub_id);
    END IF;
  END LOOP;

  -- -----------------------------------------------------------------------
  -- 3. F&B  (third priority)
  --    Matches: 'f&b', 'food', 'beverage', 'catering', 'bar', 'culinary', 'kitchen'
  --    NOTE: generic 'Food Service' matches but plain 'Service' does NOT.
  -- -----------------------------------------------------------------------

  FOR v_sub_id IN
    SELECT sd.id
    FROM   public.sub_departments sd
    WHERE  sd.name ILIKE '%f&b%'
       OR  sd.name ILIKE '%food%'
       OR  sd.name ILIKE '%beverage%'
       OR  sd.name ILIKE '%catering%'
       OR  sd.name ILIKE '%culinary%'
       OR  sd.name ILIKE '%kitchen%'
       OR  sd.name ILIKE '%bar%'
  LOOP
    IF NOT (v_sub_id = ANY(v_mapped)) THEN
      INSERT INTO public.function_map (function_code, sub_department_id, weight)
      VALUES ('F&B', v_sub_id, 1.0)
      ON CONFLICT (function_code, sub_department_id) DO NOTHING;
      v_mapped := array_append(v_mapped, v_sub_id);
    END IF;
  END LOOP;

  -- -----------------------------------------------------------------------
  -- 4. LOGISTICS  (fourth priority)
  --    Matches: 'logistics', 'setup', 'set-up', 'set up', 'cleaning', 'stewards'
  --    Also captures: "Operations" sub-depts whose parent is 'Logistics',
  --                   'Event Delivery', or 'Live Events'
  -- -----------------------------------------------------------------------

  -- Name-based logistics match
  FOR v_sub_id IN
    SELECT sd.id
    FROM   public.sub_departments sd
    WHERE  sd.name ILIKE '%logistics%'
       OR  sd.name ILIKE '%setup%'
       OR  sd.name ILIKE '%set-up%'
       OR  sd.name ILIKE '%set up%'
       OR  sd.name ILIKE '%cleaning%'
       OR  sd.name ILIKE '%steward%'
  LOOP
    IF NOT (v_sub_id = ANY(v_mapped)) THEN
      INSERT INTO public.function_map (function_code, sub_department_id, weight)
      VALUES ('Logistics', v_sub_id, 1.0)
      ON CONFLICT (function_code, sub_department_id) DO NOTHING;
      v_mapped := array_append(v_mapped, v_sub_id);
    END IF;
  END LOOP;

  -- "Operations" sub-depts whose parent is 'Logistics', 'Event Delivery', or 'Live Events'
  FOR v_sub_id IN
    SELECT sd.id
    FROM   public.sub_departments sd
    JOIN   public.departments      d  ON d.id = sd.department_id
    WHERE  sd.name ILIKE 'operations'
      AND  (
             d.name ILIKE '%logistics%'
          OR d.name ILIKE '%event delivery%'
          OR d.name ILIKE '%live events%'
           )
  LOOP
    IF NOT (v_sub_id = ANY(v_mapped)) THEN
      INSERT INTO public.function_map (function_code, sub_department_id, weight)
      VALUES ('Logistics', v_sub_id, 1.0)
      ON CONFLICT (function_code, sub_department_id) DO NOTHING;
      v_mapped := array_append(v_mapped, v_sub_id);
    END IF;
  END LOOP;

  -- -----------------------------------------------------------------------
  -- 5. FOH  (lowest priority)
  --    Matches: 'foh', 'front of house', 'reception', 'usher', 'greeter',
  --             'guest', 'frontline'
  -- -----------------------------------------------------------------------

  FOR v_sub_id IN
    SELECT sd.id
    FROM   public.sub_departments sd
    WHERE  sd.name ILIKE '%foh%'
       OR  sd.name ILIKE '%front of house%'
       OR  sd.name ILIKE '%reception%'
       OR  sd.name ILIKE '%usher%'
       OR  sd.name ILIKE '%greeter%'
       OR  sd.name ILIKE '%guest%'
       OR  sd.name ILIKE '%frontline%'
  LOOP
    IF NOT (v_sub_id = ANY(v_mapped)) THEN
      INSERT INTO public.function_map (function_code, sub_department_id, weight)
      VALUES ('FOH', v_sub_id, 1.0)
      ON CONFLICT (function_code, sub_department_id) DO NOTHING;
      v_mapped := array_append(v_mapped, v_sub_id);
    END IF;
  END LOOP;

END $$;

-- After applying, verify with:
-- SELECT fm.function_code, sd.name, fm.weight
-- FROM   public.function_map fm
-- JOIN   public.sub_departments sd ON sd.id = fm.sub_department_id
-- ORDER BY fm.function_code, sd.name;
