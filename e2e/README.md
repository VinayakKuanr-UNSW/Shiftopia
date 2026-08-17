# End-to-End Tests (Playwright)

Browser E2E tests that drive the real React app in Chromium. The app is the same
web bundle that ships inside the Capacitor Android shell, so these flows also
cover the Android app's behaviour (minus native-only features such as biometric
unlock — those are validated via the Android device test matrix, T17BALMOND-23).

## Prerequisites

- A `.env` with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (the app's backend).
- Test credentials via `E2E_EMAIL` / `E2E_PASSWORD` — set them in `.env` locally
  (see `.env.example`) or as CI secrets. Use a shared non-production test account;
  never commit real values.

First-time browser download (headed chromium + the headless shell used for
default headless runs):

```sh
npx playwright install chromium chromium-headless-shell
```

## Run

```sh
npm run test:e2e          # headless run (auto-starts the dev server on :8080)
npm run test:e2e:ui       # interactive UI mode
npm run test:e2e:report   # open the last HTML report
```

## Layout

| File | Purpose |
|------|---------|
| `auth.setup.ts` | Logs in once via the real UI, saves the session to `e2e/.auth/user.json` |
| `swap-journey.spec.ts` | T17BALMOND-17 — peer-to-peer swap journey |

The `setup` project authenticates first; specs reuse the stored session, so they
start signed in without re-logging-in per test.

## Notes

- Tests run against the **deployed** Supabase. The swap journey spec is
  **read-only** — it does not write swap data to the shared backend.
- The full mutation journey (offer → accept → manager approve) needs ≥2 seeded
  employee accounts with swappable shifts; it's scoped as a follow-up.
