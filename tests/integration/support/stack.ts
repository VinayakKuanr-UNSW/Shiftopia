/**
 * Where the local Supabase stack is, and how to reach its database.
 *
 * Everything here refuses to point anywhere but a local stack: these tests
 * create users, certificates and shifts, and reset fixture rows between probes.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface StackEnv {
    apiUrl: string;
    anonKey: string;
    serviceRoleKey: string;
    jwtSecret: string;
    dbContainer: string;
}

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'kong', 'host.docker.internal']);

/** Throws unless `apiUrl` is a local stack. Production must never be the target. */
function assertLocal(apiUrl: string): void {
    const host = new URL(apiUrl).hostname;
    if (!LOCAL_HOSTS.has(host)) {
        throw new Error(
            `Integration tests only run against a LOCAL Supabase stack; refusing ${apiUrl}. ` +
            'Start one with `supabase start` (see tests/integration/README.md).',
        );
    }
}

/**
 * Resolve the stack from the environment (`API_URL`, `ANON_KEY`,
 * `SERVICE_ROLE_KEY`, `JWT_SECRET` — the names `supabase status -o env`
 * prints), falling back to asking the CLI about the repo's own stack.
 */
export function resolveStackEnv(): StackEnv {
    let env: Record<string, string | undefined> = process.env;
    if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY || !env.JWT_SECRET) {
        env = { ...parseDotenv(runSupabaseStatus()), ...process.env };
    }
    const missing = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET'].filter((k) => !env[k]);
    if (missing.length) {
        throw new Error(`Local stack not found (missing ${missing.join(', ')}). Is \`supabase start\` running?`);
    }
    const apiUrl = env.API_URL!;
    assertLocal(apiUrl);
    return {
        apiUrl,
        anonKey: env.ANON_KEY!,
        serviceRoleKey: env.SERVICE_ROLE_KEY!,
        jwtSecret: env.JWT_SECRET!,
        dbContainer: env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectIdFromConfig()}`,
    };
}

function runSupabaseStatus(): string {
    try {
        return execFileSync('npx', ['--no-install', 'supabase', 'status', '-o', 'env'], {
            cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return '';
    }
}

function parseDotenv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
    return out;
}

function projectIdFromConfig(): string {
    const toml = readFileSync(resolve(REPO_ROOT, 'supabase/config.toml'), 'utf8');
    const m = /^project_id\s*=\s*"([^"]+)"/m.exec(toml);
    if (!m) throw new Error('supabase/config.toml has no project_id');
    return m[1];
}

/**
 * Run SQL in the stack's database as the `postgres` superuser and return the
 * rows as string arrays. For catalog checks and fixture resets only — every
 * behaviour under test goes through the HTTP API.
 */
export function psql(container: string, sql: string): string[][] {
    const out = execFileSync(
        'docker',
        ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
         '-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
        { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return out.split('\n').filter((l) => l.length > 0).map((l) => l.split('\t'));
}

/**
 * Run a SQL file the way `psql -f` would and return the NOTICE lines it
 * raised (the SQL harnesses report through RAISE NOTICE). Throws on error.
 */
export function sqlFileNotices(container: string, path: string): string[] {
    const res = spawnSync(
        'docker',
        ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
        { input: readFileSync(resolve(REPO_ROOT, path), 'utf8'), encoding: 'utf8' },
    );
    if (res.status !== 0) throw new Error(`${path} failed (exit ${res.status}): ${res.stderr}`);
    return res.stderr.split('\n')
        .map((l) => /NOTICE:\s{2}(.*)$/.exec(l)?.[1])
        .filter((l): l is string => l !== undefined);
}

/** Re-apply the persona fixtures (idempotent; ~50 ms). */
export function resetFixtures(container: string): void {
    const sql = readFileSync(resolve(REPO_ROOT, 'supabase/tests/access_matrix/01_fixtures.sql'), 'utf8');
    psql(container, `SET client_min_messages = warning;\n${sql}`);
}
