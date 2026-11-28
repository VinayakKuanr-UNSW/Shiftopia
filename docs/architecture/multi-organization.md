# Multiple Organizations — Decisions and Assumptions

**Status:** Living. Started 2026-11-26, when Brisbane Convention & Exhibition Centre (BCEC)
became the second organization.
**Scope:** everything that had to change for the platform to hold more than one
organization: tenant isolation, holidays, pay, and choosing an organization in the app.

Every entry is tagged:

- **Decided** — the product owner chose it (date given).
- **Assumed** — chosen during implementation; holds until someone says otherwise.
- **Open** — waiting on a decision; no code depends on it yet.
- **Verified** — checked against live data or code (date given).

When an entry turns out wrong, change its tag and say what replaced it. Do not delete
it: why the code looks the way it does is the point of this file.

---

## 1. Tenancy

| ID | Statement | Tag | Where it lives |
|---|---|---|---|
| T1 | The platform holds several organizations. Supersedes decision 9 of [access-suites-plan.md](access-suites-plan.md) ("one organization"). | Decided 2026-11-25 | — |
| T2 | `public.organizations / departments / sub_departments` is the canonical org tree. All three duplicate `hr.*` mirrors (`hr.organizations`, `hr.departments`, `hr.subdepartments`) are retired; `hr.roles` and `public.role_ml_class_map` RLS policies now reference `public.sub_departments` / `public.departments` (§14). | Built 2026-11-28 | `20261125192153_organizations_hardening`, `20261125200241_drop_hr_organizations`, `20261128093400_org_tree_departments_unification` |
| T3 | Administrator (zeta) is the administrator of **its own organization**: the one on the contract that carries it. No level reaches across organizations. | Decided 2026-11-25 | `20261125192142_tenant_isolation_foundation` |
| T4 | Work across organizations (creating one, support) uses the service role, not an in-app level. There is no in-app "create organization". | Assumed (follows T3) | foundation migration drops `organizations_insert` |
| T5 | A person is a member of an organization if they hold any contract there, in any status, so people keep seeing the organization their past records belong to. | Assumed | `public.is_org_member` |
| T6 | Reference data (pay rates, allowances, venue catalogue, skills, licences, work rules, cancellation reasons, system config) belongs to one organization. Universal data (public holidays by jurisdiction, the RBAC action list) stays global. | Decided 2026-11-25 | per-table reviews |
| T7 | Still "Administrator anywhere", fixed when each table gets `organization_id`: `pay_periods`, `system_config`, `work_rules`, `demand_templates`, performance metrics/snapshots, roster template edits, broadcasts and their storage. None can leak while no second organization holds data in them. | Verified 2026-11-25 | foundation migration header |

## 2. BCEC

| ID | Statement | Tag |
|---|---|---|
| B1 | Name "Brisbane Convention & Exhibition Centre", code `BCEC`, jurisdiction `AU-QLD`, website bcec.com.au. Address, phone and email left for its Administrator. | Decided 2026-11-26 |
| B2 | Starter structure: Administration › Management with one "Administrator" role, written to both org-tree copies under the same ids. The real structure is built in the app. | Decided 2026-11-26 |
| B3 | Its first Administrator is the existing ICC Sydney Administrator (account "Kurry Admin"), read as the account the product owner uses ("me"). | Assumed |
| B4 | That access rides on a **zero-hour Casual contract at EBA level 1**. The contract guardrails forbid a second Full-Time position, or any Part-Time one, beside the existing Full-Time contract; Casual adds no hours, no annual or personal leave, and no pay unless shifts are rostered. | Assumed |

## 3. Public holidays

| ID | Statement | Tag | Where it lives |
|---|---|---|---|
| H1 | The 205 AU-NSW rows are exactly `date-holidays` AU/NSW, type `public`, 2024–2040. | Verified 2026-11-26 | — |
| H2 | AU-QLD uses the same source and range (201 rows), without Christmas Eve: Queensland observes it from 6pm only and the table stores whole days. | Decided 2026-11-26 | live data + `supabase/seeds/reference.sql` |
| H3 | A date can be a holiday in several jurisdictions: the key is `(holiday_date, jurisdiction)`. | Assumed (forced by H2) | `20261125193848_public_holidays_multi_jurisdiction` |
| H4 | TOIL absence credit counts only holidays of the jurisdictions where the person holds a Full-Time or Part-Time contract that week. | Assumed | same migration |
| H5 | The client holiday table (`core/lib/holidays.ts`) and all client callers (cost/award engines, payroll, V8 compliance, shift-shape gate, templates, leave, timesheets, AutoScheduler, and every calendar/roster UI surface) now resolve the shift's or organization's jurisdiction (`organizations.jurisdiction`), falling back to `DEFAULT_JURISDICTION = 'AU-NSW'` only when no org context exists. `holidays-db-parity.test.ts` compares every jurisdiction day by day against `supabase/seeds/reference.sql`. | Built 2026-11-28 | `src/modules/core/lib/holidays.ts`, `jurisdiction-registry.ts`, `organizationJurisdiction.ts`, `useJurisdiction.ts` |
| H6 | **Ekka** (Royal Queensland Show day) is a public holiday in Brisbane only, held on its own jurisdiction `AU-QLD-BNE` under `AU-QLD` (§5). 17 rows, 2024–2040. | Built 2026-11-28 | `20261127235949_jurisdictions_hierarchy` + seed |
| H7 | The shift-shape trigger and template application used to call `shift_day_typed_shortfall` without a jurisdiction (so `'AU-NSW'`); both now pass the shift's organization's jurisdiction, and the function has no default. | Built 2026-11-28 | same migration |
| H8 | Until BCEC's instrument is known (B6), its shifts are checked with the ICC Sydney EA's day-typed rules, so a refusal cites "ICC EBA cl 56.2". | Assumed — interim |

## 4. Pay: rate cards

### 4.1 What is wrong today (Verified 2026-11-26)

- `eba_rate`, `eba_allowance` and `eba_trainee_schedule` have no organization: every
  organization would be paid ICC Sydney's enterprise agreement.
- The rates exist twice: the database tables, and embedded TypeScript copies
  (`rate-schedule.ts` `RATE_SCHEDULE`, `trainee_matrix.ts`, `apprentice_matrix.ts`) that the
  authoritative TypeScript engine reads because it runs in a worker without database
  access. The rate admin screens only read the database, so every rate change is made
  twice by hand.
- `fn_eba_estimate_shift_cost` prices public holidays against `'AU-NSW'`, and the client
  holiday table is NSW (H5).
- Penalty, overtime, night and minimum-engagement rules are code — TypeScript, plus the
  SQL port described in [pay-cost-engine.md](pay-cost-engine.md) — written for the ICC
  Sydney EA.

### 4.2 The idea: rate cards

Borrowed in spirit from venue-management price lists — one list per context, the price
lives on the item, lists are copied and retired rather than edited in place — adapted to
wages. Names and behaviour are ours.

| Price-list idea | Rate card here |
|---|---|
| A price list | A **rate card**: one pay agreement (an EA or award) for one organization, e.g. "ICC Sydney EA 2025". |
| Unique code | `code`, unique within the organization. |
| Currency | `currency`, `AUD` by default. |
| Start / end date (informational) | The agreement's nominal term, informational. Rates inside a card stay effective-dated, so a CPI step is a new version of the card's rates, not a new card. |
| Organization default (only one) | `is_default`, one per organization. |
| Price class limiting which lists an account may use | A contract may name a card; otherwise its organization's default applies. |
| Items carrying price and cost | **Rate lines** (classification × employment basis → ordinary and paid hourly rate), **allowances** (code → amount, unit), the **trainee and apprentice matrices**. |
| Markup over a base price | The existing CPI step: the next version = the previous × (1 + %). |
| Copy a list / copy items | Copy a card, with or without its rates — e.g. to start a new organization from an existing agreement. |
| Retire instead of delete | `retired_at`: not offered for new contracts; history stays. Deleting is refused once anything was priced from it. |
| A privilege for changing lists | New action `payroll.manage` (Administrator, organization scope); reading stays `payroll.view`. |

### 4.3 Assumptions

| ID | Statement | Tag |
|---|---|---|
| P1 | A rate card holds what people are **paid** (cost). A charge-out price to clients is not modelled until client billing exists. | Assumed |
| P2 | The rules (penalties, overtime, nights, minimum engagement) stay in code. A card holds the numbers and names the rule set it is paid under; today there is one, `icc_sydney_ea`. A second agreement with different rules is a code change, reviewed like any pay change. | Decided 2026-11-26 |
| P3 | The database is the single writable source of rates. The embedded TypeScript copies go; the worker receives the rates of the card(s) it prices. | Assumed |
| P4 | An organization with no default card is not priced: the engines say "no rate card" rather than fall back to another organization's rates. BCEC stays unpriced until its agreement is entered. | Decided 2026-11-26 |
| P5 | The tables keep their `eba_*` names and gain `rate_card_id`; renaming is a later, cosmetic change. | Decided 2026-11-26 |
| P6 | Holidays for pricing come from the shift's organization's jurisdiction (§5), in both engines and in the client table (H5). | Assumed |

### 4.4 Phases

1. **Database.** `pay_rate_cards` (organization, code, name, currency, term, default, rule
   set, retired); `rate_card_id` on the three rate tables, backfilled to one ICC Sydney card;
   optional `user_contracts.rate_card_id`; readers resolve contract card → organization
   default; holidays by the shift's jurisdiction; RLS by organization.
2. **Client.** Rate admin per organization: list, create, copy, retire, set default, edit
   rates (writable through `payroll.manage`). The worker gets its rates from the database;
   the embedded copies and their sync tests go. The client holiday table becomes
   per-jurisdiction (H5) and the parity test compares every jurisdiction again.
3. **BCEC.** Its card, once its agreement's rates are known.

## 5. Jurisdictions below the state (Ekka)

| ID | Statement | Tag |
|---|---|---|
| J1 | `public.jurisdictions` with a parent: `AU` → `AU-NSW`, `AU-QLD` → `AU-QLD-BNE`. A holiday applies to its jurisdiction and every jurisdiction under it (`jurisdiction_lineage`); an organization names its most specific one. Foreign keys replaced the CHECK that called `jurisdiction_is_known()`. National days stay on the state rows; `AU` holds none. | Built 2026-11-28 |
| J2 | BCEC's jurisdiction is `AU-QLD-BNE`. | Built 2026-11-28 |
| J3 | Ekka is the Wednesday of the Royal Queensland Show, which starts on the first Friday of August, or the second Friday when the first falls before 5 August. This reproduces the gazetted dates for 2024–2026 (14 Aug 2024, 13 Aug 2025, 12 Aug 2026). Later years are derived from the rule; the Queensland government can move the day (it did in 2021 and 2022), so check each year when it is gazetted. | Assumed — built (DB 2024–2040, client 2024–2075) |

## 6. Choosing an organization in the app

| ID | Statement | Tag |
|---|---|---|
| S1 | Nothing lets a person with access in two organizations choose between them: `setActiveCertificateId` has no caller, so the app uses whichever highest-level certificate comes first. | Verified 2026-11-26 |
| S2 | An "Organization" choice appears in the account menu (sidebar) only when a person's certificates span more than one organization. Choosing one makes their highest certificate in that organization active. | Assumed — built (`organizationChoice.ts`, `SidebarUser.tsx`) |
| S3 | The choice is remembered per browser (`localStorage`, per person); a first visit opens the organization of the oldest highest-level certificate (ICC Sydney for the current Administrator). Certificates are now fetched oldest first so this is deterministic. | Assumed — built |
| S4 | The switcher sets `accessScope`, which three things read: the Settings page (which organization it edits), branding, and `OrgSelectionContext` (My Roster, Labour Demand, Manager Swaps — its department choice now resets on a switch). Pages on `GlobalScopeFilter` have their own organization picker built from the scope tree ("All Venues" or one venue) and do not follow the switcher. Not yet checked: pages that list data without either (e.g. the Users page reads every contract RLS admits, so an Administrator of two organizations sees both). | Verified 2026-11-26 — partial; rest Open |

## 7. Order of work

Decided 2026-11-26: (1) the organization switcher (§6), (2) the jurisdiction hierarchy,
Ekka and the per-jurisdiction client holiday table (§5, H5), (3) pay rate cards (§4),
database then client. Each lands as its own PR through CI.

## 8. Follow-ups outside these three fixes

- ~~Apply the `hr.organizations` drop~~ (done, PR #68 / `20261125200241_drop_hr_organizations`).
- ~~Retire the `hr.departments / hr.subdepartments` mirrors (Wave 2 review)~~ (done, §14 / `20261128093400_org_tree_departments_unification`).

## 9. Global expansion (scoped 2026-11-28)

Venues in North America and Europe are being considered. The scope, with evidence and
the order of work, is [global-expansion-scope.md](global-expansion-scope.md).

| ID | Statement | Tag |
|---|---|---|
| B5 | BCEC's timezone is `Australia/Brisbane` (no daylight saving). `shifts.timezone` defaults to `Australia/Sydney` and organizations have no timezone, so a BCEC shift would be an hour wrong from October to April. No BCEC shift exists yet. | Verified 2026-11-28 — fix with §3.1 of the scope |
| J4 | Fix 2 (jurisdictions table, Ekka) is built but **not applied**, and is paused: jurisdiction codes must follow ISO 3166-2 (digits allowed, e.g. `PT-13`) with country-level parents (`AU`, `US`, `GB`, …) before it goes in. | Assumed |
| P2 | Revisit: per-agreement code paths do not scale to dozens of collective agreements; a rule-set catalogue (values per agreement) is proposed. For this run: keep rules as code, behind a rule-set interface the engines call by name (G5). | Decided 2026-11-28 (this run) |
| G0 | **This run builds for Australia only** (APAC scope, no other APAC country). North America and Europe stay scoped, not built. | Decided 2026-11-28 |
| G1 | Which venue types are in scope (rostering vs hospitality/commercial partnerships). | Deferred (no non-Australian venue this run) |
| G2 | No operator/group level this run: venue = organization; people at several venues hold a contract at each; the switcher moves between them. | Decided 2026-11-28 (this run) |
| G3 | One database, Supabase `ap-southeast-1`, for this run (all data is Australian). | Decided 2026-11-28 (follows G0) |
| G4 | English only this run; dates and numbers in `en-AU`. | Decided 2026-11-28 (follows G0) |
| G5 | Rules stay code for this run, behind a rule-set seam so a catalogue can replace them later without touching callers. | Decided 2026-11-28 |
| G6 | AUD only this run; rate cards still carry a currency. | Decided 2026-11-28 (follows G0) |
| G7 | No non-Australian pilot this run. | Deferred |
| B6 | BCEC's industrial instrument (its own EA or a modern award) is unknown; BCEC stays unpriced (P4) until its terms and rates are provided. | Decided 2026-11-28 |

### Order of work for this run (supersedes §7)

1. **Fix 2, adjusted:** jurisdictions with ISO 3166-2 codes and a country parent (`AU` → `AU-NSW`, `AU-QLD` → `AU-QLD-BNE`), Ekka, per-jurisdiction client holidays.
2. **Time foundation:** `organizations.timezone` (BCEC `Australia/Brisbane`), every hardcoded `'Australia/Sydney'` (38 SQL functions, ~45 client files) replaced by the shift's or organization's timezone, scheduled jobs by local time.
3. **Pay:** the rule-set seam (ICC EA as its first entry), then rate cards.

## 10. Venue time (built 2026-11-28)

| ID | Statement | Tag |
|---|---|---|
| V1 | Instants are stored in UTC (`timestamptz`); a shift is authored as the venue's wall clock (`shift_date` + `start_time`) plus the venue's IANA zone; `start_at`/`end_at` are derived from them (`trg_recalc_shift_utc_timestamps`). | Verified (existing model) |
| V2 | `organizations.timezone` (IANA, required, validated on write). ICC Sydney `Australia/Sydney`, BCEC `Australia/Brisbane`. | Built |
| V3 | A shift's timezone is always its organization's (trigger `trg_01_shift_timezone_from_organization`, ahead of every trigger that reads it); whatever a caller sends is replaced. The column keeps its old default only for trigger-less test sessions. | Built |
| V4 | "Today" is the venue's date (`organization_today(org)`): contract lifecycle and pay terms, the first-aid history guard, the casual-fairness nightly run. Start, lock and delete checks use the shift's own zone. | Built |
| V5 | A shift belongs to the date it starts (day divide = start day). An overnight shift across a daylight-saving change is paid by elapsed hours, because `end_at` is derived from the wall clock in the venue's zone. | Assumed (existing behaviour) |
| V6 | Scheduled jobs keep their fixed UTC schedules; only their date logic follows the venue. Fine while every venue is in Australia; venues 10+ hours apart would need jobs grouped by region. | Decided 2026-11-28 |
| V7 | Deferred, because their Sydney date only errs safe (Sydney is never behind Brisbane, so they treat Brisbane's last hour of the day as past): `apply_template_to_date_range_v2` (its `start_at` is recomputed by the trigger anyway), `preview_template_application`, `add/delete/rename_roster_subgroup_*`. Also deferred: the TOIL helpers (salaried staff, ICC only), the `COALESCE(timezone, 'Australia/Sydney')` fallbacks (dead once every shift has its zone), and the client's Sydney helpers (display already uses the naive wall clock; its "has it started" checks are advisory — the database decides). | Deferred |
| V8 | Moving a shift to another organization by changing only `organization_id` re-stamps its zone but does not recompute `start_at`; shifts do not move between organizations today. | Known limitation |
## 11. Pay rate cards — phase 1, database (built 2026-11-28)

| ID | Statement | Tag |
|---|---|---|
| R1 | `public.pay_rate_cards`: organization, code (unique per organization), name, currency (`AUD`), `rule_set` (only `icc_sydney_ea`), informational term, `is_default` (one per organization), `retired_at`. Members read their organization's cards; only the service role writes. | Built |
| R2 | `eba_rate`, `eba_allowance`, `eba_trainee_schedule` carry `rate_card_id` (required); their keys and lookups lead with it. Every existing rate belongs to ICC Sydney's card `ICC-EA`. Rates are readable by members of the card's organization (were readable by everyone). | Built |
| R3 | Pricing (`internal.shift_pay_terms`, `internal.shift_cost`) uses the shift's organization's default card and jurisdiction; the inner functions take them as parameters and refuse to run without them. | Built |
| R4 | No default card → `shift_pay_terms` returns nothing and `fn_eba_shift_cost` returns NULL, not 0 (P4). BCEC is unpriced until its card exists (B6). | Built |
| R5 | Deferred (YAGNI): a contract naming its own card; writes from the app (`payroll.manage`); the client engine and rate admin (phase 2 — the embedded `RATE_SCHEDULE` copies and the CPI wizard's SQL snippet, which still emits the old `ON CONFLICT` key). Holiday confirmation status / year-end close: not decided. | Deferred |

### 11.1 Cards per period, the rate-card API, multipliers and holidays (decided 2026-11-28)

The user asked for: no CPI wizard, an API instead; a card per financial year; multipliers on base rates; holidays automated rather than confirmed by hand. Built in that order; R6–R9 built, R10–R11 next.

| ID | Statement | Tag |
|---|---|---|
| R6 | A card is one agreement's rates for one **period** (normally a financial year): `valid_from`, `valid_to` (NULL = until the next card), `status` `draft` → `published`, `derivation`, `published_at` / `published_by`. Lines lost `effective_from`: the card's period is the only date. Replaces R1's `is_default` / `retired_at` / term. ICC Sydney's two rate sets became `ICC-EA-2025` (2025-01-01 → 2026-07-05) and `ICC-EA-2026-27` (from 2026-07-06, open-ended). Codes name the period explicitly (`2026-27` = 1 July 2026 – 30 June 2027) because some older names (e.g. migration `eba_rate_fy2026`) use "FY2026" for the year *starting* July 2026, while the ATO convention names a financial year by the year it ends. | Built |
| R7 | A shift is priced from the **published** card of its organization whose period covers the shift date (`organization_rate_card(org, date)`); none → unpriced (NULL), as R4. Published periods of one organization never overlap (exclusion constraint). Drafts price nothing. | Built |
| R8 | The API, replacing the CPI wizard (which only printed SQL for an engineer): `roll_rate_card_forward(source, code, name, valid_from, multiplier)` → a **draft** with every rate, allowance and trainee figure × multiplier, each rounded to cents (`…Pct` keys, e.g. the Cert IV uplift, carry through); `publish_rate_card(card)` closes the open-ended predecessor at `valid_from − 1`; `discard_rate_card(card)`, drafts only. Gate: new action `payroll.manage`, zeta (Administrator) at ORG scope. Multiplier in (0, 2]. The agreement-specific formula (cl 25.1: 1 + (CPI + 0.5)/100) is the caller's, not the API's. Backdated publishing is allowed: costs are computed when read, so the agreement's rate is applied from the date the agreement says. | Built |
| R9 | Visibility: published cards and their lines to every member of the organization; drafts to `payroll.manage` only (`can_read_rate_card`). The rate admin screen reads the active organization's published cards. | Built |
| R10 | **Multipliers on the card** (§12): the loadings that are numbers — weekend / public-holiday penalties, night loadings, annual leave loading, overtime tiers, casual loading, minimum engagement, higher-duties minimum, meal trigger — live in `public.pay_rate_card_loadings` (1:1 per card) and are read by both SQL and client engines (`standard.ts`, `security.ts`, `min-engagement-floor.ts`). The rule *structure* (cl 41.4 non-cumulative maximum, the conclusion-day night rule, midnight split, 22:00–06:00 night window) stays code; a differently-shaped agreement is a new `rule_set`. | Built |
| R11 | **Holidays automated, no manual confirm step** (§13): generated from rules as today, then a monthly scheduled job checks official government lists (`data.gov.au`, `nsw.gov.au`, `qld.gov.au`), marks matching/added rows `gazetted`, keeps unconfirmed `table_only` rows for human review, and notifies active Administrators of affected organizations once per new discrepancy. Corrections reprice live (costs are computed when read). | Built |
| R12 | Deferred: rate admin UI for drafts (review, publish, discard); a published card's lines are not locked by a trigger (only the service role can write them, and the API never touches a published card's lines); wiring the worker projection pipeline to pass live DB cards instead of `ICC_SYDNEY_EA_LOADINGS` / `RATE_SCHEDULE` (phase 2). | Deferred |

## 12. Rate card loadings (built 2026-11-28)

| ID | Statement | Tag |
|---|---|---|
| L1 | `public.pay_rate_card_loadings` (1:1 with `pay_rate_cards`, PK/FK `rate_card_id` `ON DELETE RESTRICT`, RLS via `can_read_rate_card`, `updated_at` trigger) stores the 20 numeric multipliers/thresholds for `rule_set = 'icc_sydney_ea'`: casual, Saturday/Sunday/PH penalties, night (Mon–Thu / Fri / Sat–Sun), annual leave loading, OT tiers & PH floor, daily & security ordinary caps, minimum engagements (default / Sunday / PH / training), higher-duties minimum, and meal-allowance trigger. Keeping them in a 1:1 table keeps `pay_rate_cards` narrow and rule-set-agnostic. | Built |
| L2 | Casual night rates (45/50/75%) are NOT stored separately: under cl 43.2 they equal permanent night (20/25/50%) + casual loading (25%), and both engines already carry the casual loading in the base multiplier. Storing only the loading over base eliminates a 3NF contradiction risk. | Built |
| L3 | `fn_eba_penalty_loading`, `fn_eba_night_multiplier`, `fn_eba_min_engagement_minutes`, `fn_eba_estimate_shift_cost`, and `internal.shift_cost` all read `pay_rate_card_loadings`. A card with no loadings row prices as `NULL` (unpriced, matching R4/P4) and `publish_rate_card` refuses to publish it. Old hardcoded helper signatures are dropped. | Built |
| L4 | Card API: `roll_rate_card_forward` copies loadings unchanged (the multiplier scales money, not percentages/hours/minutes); `discard_rate_card` deletes them; new RPC `update_rate_card_loadings(card, jsonb)` patches a DRAFT card's loadings (gated by `payroll.manage` in the card's org; rejects published cards, non-objects, unknown/read-only keys, and out-of-range values via CHECK constraints). | Built |
| L5 | Client engines (`standard.ts`, `security.ts`, `min-engagement-floor.ts`) accept `loadings?: RateCardLoadings` via `CostCalculatorOptions` or `AwardContext`, falling back to `ICC_SYDNEY_EA_LOADINGS`. `getEbaRateSchedule` reads `pay_rate_card_loadings` alongside `eba_rate` / `eba_allowance`. `rate-card-loadings.test.ts` guards `ICC_SYDNEY_EA_LOADINGS` against `supabase/seeds/reference.sql` and verifies exact SQL ⇄ TS parity on custom non-ICC loadings. | Built |

## 13. Automated public holiday verification (built 2026-11-28)

| ID | Statement | Tag |
|---|---|---|
| C1 | `public.public_holidays` gains `source` (`'rule' \| 'gazetted'`, default `'rule'`), `gazetted_at` (non-null iff `source = 'gazetted'`), `created_at NOT NULL`, and `updated_at` with trigger. No manual year-end confirm step. | Built |
| C2 | `public.public_holiday_checks` (PK `(jurisdiction, year)`, counts & bounds CHECKs) and `public.public_holiday_discrepancies` (PK `(jurisdiction, holiday_date, kind)`, `official_only` / `table_only` / `name_differs`, `first_seen_at` + `last_seen_at`) record each check. Both have RLS enabled (`SELECT` for `authenticated`, writes `service_role` only). | Built |
| C3 | `public.reconcile_public_holidays(jsonb)` (`service_role` only, `pg_try_advisory_xact_lock(hashtext('reconcile_public_holidays'))`) reconciles covered jurisdiction-years: inserts missing official dates as `'gazetted'` (live repricing), marks matches `'gazetted'`, keeps unconfirmed `table_only` rows for human review (demoted to `'rule'`), and notifies active `zeta` Administrators of every active organization whose `jurisdiction_lineage` includes newly seen `official_only` / `table_only` findings. Re-runs are idempotent and send zero duplicate notifications. | Built |
| C4 | `scripts/holidays/official-holidays.mjs` fetches `data.gov.au` (2021–2025 CSV, marked inactive after 2025), `nsw.gov.au`, and `qld.gov.au`, excludes NSW Bank Holiday & QLD part-day Christmas Eve, routes Brisbane Ekka to `AU-QLD-BNE`, normalizes CSV apostrophe mojibake, and parses HTML strictly (failing loudly if a page changes structure). `.github/workflows/public-holidays-check.yml` runs it monthly against `SUPABASE_DB_URL`. | Built |
| C5 | Initial comparison of official lists (2024–2029: NSW 2024–2027, QLD & Brisbane 2024–2029) against live `public_holidays` matched 125/125 dates (`0` official-only, `0` table-only; only wording differences such as "additional day" vs "substitute day"). | Verified 2026-11-28 |

## 14. Wave 2 org-tree unification (built 2026-11-28)

| ID | Statement | Tag |
|---|---|---|
| O1 | `hr.departments` and `hr.subdepartments` mirrors dropped without `CASCADE` (`20261128093400_org_tree_departments_unification`), closing their cross-tenant `SELECT USING (true)` read leak and eliminating mirror drift against `public.departments` / `public.sub_departments`. | Built |
| O2 | `public.departments` and `public.sub_departments` hardened: `anon` grants revoked; `is_active`, `sort_order`, `created_at`, `updated_at` set `NOT NULL`; blank-string, non-negative `sort_order`, and hex `color` CHECK constraints added; partial unique `(organization_id, code)` / `(department_id, code)` indexes added; redundant `idx_departments_organization_id` dropped. | Built |
| O3 | `hr.roles.roles_subdepartment_id_fkey` repointed to `public.sub_departments(id) ON DELETE CASCADE`, and `public.role_ml_class_map` write RLS policies repointed to join `public.sub_departments` / `public.departments`. | Built |
| O4 | Remaining application callers (`supabase/functions/get-roster-view/index.ts` v20, `src/modules/users/ui/hooks/useReferenceData.ts`, `src/modules/rosters/api/shifts.queries.ts`) switched to `public.departments` / `public.sub_departments`. | Built |
