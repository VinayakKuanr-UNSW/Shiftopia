-- Drop nine indexes that exactly duplicate another index on the same table.
--
-- "Exact" = same table, access method, key columns, opclasses, collations,
-- sort options, expressions and predicate (compared in pg_index, not by name).
-- None of these backs a constraint, is CLUSTERed or the replica identity, or
-- has a pg_depend dependent, and nothing outside migrations names them.
--
-- Eight shadow the index of a UNIQUE constraint on the same column(s); the
-- constraint's index stays and serves the same lookups:
--   profiles(email)                          kept profiles_email_key
--   timesheets(shift_id)                     kept timesheets_shift_id_key
--   employee_suitability_scores(employee_id) kept employee_suitability_scores_employee_id_key
--   public_holidays(holiday_date)            kept public_holidays_holiday_date_key
--   system_config(config_key)                kept system_config_config_key_key
--   work_rules(rule_name)                    kept work_rules_rule_name_key
--   shift_compliance_snapshots(shift_id)     kept shift_compliance_snapshots_shift_id_key
--   shift_payroll_records(shift_id)          kept shift_payroll_records_shift_id_key
-- One is a second copy of a plain index; the one the planner uses stays:
--   shift_events(employee_id, event_time DESC) kept idx_shift_events_employee_id_event_time_desc
--
-- Left alone: auth.custom_oauth_providers (Supabase-managed schema).
--
-- Rollback:
--   CREATE INDEX idx_profiles_email ON public.profiles USING btree (email);
--   CREATE INDEX idx_public_holidays_date ON public.public_holidays USING btree (holiday_date);
--   CREATE INDEX idx_scs_shift_id ON public.shift_compliance_snapshots USING btree (shift_id);
--   CREATE INDEX idx_shift_events_employee_id_time ON public.shift_events USING btree (employee_id, event_time DESC);
--   CREATE INDEX idx_spr_shift_id ON public.shift_payroll_records USING btree (shift_id);
--   CREATE INDEX idx_suitability_scores_employee ON public.employee_suitability_scores USING btree (employee_id);
--   CREATE INDEX idx_system_config_key ON public.system_config USING btree (config_key);
--   CREATE INDEX idx_timesheets_shift ON public.timesheets USING btree (shift_id);
--   CREATE INDEX idx_work_rules_name ON public.work_rules USING btree (rule_name);

DROP INDEX public.idx_profiles_email;
DROP INDEX public.idx_timesheets_shift;
DROP INDEX public.idx_suitability_scores_employee;
DROP INDEX public.idx_public_holidays_date;
DROP INDEX public.idx_system_config_key;
DROP INDEX public.idx_work_rules_name;
DROP INDEX public.idx_scs_shift_id;
DROP INDEX public.idx_spr_shift_id;
DROP INDEX public.idx_shift_events_employee_id_time;
