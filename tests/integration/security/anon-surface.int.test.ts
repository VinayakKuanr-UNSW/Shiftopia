/**
 * What can someone with only the anon key reach?
 *
 * The anon key ships inside the web bundle, so treat it as public: anything
 * it can read or call, anyone on the internet can. These checks pin the
 * anonymous attack surface so that any NEW exposure fails CI:
 *
 *   - no SECURITY DEFINER routine in an API-exposed schema is executable by anon
 *   - every view in an API-exposed schema runs as the caller (security_invoker)
 *   - over HTTP, anon reads no rows anywhere except the reviewed list below
 *   - over HTTP, every SECURITY DEFINER RPC refuses anon before its body runs
 *
 * The persona fixtures are loaded, so there is real data to leak.
 */

import { describe, expect, it } from 'vitest';
import { stack } from '../support/clients';
import { psql } from '../support/stack';

const EXPOSED_SCHEMAS = ['public', 'hr'];  // supabase/config.toml [api] schemas

/**
 * Relations an anonymous caller can read rows from — each one a reviewed
 * decision. Adding to this list is a security decision; say why.
 *
 * Empty since the 2026-10-13 review closed the five it found (org structure via
 * `public_read`; the venue event schedule and model coefficients the ML service
 * read with the anon key). No signed-out screen reads any table.
 */
const ANON_READABLE: Record<string, string> = {};

/** Created by supabase/tests/access_matrix/01_fixtures.sql; exists only in test databases. */
const TEST_ONLY = new Set(['public._t_persona']);

const schemaList = EXPOSED_SCHEMAS.map((s) => `'${s}'`).join(',');

describe('anonymous attack surface', () => {
    it('no SECURITY DEFINER routine in an API-exposed schema is executable by anon', () => {
        const rows = psql(stack().dbContainer, `
            SELECT p.oid::regprocedure::text
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN (${schemaList}) AND p.prokind IN ('f', 'p') AND p.prosecdef
               AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
               AND has_function_privilege('anon', p.oid, 'EXECUTE')
             ORDER BY 1`);
        expect(rows.map((r) => r[0])).toEqual([]);
    });

    it('every view in an API-exposed schema runs with the caller\'s rights (security_invoker)', () => {
        const rows = psql(stack().dbContainer, `
            SELECT c.oid::regclass::text
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN (${schemaList}) AND c.relkind = 'v'
               AND NOT coalesce(c.reloptions::text[] && ARRAY['security_invoker=true', 'security_invoker=on'], false)
             ORDER BY 1`);
        expect(rows.map((r) => r[0])).toEqual([]);
    });

    it('anon can write to nothing: no INSERT / UPDATE / DELETE / TRUNCATE on any table or view', () => {
        const rows = psql(stack().dbContainer, `
            SELECT c.oid::regclass::text
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN (${schemaList}) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
               AND (has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
                    OR has_table_privilege('anon', c.oid, 'DELETE') OR has_table_privilege('anon', c.oid, 'TRUNCATE'))
             ORDER BY 1`);
        expect(rows.map((r) => r[0])).toEqual([]);
    });

    it('no client role holds TRUNCATE, REFERENCES, TRIGGER or MAINTAIN (PostgREST never needs them)', () => {
        const rows = psql(stack().dbContainer, `
            SELECT c.oid::regclass::text || ' ' || r.role
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
                   unnest(ARRAY['anon', 'authenticated']) AS r(role)
             WHERE n.nspname IN (${schemaList}) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
               AND (has_table_privilege(r.role, c.oid, 'TRUNCATE') OR has_table_privilege(r.role, c.oid, 'REFERENCES')
                    OR has_table_privilege(r.role, c.oid, 'TRIGGER') OR has_table_privilege(r.role, c.oid, 'MAINTAIN'))
             ORDER BY 1`);
        expect(rows.map((r) => r[0])).toEqual([]);
    });

    it('no materialized view is readable by anon or authenticated (they have no RLS)', () => {
        const rows = psql(stack().dbContainer, `
            SELECT c.oid::regclass::text
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN (${schemaList}) AND c.relkind = 'm'
               AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'))
             ORDER BY 1`);
        expect(rows.map((r) => r[0])).toEqual([]);
    });

    it('over HTTP, anon reads no rows outside the reviewed list', async () => {
        const { apiUrl, anonKey, dbContainer } = stack();
        const relations = psql(dbContainer, `
            SELECT n.nspname, c.relname
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN (${schemaList}) AND c.relkind IN ('r', 'p', 'v', 'm')
               AND has_table_privilege('anon', c.oid, 'SELECT')
             ORDER BY 1, 2`);
        expect(relations.length).toBeGreaterThan(50);  // the sweep really ran

        const readable: string[] = [];
        for (const [schema, rel] of relations) {
            const name = `${schema}.${rel}`;
            if (TEST_ONLY.has(name)) continue;
            const res = await fetch(`${apiUrl}/rest/v1/${rel}?select=*&limit=1`, {
                headers: { apikey: anonKey, 'Accept-Profile': schema },
            });
            const body = await res.json();
            if (res.ok && Array.isArray(body) && body.length > 0) readable.push(name);
            else if (!res.ok) expect([401, 403], `${name}: ${res.status} ${JSON.stringify(body)}`).toContain(res.status);
        }
        expect(readable.sort()).toEqual(Object.keys(ANON_READABLE).sort());
    });

    it('over HTTP, every SECURITY DEFINER RPC refuses anon before its body runs', async () => {
        const { apiUrl, anonKey, dbContainer } = stack();
        // One call per routine, every named argument null. Refusal (42501) comes
        // from the EXECUTE check, before the body could act on those nulls.
        const routines = psql(dbContainer, `
            SELECT n.nspname, p.proname,
                   coalesce((SELECT json_object_agg(a, NULL) FROM unnest(p.proargnames[1:p.pronargs]) a WHERE a <> ''), '{}'::json)::text
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN (${schemaList}) AND p.prokind = 'f' AND p.prosecdef
               AND p.prorettype <> 'trigger'::regtype
               AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
             ORDER BY 1, 2`);
        expect(routines.length).toBeGreaterThan(100);

        const unexpected: string[] = [];
        let refused = 0;
        for (const [schema, fn, args] of routines) {
            const res = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, {
                method: 'POST',
                headers: { apikey: anonKey, 'Content-Type': 'application/json', 'Content-Profile': schema },
                body: args,
            });
            const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
            if (res.status === 401 && body?.code === '42501') refused++;
            // Overloads PostgREST cannot tell apart by argument names are not
            // reachable by name at all; the catalog test above covers them.
            else if (!(res.status === 300 && body?.code === 'PGRST203')) {
                unexpected.push(`${schema}.${fn}: ${res.status} ${body?.code ?? ''} ${body?.message ?? ''}`);
            }
        }
        expect(unexpected).toEqual([]);
        expect(refused).toBeGreaterThan(100);  // the sweep really ran; 148 definer RPCs live 2026-10-29
    });
});
