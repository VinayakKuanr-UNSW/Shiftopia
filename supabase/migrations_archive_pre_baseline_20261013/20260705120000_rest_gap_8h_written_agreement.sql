-- ICC EBA clause 40.2 — 8h minimum break by written agreement
--
-- Per-employee opt-in flag. When true, the minimum CROSS-DAY rest gap for this
-- Team Member is reduced from the default 10h (clause 40.1) to 8h, reflecting a
-- written mutual agreement between the Employer and the Team Member.
--
-- Read-only in the compliance modal (mirrors the student-visa work-rights flag);
-- it drives ComplianceCheckInput.rest_gap_hours (10 → 8) which flows into the
-- V8 engine's min_rest_gap_minutes.

ALTER TABLE "public"."profiles"
    ADD COLUMN IF NOT EXISTS "rest_gap_agreement_8h" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."profiles"."rest_gap_agreement_8h" IS
    'ICC EBA cl. 40.2: written agreement to an 8h (vs 10h default) minimum break between days. Drives ComplianceCheckInput.rest_gap_hours.';
