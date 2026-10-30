/**
 * Supabase clients for each kind of caller.
 *
 * Persona tokens are HS256 JWTs signed with the stack's JWT secret — the same
 * kind GoTrue issues — so PostgREST, RLS, auth.uid() and edge functions see
 * exactly what they see for a real signed-in user. No sign-in round trip, and
 * no passwords on the fixture users.
 */

import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { inject } from 'vitest';
import type { StackEnv } from './stack';

// Untyped schemas: the tests address tables by name across `public` and `hr`.
export type Client = SupabaseClient<any, any, any>;

export type Persona = 'A' | 'B' | 'D' | 'DD' | 'E' | 'E2' | 'F' | 'G' | 'G2' | 'X' | 'Z';

export function stack(): StackEnv {
    return inject('stack');
}

export function personaId(p: Persona): string {
    const id = inject('personas')[p];
    if (!id) throw new Error(`Unknown persona ${p} — is supabase/tests/access_matrix/01_fixtures.sql loaded?`);
    return id;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** Sign an access token for `sub` the way GoTrue would. */
export function mintAccessToken(sub: string, secret: string, ttlSeconds = 3600): string {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
        sub, aud: 'authenticated', role: 'authenticated',
        iat: now, exp: now + ttlSeconds,
        email: `${sub}@test.invalid`, app_metadata: {}, user_metadata: {},
    }));
    const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${sig}`;
}

function client(key: string, bearer: string, schema: 'public' | 'hr' = 'public'): Client {
    return createClient(stack().apiUrl, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        db: { schema },
    });
}

/** Someone holding only the public anon key — i.e. anyone on the internet. */
export function anonClient(schema: 'public' | 'hr' = 'public'): Client {
    const { anonKey } = stack();
    return client(anonKey, anonKey, schema);
}

/** A signed-in fixture persona (see supabase/tests/access_matrix/README.md). */
export function personaClient(p: Persona, schema: 'public' | 'hr' = 'public'): Client {
    const { anonKey, jwtSecret } = stack();
    return client(anonKey, mintAccessToken(personaId(p), jwtSecret), schema);
}

export function personaToken(p: Persona): string {
    return mintAccessToken(personaId(p), stack().jwtSecret);
}
