-- Synthesis Run Lifecycle Hardening
-- Adds a status column to track the lifecycle of a labor demand generation run.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synthesis_run_status') THEN
        CREATE TYPE public.synthesis_run_status AS ENUM ('draft', 'generated', 'reviewed', 'locked');
    END IF;
END $$;

ALTER TABLE public.synthesis_runs
    ADD COLUMN IF NOT EXISTS status public.synthesis_run_status NOT NULL DEFAULT 'generated';

COMMENT ON COLUMN public.synthesis_runs.status IS 'The lifecycle state of the synthesis run (e.g., draft, generated, reviewed, locked).';
