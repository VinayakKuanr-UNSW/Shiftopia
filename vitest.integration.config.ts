import { defineConfig } from 'vitest/config';

// API integration tests: real HTTP against a LOCAL Supabase stack built from
// supabase/migrations + supabase/seeds (which matches production — see
// docs/operations/database-baseline.md). Kept apart from the unit suite
// (vitest.config.ts) because they need Docker and a running stack.
//
//   supabase start && npm run test:integration
export default defineConfig({
    test: {
        include: ['tests/integration/**/*.int.test.ts'],
        environment: 'node',
        globalSetup: ['tests/integration/setup/global-setup.ts'],
        // One shared database: files must not interleave their fixture resets.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
});
