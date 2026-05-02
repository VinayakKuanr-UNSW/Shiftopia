-- Demand Engine Phase 1-B: starter rule library for L3 baseline.
-- All rules version=1, is_active=true. Rules are conservative; ops should
-- tune via the demand_rules admin UI once feedback (L5) signal is flowing.
--
-- Rule code naming: <function>_<descriptor>
-- Levels: L0..L4 = Casual, L5..L7 = Full Time (per org hierarchy).

INSERT INTO public.demand_rules (rule_code, function_code, level, applies_when, formula, priority, version, is_active, notes) VALUES

-- ── F&B ─────────────────────────────────────────────────────────────────
('fb_buffet_runners_l1',          'F&B', 1, '{"service_type":"buffet"}'::jsonb,
 'ceil(pax / 50)', 100, 1, true, 'Buffet runners: 1 per 50 pax.'),

('fb_buffet_runners_l2_large',    'F&B', 2, '{"service_type":"buffet","pax":">600"}'::jsonb,
 'ceil(pax / 200)', 100, 1, true, 'Senior buffet staff for large buffets.'),

('fb_plated_servers_l1',          'F&B', 1, '{"service_type":"plated"}'::jsonb,
 'ceil(pax / 12)', 100, 1, true, 'Plated service: 1 server per 12 pax.'),

('fb_plated_supervisors_l5',      'F&B', 5, '{"service_type":"plated","pax":">200"}'::jsonb,
 'ceil(pax / 200)', 100, 1, true, 'Plated supervisor (L5) for >200 pax.'),

('fb_cocktail_runners_l1',        'F&B', 1, '{"service_type":"cocktail"}'::jsonb,
 'ceil(pax / 75)', 100, 1, true, 'Cocktail service: 1 runner per 75 pax.'),

('fb_bartenders_l1_alcohol',      'F&B', 1, '{"alcohol":true}'::jsonb,
 'max(2, ceil(pax / 100))', 110, 1, true, 'Bartenders: floor 2, scale 1 per 100 pax.'),

('fb_bar_supervisor_l5',          'F&B', 5, '{"alcohol":true,"pax":">300"}'::jsonb,
 'ceil(pax / 400)', 110, 1, true, 'Bar supervisor for alcohol events >300 pax.'),

-- Pass-2 (level-dependent): F&B supervisor ratio
('fb_supervisor_ratio_l5',        'F&B', 5, '{}'::jsonb,
 'ceil(staff_at_levels[1] / 8)', 200, 1, true,
 'F&B supervisor ratio 1:8 (L5 per L1 staff). Pass-2: reads pass-1 totals.'),

-- ── Logistics ───────────────────────────────────────────────────────────
('logistics_room_setup_l2',       'Logistics', 2, '{"layout_complexity":"in:standard,complex"}'::jsonb,
 'room_count * (layout_complexity == "complex" ? 4 : 2)', 100, 1, true,
 'Room setup crew per room, scaled by complexity. NOTE: layout_complexity passed as feature.'),

('logistics_floor_l0_simple',     'Logistics', 0, '{"layout_complexity":"simple"}'::jsonb,
 'room_count', 100, 1, true, 'Simple setups: 1 floor staff per room.'),

('logistics_bump_in_crew_l2',     'Logistics', 2, '{"bump_in_min":">60"}'::jsonb,
 'ceil(room_count * 1.5)', 110, 1, true, 'Extra crew for non-trivial bump-in windows.'),

('logistics_bump_out_crew_l2',    'Logistics', 2, '{"bump_out_min":">60"}'::jsonb,
 'room_count', 110, 1, true, 'Bump-out crew per room.'),

('logistics_supervisor_l5',       'Logistics', 5, '{}'::jsonb,
 'ceil(staff_at_levels[2] / 6)', 200, 1, true,
 'Logistics supervisor (L5) per 6 L2 crew. Pass-2.'),

-- ── AV ──────────────────────────────────────────────────────────────────
('av_techs_l3_per_room',          'AV', 3, '{}'::jsonb,
 'room_count', 100, 1, true, 'One AV tech per room (baseline).'),

('av_lead_l5_multiroom',          'AV', 5, '{"room_count":">2"}'::jsonb,
 '1', 100, 1, true, 'AV lead (L5) when >2 rooms.'),

('av_extra_techs_large',          'AV', 3, '{"pax":">1500"}'::jsonb,
 'ceil(pax / 1000)', 110, 1, true, 'Extra AV for very large events.'),

-- ── FOH ─────────────────────────────────────────────────────────────────
('foh_ushers_l0',                 'FOH', 0, '{}'::jsonb,
 'ceil(pax / 100)', 100, 1, true, 'Ushers: 1 per 100 pax.'),

('foh_greeters_l1_large',         'FOH', 1, '{"pax":">300"}'::jsonb,
 'ceil(pax / 250)', 100, 1, true, 'Senior greeters for larger events.'),

('foh_supervisor_l5_pax',         'FOH', 5, '{"pax":">500"}'::jsonb,
 'ceil(pax / 800)', 110, 1, true, 'FOH supervisor for >500 pax.'),

('foh_supervisor_ratio_l5',       'FOH', 5, '{}'::jsonb,
 'ceil(staff_at_levels[0] / 10)', 200, 1, true,
 'FOH supervisor 1:10 across L0 ushers. Pass-2.'),

-- ── Security ────────────────────────────────────────────────────────────
('security_baseline_l3',          'Security', 3, '{}'::jsonb,
 'max(2, ceil(pax / 200))', 100, 1, true, 'Baseline security: floor 2, 1 per 200 pax.'),

('security_alcohol_bump_l3',      'Security', 3, '{"alcohol":true,"pax":">300"}'::jsonb,
 'ceil(pax / 200)', 110, 1, true, 'Alcohol uplift for >300 pax. Adds to baseline.'),

('security_lead_l5',              'Security', 5, '{"pax":">500"}'::jsonb,
 'ceil(pax / 1000)', 100, 1, true, 'Security lead (L5) for larger events.'),

('security_perimeter_l3_complex', 'Security', 3, '{"layout_complexity":"complex"}'::jsonb,
 'room_count', 110, 1, true, 'Perimeter cover for complex layouts.'),

('security_supervisor_ratio_l5',  'Security', 5, '{}'::jsonb,
 'ceil(staff_at_levels[3] / 8)', 200, 1, true,
 'Security supervisor 1:8 across L3 staff. Pass-2.')

ON CONFLICT (rule_code, version) DO NOTHING;
