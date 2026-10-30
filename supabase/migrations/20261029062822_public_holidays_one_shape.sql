-- public_holidays: one column per fact.
--
-- The table carried each fact twice. Checked live on 2026-10-29 (205 rows,
-- 2024–2040, all AU-NSW): no function body and no code reads the three columns
-- dropped here — every reader (fn_eba_estimate_shift_cost,
-- recompute_fairness_ledger, shift_day_typed_shortfall,
-- public_holiday_calendar_horizon, jurisdiction_is_known,
-- internal.toil_absence_credit_minutes) uses holiday_date and jurisdiction.
--   - holiday_name: equal to name on every row (name is NOT NULL; it stays).
--   - applies_to_state: 'NSW' on every row; jurisdiction ('AU-NSW', NOT NULL)
--     is the column the readers key on.
--   - is_national: true on an arbitrary 15 rows and read by nothing.
-- The two SELECT policies were identical (authenticated, USING true); one goes.
--
-- Rollback: ~/Documents/superman-db-exports/2026-10-29/public-holidays-columns/
-- (restore_columns.sql, dropped_columns.csv keyed by id, dropped_policy.sql).

ALTER TABLE public.public_holidays
  DROP COLUMN holiday_name,
  DROP COLUMN applies_to_state,
  DROP COLUMN is_national;

DROP POLICY "Everyone can view public holidays" ON public.public_holidays;
