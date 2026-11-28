-- Published rate cards are immutable (docs/architecture/multi-organization.md
-- §11.1 R12). A published card prices every shift in its period — including
-- shifts already worked, since costs are computed when read — so changing one
-- of its lines, or its period, silently reprices history. Every change goes
-- through a draft (roll_rate_card_forward / update_rate_card_loadings) and
-- takes effect on publish_rate_card.
--
-- Until now that rule lived only in the RPCs (each checks status = 'draft');
-- the owner, service_role, or a future definer function could still write a
-- published card's lines. These triggers make it a database invariant:
--
--   * eba_rate, eba_allowance, eba_trainee_schedule, pay_rate_card_loadings:
--     no INSERT / UPDATE / DELETE whose old or new rate_card_id is a published
--     card. The parent row is read FOR SHARE, so a line write racing
--     publish_rate_card (which locks the card FOR UPDATE) waits and then sees
--     the card as published.
--   * pay_rate_cards: a published card cannot be deleted, and its only legal
--     change is closing an open-ended period (valid_to NULL → a date), which is
--     what publish_rate_card does to the card it supersedes.
--
-- Break-glass: `SET pay.rate_card_lock = 'off'` (session or transaction) lets
-- a maintenance session through. Only the generated reference seed (which
-- inserts published cards before their lines) and test clean-up use it.
-- Clients cannot reach it: authenticated / anon hold SELECT only on these
-- tables, and PostgREST exposes no way to set an arbitrary GUC.
--
-- Refusals raise 55000 (object_not_in_prerequisite_state), the code the RPCs
-- already use for "card is published".

CREATE OR REPLACE FUNCTION public.fn_rate_card_line_published_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_ids  uuid[] := '{}';
    v_card record;
BEGIN
    IF current_setting('pay.rate_card_lock', true) = 'off' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_ids := v_ids || OLD.rate_card_id; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_ids := v_ids || NEW.rate_card_id; END IF;

    -- Lock regardless of status: filtering on status here would take no lock
    -- on a draft and let a concurrent publish slip in between.
    FOR v_card IN
        SELECT c.code, c.status FROM public.pay_rate_cards c WHERE c.id = ANY (v_ids) FOR SHARE
    LOOP
        IF v_card.status = 'published' THEN
            RAISE EXCEPTION 'card % is published; its % lines cannot change — roll it forward into a draft', v_card.code, TG_TABLE_NAME
                USING ERRCODE = '55000';
        END IF;
    END LOOP;
    RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_rate_card_published_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF current_setting('pay.rate_card_lock', true) = 'off' OR OLD.status <> 'published' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'card % is published and cannot be deleted', OLD.code USING ERRCODE = '55000';
    END IF;
    -- Closing an open-ended period is the one change publish_rate_card makes.
    IF to_jsonb(NEW) - 'valid_to' - 'updated_at' = to_jsonb(OLD) - 'valid_to' - 'updated_at'
       AND (NEW.valid_to IS NOT DISTINCT FROM OLD.valid_to
            OR (OLD.valid_to IS NULL AND NEW.valid_to IS NOT NULL)) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'card % is published; only closing its open-ended period is allowed', OLD.code
        USING ERRCODE = '55000';
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_rate_card_line_published_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_rate_card_published_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_eba_rate_published_lock ON public.eba_rate;
CREATE TRIGGER trg_eba_rate_published_lock
    BEFORE INSERT OR UPDATE OR DELETE ON public.eba_rate
    FOR EACH ROW EXECUTE FUNCTION public.fn_rate_card_line_published_lock();

DROP TRIGGER IF EXISTS trg_eba_allowance_published_lock ON public.eba_allowance;
CREATE TRIGGER trg_eba_allowance_published_lock
    BEFORE INSERT OR UPDATE OR DELETE ON public.eba_allowance
    FOR EACH ROW EXECUTE FUNCTION public.fn_rate_card_line_published_lock();

DROP TRIGGER IF EXISTS trg_eba_trainee_schedule_published_lock ON public.eba_trainee_schedule;
CREATE TRIGGER trg_eba_trainee_schedule_published_lock
    BEFORE INSERT OR UPDATE OR DELETE ON public.eba_trainee_schedule
    FOR EACH ROW EXECUTE FUNCTION public.fn_rate_card_line_published_lock();

DROP TRIGGER IF EXISTS trg_pay_rate_card_loadings_published_lock ON public.pay_rate_card_loadings;
CREATE TRIGGER trg_pay_rate_card_loadings_published_lock
    BEFORE INSERT OR UPDATE OR DELETE ON public.pay_rate_card_loadings
    FOR EACH ROW EXECUTE FUNCTION public.fn_rate_card_line_published_lock();

DROP TRIGGER IF EXISTS trg_pay_rate_cards_published_lock ON public.pay_rate_cards;
CREATE TRIGGER trg_pay_rate_cards_published_lock
    BEFORE UPDATE OR DELETE ON public.pay_rate_cards
    FOR EACH ROW EXECUTE FUNCTION public.fn_rate_card_published_lock();
