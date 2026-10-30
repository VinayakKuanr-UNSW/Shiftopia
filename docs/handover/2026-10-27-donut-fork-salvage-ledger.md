# Donut fork salvage ledger (2026-10-27)

Fork: `github.com/unsw-cse-comp99-3900/capstone-project-26t2-9900-t19b-donut`, cloned (gitignored) at
`./capstone-project-26t2-9900-t19b-donut`. History fetched to the scratch ref `refs/donut/main`.

- Merge base `99ec855c` (2026-06-24). Theirs since: 311 commits (166 non-merge). Ours: 282, plus a
  re-baselined DB, so most of their screen-level edits land on code that no longer exists in that form.
- Method: 5 read-only triage passes (core RLS, ML/ops RLS + edge functions, mobile, features/fixes,
  tests/tooling), every RLS claim checked against the LIVE dev DB, every bug claim against our HEAD.
- Buckets: **C** = bug/gap still present in our HEAD · **D** = capability worth porting ·
  **B** = regression here (reject) · **A** = already equal/better here · **E** = not applicable.

**Status 2026-10-27:** Tier 1 done (uncommitted), each with a regression test that fails on the old
code, except #4 (ShiftAuditDialog was latent, not live: React tolerates a 0↔N hook switch; fixed
anyway, no test) and #8 (verified by a real build). Tier 2: #9, #11, #13 applied live as
`20261026141924_close_open_reads`; #12 applied as `20261026142004_retire_dead_tables` (8 tables; the
legacy `swap_requests`/`swap_validations` were kept, as DB functions still use them). Tier 4 not started.

**#10 profiles PII:** code done (no `*` reads of profiles anywhere, guarded by
`profiles-no-wildcard-select.test.ts`; Settings reads your own phone via `get_my_private_profile()`, applied
live as `20261027071427`; this also fixed Settings wiping your phone on save). The column REVOKE is
**pending deploy**: the currently deployed frontend still runs `select('*')` on profiles, and a 42501 there is
treated as a rejected credential, so applying it first would sign every user out. Apply this once the
frontend from this commit is live (web + any Android build in use):

```sql
REVOKE SELECT ON public.profiles FROM authenticated, anon;
GRANT SELECT (
  id, employee_code, first_name, last_name, full_name, email, avatar_url,
  employment_type, legacy_system_role, hire_date, termination_date, is_active,
  last_login_at, created_at, updated_at, legacy_organization_id, middle_name,
  status, availability, legacy_employee_id, legacy_department_id,
  can_access_all_departments, employee_id, preferences, rest_gap_agreement_8h,
  continuous_service_start
) ON public.profiles TO authenticated, anon;
-- hidden: phone, date_of_birth, emergency_contact_name, emergency_contact_phone.
-- A NEW profiles column is unreadable by clients until it is added to this list.
```

**Tier 3 (2026-10-27):** #14 calendar export DONE (web: .ics + Google + Outlook; native app: Google +
Outlook only, since a Blob download does nothing in the WebView). #15 offline cache DONE (IndexedDB, 24h,
tagged with the user id; previous user's data wiped from memory and disk on sign-out/switch; shift dialog
read-only offline). #18 install guide DONE for iPhone/iPad and Android browsers without an install event
(Chrome-family keeps one-tap install); the banner also no longer hides behind the phone bottom nav.
#16, #17, #19: not wanted. Face ID: already ours (`BiometricLockGate`, re-locks on resume; the plugin
supports iOS Face ID). #20 push reliability: DEFERRED with a condition: push is not live (`send-push` not
deployed, no webhook, 0 device tokens). When push is switched on, deliver through a DB outbox + scheduled
worker with retry, not a fire-and-forget webhook (a webhook does not retry, so one FCM/edge blip silently
loses that notification, including urgent shift offers).

## Tier 1: confirmed bugs in our code (fix regardless of donut)

| # | Item | Evidence | Size |
|---|------|----------|------|
| 1 | **Projection worker dead in production builds.** `new URL('./projection.worker.ts', import.meta.url)` gets inlined as `data:video/mp2t;base64,<raw TS>`; no `onerror`, no sync fallback, so People/Group/Events/Roles projections and planner stats never load (Vercel + Android). Dev server hides it. | Verified 10-27 with `vite build`: decoded data URL is the `.ts` source. `projection.worker.client.ts:54`. Donut `6f85a01d` = `?worker` import + fallback to `runProjectionPipeline`. | S–M |
| 2 | **Broadcast notifications list crashes.** `getForUser` selects `broadcast_notifications`, which has no `priority`/`subject`/`author`; `BroadcastNotificationsList.view.tsx:97` calls `.replace` on undefined. Live trigger `trg_fan_out_broadcast` fills the table on every send. Fix by joining `broadcasts`, not donut's `??` placeholders. | Donut `a1cfb6ac`; live schema checked | S |
| 3 | **No `.dockerignore`.** `Dockerfile.web` `COPY . .` sends `.env.local` (DB password, Vercel token), `.env.graphify` (Gemini key) and the 823 MB macOS `node_modules` into the build. | Donut has one | S |
| 4 | **Hook-order crashes + dead filter** (found by ESLint during triage, not from donut): `AvailabilityScreen.tsx:88` early return before 6 hooks; `ShiftAuditDialog.tsx:65` before `useMemo` at :96; `UnifiedSwapModal.tsx:242` `if (!hardBlocks.length \|\| true)`. | Source read | S |
| 5 | **"Low" broadcast priority always fails to send.** Live check constraint allows normal/high/urgent only (`ComposeSection.tsx:163`); real error replaced by generic toast (`useBroadcasts.ts:463`). | Donut `ad68be8e` | S |
| 6 | **Withdrawn bids counted and offered for assignment**, which then fails `WINNER_NOT_PENDING` (`useOpenShifts.ts:89`, `useShiftBids.ts:65`). | Donut `6c2d831a` (part) | S |
| 7 | **Bulk publish says "Publish 0 Shifts?" with Confirm enabled** when all fail compliance; per-shift reasons dropped (`BulkActionsToolbar.tsx:216-227`, `:698`). | Donut `bdefcfd6` (part) | S |
| 8 | **Sentry blind + sourcemaps public.** `setSentryUser` has no caller; `vite.config.ts:142` always emits sourcemaps and only deletes them when a Sentry token is present (Vercel Git builds likely lack it; check env); CI never passes `VITE_SENTRY_DSN`. | Donut `9c275c91`, `fa171326` | S |

## Tier 2: security gaps still open live (DB, each migration confirmed before apply)

| # | Item | Evidence | Size |
|---|------|----------|------|
| 9 | **`predicted_labor_demand` readable with the anon key** (500 rows): policy "Allow anon select" `USING (true)` + anon SELECT grant. No `src/` reader; ML uses service role. Drop policy, revoke anon. | Live `pg_policies`; donut `30f3bd69` | S |
| 10 | **`profiles` PII readable by every signed-in user** (501 rows: DOB, phone, emergency contact, termination date). Donut's fix is a no-op here (everyone has a contract). Needs column-level revoke + definer RPC; `auth.service.ts:98` `select('*')` must narrow first. | Live; donut `1875da3c` (B) | M |
| 11 | **Broadcast acks / read status / group members open reads**, while the rest of broadcasts is group-scoped. Donut's read halves use our live helpers: near drop-in. | `751459f9`, `6d5c07ef`, `046a0d00` | S |
| 12 | **Dead-table retirement migration**: `employee_reliability_metrics` (500 rows of no-show/late rates, open to all, no code refs), `rest_period_violations`, legacy `swap_requests`/`swap_approvals`/`swap_validations`, ~8 total with no rows/refs. Drop instead of hardening. | A1/A2 sweeps | M |
| 13 | **Small scoping fixes**: `employee_suitability_scores` → self or `can_act_on_employee('bid.view')` (NOT donut's self-only, which breaks `useShiftBids.ts:117`); `bulk_operations` actor-only (`6789ed08`); `shift_templates` any-user UPDATE of drafts (donut missed; table empty, caller `rosters.api.ts:60` likely dead). | Live | S |

Defer: roster group/subgroup name scoping (would hide group names on My Roster, swaps, bids); bulk anon SELECT revoke across the schema (worth a separate pass).

## Tier 3: features (your call)

| # | Item | Notes | Size |
|---|------|-------|------|
| 14 | **Calendar export (ICS / Google / Outlook)** | `shift-calendar.ts` is pure and tested; hand-port the dialog buttons only. Android .ics needs `@capacitor/filesystem` + `@capacitor/share`. Skip APNs code in the same commit. `6bd75b84`, `8d9a09a4` | S–M |
| 15 | **Persisted offline cache** (roster, broadcasts, notifications) | Real gap: app boots offline, banner says "showing saved data", My Roster is empty. Port fixing 4 defects: gcTime < maxAge, whitelist keys don't match ours, cache not user-keyed (next user on a shared device sees previous roster), `navigator.onLine`-only check. **Privacy decision**: roster + broadcast text on device ≤24h. | M |
| 16 | **Reject bid with reason + notify employee** | No reject path today. Their RPC writes `shifts` directly (bypasses `sm_apply_shift_op`) and authorises via old certificates + `legacy_system_role` backdoor: rebuild on `can_act_on_shift('bid.assign')`. | M |
| 17 | **Shift share link + `/shifts/:id`** | Drop their hard-coded Vercel host and Apple team ID; their page knows 3 of 5 roster groups. Android App Links need our prod domain + signing key. `bf30bb2f`, `33514249` | M |
| 18 | **iOS Safari "Add to Home Screen" guide** | Our prompt relies on `beforeinstallprompt`, which iOS never fires. | S |
| 19 | **iOS app** | They ship a Capacitor 8 Xcode project (Face ID, Universal Links, APNs, share/filesystem/splash). Don't copy `ios/`: generate ours with `npx cap add ios`, then port behaviour. Needs an Apple Developer account. One biometric plugin only (ours: `@aparajita/capacitor-biometric-auth`). | L |
| 20 | **Durable push outbox** (from their APNs worker) | Retry/backoff/stale-lease pattern for our FCM `send-push`. Defer unless push reliability matters. | M |

## Tier 4: tooling, tests, docs, small a11y

| # | Item | Size |
|---|------|------|
| 21 | CI pytest job for `optimizer-service/tests` and `ml/tests` (also catches stale optimizer image) | S |
| 22 | Docker: build args + fail-fast env check, `docker/nginx.conf` (healthcheck, no-store on `index.html`/`sw.js`, immutable `/assets`), `run-prod.sh --wait`. NOT their compose `ml` env (disables ML auth). | S |
| 23 | Tests worth adapting: `useTemplateEditor.test.tsx`, `shiftSynthesizer.policy.test.ts`, `compliance/utils.test.ts` | S each |
| 24 | Install `@vitest/coverage-v8` (`npm run test:coverage` exists, package missing) | S |
| 25 | Disaster-recovery runbook, rewritten from our facts (two prod data-loss incidents, no runbook) | M |
| 26 | a11y batch: `<html lang>` on language switch; timesheet badges unreadable in light mode; toast close button unlabeled + invisible on touch; LogsPane icon buttons title-only + 24px; long URLs overflow broadcast cards (`MessageItem.tsx:109`); light `--destructive` 3.76:1 | S each |

## Rejected (do not re-litigate)

- **Access escalation**: epsilon gets user/contract management (live `user.edit` is zeta only); delta/epsilon seeded `shift.assign` (breaks view-only); `isAdmin`/`auth_can_manage_users` loosened + `legacy_system_role` backdoor.
- **Audit forgery**: client INSERT on `shift_events`.
- **Visibility breaks**: their `shift_swaps` read policy hides the open-swap marketplace and scoped managers' swaps; `shift_bids` read drops view-only managers; `supervisor_feedback` self-only breaks ML calibration reads.
- **Their `evaluate-compliance` edge function**: service role with no caller check, so anyone with a token can probe any employee; hard-coded 48h cap. (We are deleting ours.)
- **Scope filter back to single-select** (`9975890b`): reopens the closed `org_ids[0]` defect class.
- **Tooling**: ESLint config demoting every rule (incl. rules-of-hooks) to warn; bare `tsc --noEmit` gate; `package.json` dropping our android/db:types/holiday/integration scripts; `vite.config` dropping android mode + PWA manifest; `vercel.json` deleting HSTS/CSP/X-Frame-Options; README `supabase db push`; Playwright suite writing to the shared dev DB with hard-coded creds and swallowed failures.
- **Per-screen mobile restyles / R5 polish / Accessible View**: conflict with the page layout contract and 75% root font; one restyles GlobalScopeFilter.
- **Portrait lock**: recommend NOT locking (managers use the roster grid in landscape on tablets).
- **Their SQL as-is**: joins `public.roles.department_id`/`sub_department_id`; here `public.roles` is a view with `subdepartment_id`, and `user_contracts`/`remuneration_levels` are views over `hr.*`. Every DB item is re-derived on our helpers.

## Already ours (A)

Android shell, PWA, biometric lock + re-lock on resume, FCM push, role-aware nav, mobile logout (via almond `d4ba1627`); PageState; every write-side RLS gap they closed (our 07-19 / 10-05 / 10-11 / 10-15 sweeps); `get-roster-view` select change; autoschedule sessions/assignments policies.

Per-cluster detail (evidence, file:line, SQL) was in the session scratchpad `donut-ledger/{A1,A2,B,C,D}.md`.
