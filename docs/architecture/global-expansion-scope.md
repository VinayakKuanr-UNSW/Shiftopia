# Global Expansion — Scope

**Status:** Scoping, 2026-11-28. Nothing here is built yet.
**Question:** what does it take to run venues in North America and Europe (and
Brisbane) — different timezones, countries, labour law, currencies and
languages — on a platform built for one venue in Sydney?
**Read with:** [multi-organization.md](multi-organization.md) (the decisions log;
the open decisions below are mirrored there as G-entries).

---

## 1. The candidate venues

Each venue would be an organization with its own timezone and holiday jurisdiction.
Jurisdiction codes follow ISO 3166-2 (country, then subdivision), with the country as
the parent so national holidays are held once.

| Venue | City | Timezone (IANA) | DST | Jurisdiction |
|---|---|---|---|---|
| ICC Sydney (live) | Sydney | Australia/Sydney | yes | AU-NSW |
| BCEC (created) | Brisbane | **Australia/Brisbane** | **no** | AU-QLD (+ Brisbane for Ekka) |
| SoFi Stadium · LA Convention Center | Los Angeles | America/Los_Angeles | yes | US-CA |
| Moscone Center | San Francisco | America/Los_Angeles | yes | US-CA |
| Allegiant Stadium | Las Vegas | America/Los_Angeles | yes | US-NV |
| State Farm Stadium | Glendale | **America/Phoenix** | **no** | US-AZ |
| Colorado Convention Center | Denver | America/Denver | yes | US-CO |
| AT&T Stadium · NRG Stadium | Arlington · Houston | America/Chicago | yes | US-TX |
| Caesars Superdome | New Orleans | America/Chicago | yes | US-LA |
| U.S. Bank Stadium · Target Center | Minneapolis | America/Chicago | yes | US-MN |
| Soldier Field | Chicago | America/Chicago | yes | US-IL |
| Fiserv Forum | Milwaukee | America/Chicago | yes | US-WI |
| T-Mobile Center | Kansas City | America/Chicago | yes | US-MO |
| Yankee Stadium · Barclays Center | New York | America/New_York | yes | US-NY |
| Highmark Stadium | Orchard Park | America/New_York | yes | US-NY |
| Huntington Bank Field | Cleveland | America/New_York | yes | US-OH |
| Pennsylvania Convention Center | Philadelphia | America/New_York | yes | US-PA |
| Hawai'i Convention Center | Honolulu | **Pacific/Honolulu** | **no** | US-HI |
| OVO Arena Wembley · Emirates Stadium · Stamford Bridge | London | Europe/London | yes | GB-ENG |
| AO Arena · First Direct Arena · Utilita Arenas · CBS Arena | Manchester · Leeds · Sheffield · Newcastle · Coventry | Europe/London | yes | GB-ENG |
| P&J Live | Aberdeen | Europe/London | yes | **GB-SCT** (Scottish holidays differ) |
| Avicii Arena · Strawberry Arena | Stockholm | Europe/Stockholm | yes | SE |
| Rudolf Weber-Arena | Oberhausen | Europe/Berlin | yes | DE-NW |
| Santiago Bernabéu | Madrid | Europe/Madrid | yes | ES-MD |
| Estádio do Dragão | Porto | Europe/Lisbon | yes | PT-13 |

That is **13 timezones** (four with no daylight saving), **7 countries**, about **20
subdivisions**, and **five currencies** (AUD, USD, GBP, SEK, EUR). Some venues listed
are hospitality or commercial partnerships, which may not need rostering at all
(decision G1).

## 2. What assumes Sydney today (measured 2026-11-28, on `main`)

| Area | Evidence | What breaks elsewhere |
|---|---|---|
| Database functions | 38 hardcode `'Australia/Sydney'`; 20 already read `shifts.timezone` | Expiry, urgency, clock-in windows, "today", lifecycle sweeps computed in Sydney time |
| Shift time model | `shift_date` + naive `start_time`/`end_time` are authored; `start_at`/`end_at` are derived; `shifts.timezone` defaults to `'Australia/Sydney'` | Every BCEC shift would be stored as Sydney time — **an hour wrong from October to April** (Brisbane has no DST). Night shifts across a DST change are an hour longer or shorter than their wall-clock length |
| Other naive times | `template_shifts`, `availability_rules`/`_slots`, `billables` start/end/break | Need the venue's timezone to mean anything |
| Organizations | No `timezone`, `country`, `currency`, `locale` columns | Nothing can derive them |
| Scheduled jobs | 6 `pg_cron` jobs at fixed UTC times chosen for Sydney nights (e.g. `casual_fairness_nightly` 16:00 UTC) | "Nightly" runs mid-afternoon in Europe and mid-morning in the US |
| Client | 45 files use Sydney-time helpers (`getSydneyNow`…), 20 name `Australia/Sydney`, 14 format with `en-AU`, 18 call `toLocale*String` | Wrong times and formats for anyone outside Sydney |
| Calendar | Monday week start is baked in with no option (`core/lib/date/week.ts`) | US payroll weeks usually start Sunday |
| Holidays | Per-jurisdiction tables in progress (fix 2); client table NSW-only (H5) | — |
| Money | AUD in 2 client files and the optimizer; rate cards planned with a currency (P-entries) | — |
| Pay and compliance rules | The ICC Sydney EA, as code (TypeScript + SQL port); 10 SQL functions cite EA clauses in their messages | Not valid anywhere else |
| Employment model | `employment_status` = Full-Time / Part-Time / Casual / Flexible Part-Time; leave types annual / personal / family-and-domestic-violence, seeded with Australian hours | US hourly/exempt and union rules, UK zero-hours, EU contract types and statutory leave differ |
| Hosting | Supabase project in `ap-southeast-1` (Singapore) | EU/UK staff data leaves the EU/UK; some employers require in-region hosting |

## 3. Workstreams

### 3.1 Time (foundation — blocks everything)

- `organizations.timezone` (IANA, required) plus `country`, `currency`, `locale`.
  BCEC becomes `Australia/Brisbane`.
- Every shift, template, availability and timesheet time is the **venue's wall clock**;
  the venue's timezone is the only zone used to turn it into an instant. Durations are
  computed from instants, so a night shift across a DST change is paid for the hours
  actually worked.
- Replace the 38 hardcoded zones and the client's Sydney helpers with "the shift's (or
  organization's) timezone"; show times in the venue's zone, labelled when it differs
  from the viewer's.
- Scheduled jobs run hourly and act on the organizations whose local time has reached
  the job's hour, instead of one fixed UTC time.
- Week start per organization.

### 3.2 Jurisdictions and holidays

- Extend fix 2 **before it is applied**: ISO 3166-2 codes (allowing digits, e.g.
  `PT-13`) and country-level parents (`AU`, `US`, `GB`, `SE`, `DE`, `ES`, `PT`) so a
  subdivision inherits national days.
- Holiday rows per jurisdiction from `date-holidays` (it covers all seven countries);
  local days (Ekka, regional days) as rules.
- In the US no federal law requires holiday pay; whether a day attracts a premium is
  the agreement's. So the **calendar** says which days are holidays, and the **rate
  card / agreement** says which of them pay a premium (today the EA hardwires "every
  public holiday pays").

### 3.3 Labour rules (the largest piece)

The rules differ by country, often by state or city, and in stadiums and arenas very
often by **collective agreement**. Examples to confirm with employment counsel per
venue — not a list to implement from:

- **US:** federal overtime over 40 hours a week; some states add daily overtime and
  meal/rest-break rules (California); some cities have predictive-scheduling laws with
  advance-notice and change-pay rules (e.g. New York City, Chicago, Philadelphia, Los
  Angeles); union agreements for event staff.
- **UK:** working-time limits and rest periods, statutory holiday entitlement and how
  it accrues for irregular hours, age-banded minimum wage.
- **Germany, Sweden, Spain, Portugal:** national working-time law plus sector
  collective agreements; Spain requires daily working-time records.

Consequence for the decisions log: **P2** ("rules stay in code; a card names its rule
set") was decided for a second Australian venue. With dozens of agreements, one code
path per agreement does not scale. The likely shape is a **rule-set catalogue**:
parameterised rule kinds (overtime thresholds per day/week, penalty windows by day
type and time, minimum engagement, breaks, rest gaps, notice periods) whose values
live on the agreement, with genuinely new kinds added as code. Decision G5.

Employment types and leave types become per jurisdiction (or per agreement) instead of
one Australian enum.

### 3.4 Money

Rate cards (already planned) carry their currency; every money figure formats with
the organization's currency and locale; no cross-currency totals without an explicit
conversion, or none at all (decision G6).

### 3.5 Language and formats

Dates, times (12-hour in the US), numbers and currency by locale. Translated UI
(Swedish, German, Spanish, Portuguese) is a separate, later decision (G4); staff-facing
screens matter most.

### 3.6 Tenancy shape

Today one organization = one venue. An operator running many venues needs people who
work across venues (contracts per organization already allow that) and probably
operator-level roles and reporting above venues (an "organization group"). Decision G2.

### 3.7 Hosting and privacy

EU and UK employee data in Singapore needs a lawful transfer basis; some employers
will require EU or US hosting. One global database versus regional deployments is an
architecture fork to decide before European data arrives. Decision G3.

## 4. Decisions needed before building

| ID | Decision |
|---|---|
| G1 | Which venue types are in scope: full rostering, or also hospitality/commercial partnerships? |
| G2 | Tenancy: venue = organization only, or an operator/group level above venues? |
| G3 | Hosting: one database, or regional deployments (APAC / US / EU)? |
| G4 | Languages: English only first, or translated staff screens from the start? |
| G5 | Labour rules: rule-set catalogue with values per agreement (revisits P2), or per-agreement code? |
| G6 | Cross-venue money: per-venue currency only, or converted totals for an operator? |
| G7 | First non-Australian venue to pilot (sets which rule set is built first). |

## 5. Suggested order

1. **Time foundation** (§3.1) and the extended **jurisdictions** (§3.2) — needed by
   every venue, including BCEC today.
2. **Rule-set catalogue** (§3.3) with the ICC EA as its first entry, proven by the
   existing parity tests; then the pilot venue's rule set (G7).
3. **Rate cards with currency** (§3.4, existing plan).
4. **Locale formatting**, then translation if G4 says so.
5. **Tenancy group / hosting** as G2 and G3 decide.
