// =============================================================================
// Colocated vitest config for the PURE auto-verify-timesheets module.
//
// The project root vitest.config.ts only includes `src/**`, so it will not pick
// up this test. Run it explicitly with:
//
//     npx vitest run --config supabase/functions/auto-verify-timesheets/vitest.config.ts
//
// `root: __dirname` scopes the glob here; `node` env + no setup files keep it
// free of jsdom / react / Supabase globals. The module under test (variance.ts)
// is pure TS with zero Deno/DB dependencies.
// =============================================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: __dirname,
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts'],
  },
});
