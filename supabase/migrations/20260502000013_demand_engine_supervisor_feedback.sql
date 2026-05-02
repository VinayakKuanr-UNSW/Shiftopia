-- Demand Engine Phase 1 (D): supervisor_feedback.
-- L5 structured post-event feedback. Closed reason taxonomy enforced via
-- CHECK constraint (free text only as supplement). Multipliers are computed
-- in app code from a trailing window of these rows.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feedback_verdict') THEN
        CREATE TYPE public.feedback_verdict AS ENUM ('UNDER','OVER','OK');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.supervisor_feedback (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id       text REFERENCES public.venueops_events(event_id) ON DELETE CASCADE,
    function_code  text NOT NULL,
    level          integer NOT NULL,
    slice_start    integer NOT NULL,
    slice_end      integer NOT NULL,
    verdict        public.feedback_verdict NOT NULL,
    severity       integer NOT NULL,
    reason_code    text NOT NULL,
    reason_note    text,
    supervisor_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    rule_version_at_event integer,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT supervisor_feedback_function_code_chk
        CHECK (function_code IN ('F&B','Logistics','AV','FOH','Security')),
    CONSTRAINT supervisor_feedback_level_chk
        CHECK (level BETWEEN 0 AND 7),
    CONSTRAINT supervisor_feedback_severity_chk
        CHECK (severity BETWEEN 1 AND 5),
    CONSTRAINT supervisor_feedback_slice_chk
        CHECK (slice_start BETWEEN 0 AND 47
               AND slice_end BETWEEN 0 AND 47
               AND slice_start <= slice_end),
    CONSTRAINT supervisor_feedback_reason_code_chk
        CHECK (reason_code IN (
            'peak_underestimated',
            'peak_overestimated',
            'bump_in_too_short',
            'bump_out_too_short',
            'vip_unforecasted',
            'weather_impact',
            'late_pax',
            'staff_no_show_masked',
            'other_with_note'
        )),
    CONSTRAINT supervisor_feedback_other_requires_note_chk
        CHECK (reason_code <> 'other_with_note' OR (reason_note IS NOT NULL AND length(reason_note) > 0))
);

CREATE INDEX IF NOT EXISTS supervisor_feedback_event_id_idx
    ON public.supervisor_feedback (event_id);

CREATE INDEX IF NOT EXISTS supervisor_feedback_bucket_idx
    ON public.supervisor_feedback (function_code, level, created_at DESC);

CREATE INDEX IF NOT EXISTS supervisor_feedback_supervisor_idx
    ON public.supervisor_feedback (supervisor_id, created_at DESC);

ALTER TABLE public.supervisor_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_supervisor_feedback" ON public.supervisor_feedback;
CREATE POLICY "authenticated_read_supervisor_feedback"
    ON public.supervisor_feedback
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "authenticated_insert_own_supervisor_feedback" ON public.supervisor_feedback;
CREATE POLICY "authenticated_insert_own_supervisor_feedback"
    ON public.supervisor_feedback
    FOR INSERT
    TO authenticated
    WITH CHECK (supervisor_id = auth.uid());

COMMENT ON TABLE public.supervisor_feedback IS
    'Demand engine L5: structured post-event supervisor feedback. Reason codes are a closed taxonomy; ''other_with_note'' requires reason_note. rule_version_at_event freezes the rule generation the feedback applies to.';
