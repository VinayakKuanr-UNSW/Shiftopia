-- Splits logistics_room_setup_l2 into standard/complex variants.
-- The original used `layout_complexity` as a formula variable, which the rule
-- DSL does not support — only applies_when handles string features.
-- Original rule deactivated, not deleted, so audit logs/explanations
-- referencing it remain valid.

-- ── 1. Deactivate the broken rule ────────────────────────────────────────────
UPDATE demand_rules
SET    is_active = false
WHERE  rule_code = 'logistics_room_setup_l2';

-- ── 2. Insert replacement rules (standard / complex split) ───────────────────
INSERT INTO demand_rules
  (rule_code, function_code, level, applies_when, formula, priority, version, is_active, notes)
VALUES
  (
    'logistics_room_setup_l2_standard',
    'Logistics',
    2,
    '{"layout_complexity":"standard"}'::jsonb,
    'room_count * 2',
    100,
    1,
    true,
    'Standard layout: 2 setup crew per room.'
  ),
  (
    'logistics_room_setup_l2_complex',
    'Logistics',
    2,
    '{"layout_complexity":"complex"}'::jsonb,
    'room_count * 4',
    100,
    1,
    true,
    'Complex layout: 4 setup crew per room.'
  )
ON CONFLICT (rule_code, version) DO NOTHING;
