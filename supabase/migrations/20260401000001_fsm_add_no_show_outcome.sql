-- FSM Migration Part 1: Add no_show to shift_assignment_outcome
-- MUST be in a separate committed transaction before any DML that uses the new value.
-- See: https://www.postgresql.org/docs/current/sql-altertype.html

ALTER TYPE public.shift_assignment_outcome ADD VALUE IF NOT EXISTS 'no_show';
