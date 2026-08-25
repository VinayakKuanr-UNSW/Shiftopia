#!/usr/bin/env node
/**
 * Regenerate src/platform/supabase/types.ts from the linked Supabase project.
 *
 * WHY THIS SCRIPT EXISTS. The file it writes is generated, but nothing in the
 * repo said so: it carried no header, and there was no command to rebuild it.
 * So it was hand-edited instead — and by the time anyone looked, it was 3,001
 * diff lines behind production: 13 tables and 38 functions missing, four
 * relations still typed as TABLES after they became VIEWS over `hr`, and a
 * `template_shifts.target_employment_type` NOT NULL column typed as optional,
 * which hid a live 23502 on the template-duplicate path from the type checker.
 *
 * A generated file with no generator is just a stale file with extra steps.
 *
 * Usage:  npm run db:types
 * Then:   npx tsc -p tsconfig.app.json --noEmit
 *
 * A regeneration that changes the file is not a failure — it is the schema
 * having moved. Commit the result with whatever code change it forces.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/platform/supabase/types.ts');
const CONFIG = resolve(ROOT, 'supabase/config.toml');

// Read the ref from config.toml rather than hardcoding it, so a fork pointed at
// a different project regenerates against ITS project and not this one.
const config = readFileSync(CONFIG, 'utf8');
const match = config.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
if (!match) {
    console.error(`[gen-types] No project_id found in ${CONFIG}`);
    process.exit(1);
}
const projectId = match[1];

const HEADER = `// =============================================================================
// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Regenerate with:  npm run db:types
//
// Every edit made here is silently reverted by the next regeneration, and in
// the meantime the type checker is asserting things about the database that
// are not true. If a type here is wrong, the schema is what needs changing.
// =============================================================================

`;

console.log(`[gen-types] Generating types for project ${projectId}...`);

let body;
try {
    body = execFileSync(
        'npx',
        ['supabase', 'gen', 'types', 'typescript', '--project-id', projectId],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
} catch (err) {
    console.error('[gen-types] supabase CLI failed. Are you logged in (`npx supabase login`)?');
    console.error(err.stderr?.toString?.() ?? err.message);
    process.exit(1);
}

if (!body.includes('export type Database')) {
    console.error('[gen-types] Output does not look like generated types; refusing to write.');
    process.exit(1);
}

writeFileSync(OUT, HEADER + body);
console.log(`[gen-types] Wrote ${OUT} (${body.split('\n').length} lines).`);
console.log('[gen-types] Now run: npx tsc -p tsconfig.app.json --noEmit');
