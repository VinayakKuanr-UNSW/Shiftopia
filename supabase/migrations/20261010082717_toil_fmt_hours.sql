-- toil_fmt printed "8.9#h": '#' is not a to_char pattern. Hours to at most
-- two decimals, trailing zeros dropped: 8.9h, 2h, 0.25h.
CREATE OR REPLACE FUNCTION internal.toil_fmt(p_minutes integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
    SELECT rtrim(rtrim(to_char(round(coalesce(p_minutes, 0) / 60.0, 2), 'FM9999990.00'), '0'), '.') || 'h';
$$;

REVOKE EXECUTE ON FUNCTION internal.toil_fmt(integer) FROM PUBLIC, anon, authenticated;
