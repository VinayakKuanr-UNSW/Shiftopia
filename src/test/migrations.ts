/**
 * Find migration SQL for the source-reading parity tests.
 *
 * supabase/migrations holds the current baseline (a schema dump of production)
 * plus whatever has been applied since. The migrations a baseline replaced are
 * kept, unchanged, in supabase/migrations_archive_pre_baseline_<date>/ (see
 * docs/operations/database-baseline.md). A test that pins TypeScript against
 * the migration that introduced a rule finds it by name wherever it lives now,
 * so the next re-baseline does not break it again.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// From a string, not `new URL(…)`: the jsdom environment replaces the global URL.
const SUPABASE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase');

const LIVE_MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations');

/** The current baseline: everything production ran up to the last re-baseline. */
export const BASELINE_FILE = '20251015000000_baseline_schema.sql';

/** The live directory first, then every archive, newest first. */
function migrationDirs(): string[] {
    const archives = readdirSync(SUPABASE_DIR)
        .filter((d) => d.startsWith('migrations_archive_pre_baseline_'))
        .sort()
        .reverse()
        .map((d) => join(SUPABASE_DIR, d));
    return [LIVE_MIGRATIONS_DIR, ...archives];
}

/** Path of the migration with exactly this file name, wherever it lives. */
export function migrationPath(fileName: string): string {
    for (const dir of migrationDirs()) {
        const p = join(dir, fileName);
        if (existsSync(p)) return p;
    }
    throw new Error(`migration ${fileName} is not in supabase/migrations or any archive`);
}

export function readMigrationFile(fileName: string): string {
    return readFileSync(migrationPath(fileName), 'utf8');
}

/** The first migration whose file name contains `fragment` (live directory first). */
export function findMigrationByName(fragment: string): string {
    for (const dir of migrationDirs()) {
        const hit = readdirSync(dir).find((f) => f.includes(fragment) && f.endsWith('.sql'));
        if (hit) return join(dir, hit);
    }
    throw new Error(`no migration matching "${fragment}"`);
}

/**
 * Every migration file that was ever applied, once per file name, sorted by
 * name (version). A live copy wins over an archived one of the same name —
 * that is how the baseline file supersedes the older baselines.
 */
export function allMigrationFiles(): { name: string; path: string }[] {
    const seen = new Map<string, string>();
    for (const dir of migrationDirs()) {
        for (const f of readdirSync(dir)) {
            if (f.endsWith('.sql') && !seen.has(f)) seen.set(f, join(dir, f));
        }
    }
    return [...seen].map(([name, path]) => ({ name, path })).sort((a, b) => a.name.localeCompare(b.name));
}
