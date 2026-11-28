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
| T2 | `public.organizations / departments / sub_departments` is the canonical org tree. `hr.organizations` is a duplicate being retired; `hr.departments / hr.subdepartments` still mirror the public rows under the same ids until the Wave 2 review retires them. | Decided 2026-11-25 | `20261125192153_organizations_hardening`, `supabase/pending/…drop_hr_organizations.sql` |
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
| H5 | The client holiday table (`core/lib/holidays.ts`, 29 importers: pay, compliance, leave, calendars, the AutoScheduler) answers for NSW only. Until it is per-jurisdiction, `holidays-db-parity.test.ts` compares NSW day by day and pins the set of jurisdictions to `AU-NSW, AU-QLD`. | Verified 2026-11-26 — interim |
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

- Apply the `hr.organizations` drop (`supabase/pending/`) now that the PR #65 frontend is deployed.
- Retire the `hr.departments / hr.subdepartments` mirrors (Wave 2 review).
