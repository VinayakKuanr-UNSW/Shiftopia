-- `chk_created_from` enumerated 'capture' | 'manual' | 'import', which predates
-- the Baseline FT pattern designer. That designer writes a normal
-- roster_templates row, and rejecting its provenance value made the insert fail
-- with 23514 -- surfaced through PostgREST as a bare 400, which is why the UI
-- could only say "the pattern could not be saved".
--
-- Widening rather than reusing 'manual' on purpose: `created_from` exists to
-- record HOW a template came about, and a designed baseline is a different
-- thing from one somebody typed. Recording it as 'manual' would make the column
-- lie in exactly the situation it was added for.
--
-- Widening a CHECK cannot invalidate an existing row, so this needs no backfill.

alter table public.roster_templates
    drop constraint if exists chk_created_from;

alter table public.roster_templates
    add constraint chk_created_from check (
        created_from = any (array['capture'::text, 'manual'::text, 'import'::text, 'baseline_ft'::text])
    );

comment on column public.roster_templates.created_from is
    'How the template was produced: capture (from a roster), manual (authored), import, baseline_ft (Baseline FT pattern designer).';
