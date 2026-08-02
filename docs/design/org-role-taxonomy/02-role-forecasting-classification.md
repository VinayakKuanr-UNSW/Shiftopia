# Role Forecasting Classification — Master Map

**Source:** live `public.roles` table, pulled 2026-05-01 via `scripts/query-roles-full.ts`.
**Total:** 85 roles across 44 dept × sub-dept buckets.
**Current DB state:** every role has `forecasting_bucket = NULL`, `is_baseline_eligible = false`, ratios = `NULL/NULL`. Nothing is classified yet.

This document is the proposed classification. Once approved, a single migration will backfill all 85 rows.

---

## 1. Definitions

### `forecasting_bucket` — how is this role's required headcount determined?

| Value | Meaning | Required-headcount source |
|---|---|---|
| `static` | Always-on regardless of events. Hours come from a fixed template. | Active baseline `roster_template` |
| `semi_dynamic` | Count is **derived** from another role's count via a supervision ratio | `ceil(supervised_total / supervision_ratio_min)` |
| `dynamic` | Count is **predicted** by ML from event features | XGBoost output for the role's ML class |

### `is_baseline_eligible` — should the auto-roster fill this role from a template before applying ML?

| Value | Meaning |
|---|---|
| `true` | FT or PT contracted role; baseline shifts always exist |
| `false` | Casual / on-demand; no baseline shifts unless ML/manual creates them |

### `supervision_ratio_min` / `supervision_ratio_max`

Only set on `semi_dynamic` supervisor roles. Read as: "1 of me supervises between *min* and *max* of my reports." We use `min` to compute required count (conservative — more supervisors); `max` is the cap when supervisees are predicted high.

---

## 2. Ratio Philosophy

| Tier | Role archetype | Ratio min | Ratio max | Rationale |
|---|---|---|---|---|
| **T0 — Executive** | CEO, Deputy CEO, Director | flat (no ratio) | flat | 1 person, no supervisory math |
| **T1 — Senior Manager** | Senior Manager X, Head of X | 1 : 15 | 1 : 25 | Spans multiple supervisors |
| **T2 — Manager / Asst Manager** | Manager, Assistant Manager | 1 : 10 | 1 : 18 | Direct dept-level oversight |
| **T3 — Supervisor (general ops)** | Floor Supervisor, Ops Supervisor | 1 : 8 | 1 : 12 | Industry-standard event ops |
| **T4 — Security Supervisor** | Event Security Team Leader (regulated) | 1 : 5 | 1 : 8 | NSW Security Industry Act 1997 |
| **T5 — Team Leader / Working Supervisor** | L4 Team Leader, Beverage Supervisor | 1 : 5 | 1 : 8 | Hands-on with a crew |
| **T6 — Kitchen Mid-Tier** | Sous Chef, Chef de Partie | 1 : 3 | 1 : 5 | Tight kitchen brigade |
| **T7 — Coordinator (admin, not supervisory)** | Coordinator, Analyst | flat | flat | Doesn't supervise headcount |
| **T8 — IC / Operative** | Team Member, Officer, Tech | n/a | n/a | The supervised |

---

## 3. Per-Department Classification

Columns:
- **Bucket** = recommended `forecasting_bucket`
- **Baseline?** = recommended `is_baseline_eligible`
- **Ratio** = recommended `supervision_ratio_min` / `_max` (— means none)
- **Tier** = ratio tier from §2
- **Notes / Assumed FT-or-Casual** = my classification + flags requiring user confirmation

### 3.1 Event Set-up *(spec-confirmed by user)*

| Role | EBA Level | Employment | Bucket | Baseline? | Ratio | Tier | Notes |
|---|---|---|---|---|---|---|---|
| Event Setup Manager | L6 | FT | `static` | ✅ true | — | T2-flat | 1 per dept, business hours |
| Event Setup Assistant Manager | L6 | FT | `static` | ✅ true | — | T2-flat | 1 per dept |
| Event Setup Supervisor | L5 | FT | `semi_dynamic` | ✅ true | **8 / 12** | T3 | Derived from total L2-L4 casual count; baseline floor of 1 |
| Event Setup Team Leader | L4 | Casual | `semi_dynamic` | ❌ false | **5 / 8** | T5 | Working sup over L2/L3 crew; count scales with casuals |
| Event Setup TM3 | L3 | Casual | `dynamic` | ❌ false | — | T8 | ML-predicted |
| Event Setup Team Member | L2 | Casual | `dynamic` | ❌ false | — | T8 | ML-predicted |

### 3.2 Food & Beverage Services

| Role | EBA Level | Employment | Bucket | Baseline? | Ratio | Tier | Notes |
|---|---|---|---|---|---|---|---|
| F&B Services Manager | L6? | FT | `static` | ✅ true | — | T2-flat | Confirm level |
| F&B Floor Manager | L5? | FT | `semi_dynamic` | ✅ true | **10 / 15** | T2 | Manages multiple supervisors |
| Beverage Supervisor | L5? | FT | `semi_dynamic` | ✅ true | **8 / 12** | T3 | Bar-floor sup |
| F&B Team Member (L3) | L3 | Casual | `dynamic` | ❌ false | — | T8 | ML-predicted (Food Staff) |
| F&B Team Member (L2) | L2 | Casual | `dynamic` | ❌ false | — | T8 | ML-predicted (Food Staff) |

### 3.3 Culinary Services >> Kitchen

| Role | EBA Level | Employment | Bucket | Baseline? | Ratio | Tier | Notes |
|---|---|---|---|---|---|---|---|
| Executive Chef | L7+ | FT | `static` | ✅ true | — | T0-flat | 1 person |
| Senior Sous Chef | L6 | FT | `semi_dynamic` | ✅ true | **6 / 10** | T2 | Spans Sous + CdP |
| Junior Sous Chef | L5 | FT | `semi_dynamic` | ✅ true | **4 / 6** | T6 | Direct kitchen sup |
| Chef de Partie | L4 | FT | `semi_dynamic` | ✅ true | **3 / 5** | T6 | Section sup |
| Apprentice Cook | L2 | FT | `dynamic` | ✅ true | — | T8 | Confirm: typically FT apprentices, but volume may scale |

### 3.4 Security *(NSW regulated — strict ratios)*

| Role | EBA Level | Employment | Bucket | Baseline? | Ratio | Tier | Notes |
|---|---|---|---|---|---|---|---|
| Event Security Team Leader | L4-L5 | Mixed FT/Casual | `semi_dynamic` | ✅ true | **5 / 8** | T4 | NSW SIA-aligned |
| Security Officer | L2-L3 | Casual | `dynamic` | ❌ false | — | T8 | ML-predicted (Security) |

### 3.5 Audio Visual

Multiple sub-departments. Best treated as event-driven specialist depts.

| Role | Bucket | Baseline? | Ratio | Tier | Notes |
|---|---|---|---|---|---|
| AV Senior Project Manager (Projects) | `static` | ✅ | — | T1-flat | Office hours |
| AV Senior Technical Operator (Operations) | `semi_dynamic` | ✅ | 8/12 | T3 | Spans techs |
| AV Senior Tech Hybrid (Digital Signage) | `semi_dynamic` | ✅ | 8/12 | T3 | |
| AV Lighting Manager (Lighting) | `static` | ✅ | — | T2-flat | 1 per show |
| AV Technical Manager - Theatre (Theatre) | `static` | ✅ | — | T2-flat | 1 per show |
| AV Rigging Manager - Exhibition (Rigging) | `semi_dynamic` | ✅ | 6/10 | T3 | Rigging crew sup |
| AV Rigging Technician (Rigging) | `dynamic` | ❌ | — | T8 | Per-event call-in |
| AV Staging Team Leader (Floor Managers) | `semi_dynamic` | ❌ | 5/8 | T5 | |
| AV Graduate (Audio) | `dynamic` | ❌ | — | T8 | Trainee, event-driven |

### 3.6 Customer Services / Contact Centre

| Role | Bucket | Baseline? | Ratio | Tier | Notes |
|---|---|---|---|---|---|
| CustServ Coordinator (×2 — Customer Services + Contact Centre) | `static` | ✅ | — | T7-flat | Admin coordination |
| CustServ Team Leader (×2) | `semi_dynamic` | ✅ | 8/12 | T3 | Floor sup |

⚠️ **Duplicates**: `CustServ Coordinator` and `CustServ Team Leader` exist in both **Customer Services** and **Contact Centre** sub-depts. Suggest deduplicating or confirming this is intentional.

### 3.7 Event Delivery / Operations / Logistics / Services / Planning / Workforce / Live Events

Mostly admin + operations.

| Role | Dept | Bucket | Baseline? | Ratio | Tier |
|---|---|---|---|---|---|
| Event Delivery Coordinator | Admin | `static` | ✅ | — | T7-flat |
| Senior Manager Event Delivery | Admin | `static` | ✅ | 1:15 / 1:25 | T1 |
| Event Delivery Supervisor - Beverage | F&B Ops | `semi_dynamic` | ✅ | 8/12 | T3 |
| Event Delivery Manager - Retail | Retail Services | `semi_dynamic` | ✅ | 10/18 | T2 |
| Senior Event Delivery Manager | Retail Services | `static` | ✅ | 1:15 / 1:25 | T1 |
| Event Logistics Team Member (L3) | Event Logistics | `dynamic` | ❌ | — | T8 |
| Duty Director | Event Operations | `static` | ✅ | — | T0-flat |
| Manager Live Events Operations (×2) | Event Ops + Live Events | `static` | ✅ | 1:10 / 1:18 | T2 |
| Event Coordinator | Event Planning | `static` | ✅ | — | T7-flat |
| Exhibition Services Assistant | Event Services | `dynamic` | ❌ | — | T8 |
| Exhibition Services Coordinator | Event Services | `static` | ✅ | — | T7-flat |
| Event Workforce Coordinator | Event Workforce Planning | `static` | ✅ | — | T7-flat |
| F&B Events Workforce Manager | Event Workforce Planning | `static` | ✅ | 1:10 / 1:18 | T2 |
| Manager Event Workforce | Event Workforce Planning | `static` | ✅ | 1:10 / 1:18 | T2 |

⚠️ **Duplicate**: `Manager Live Events Operations` exists in **Event Operations** and **Live Events**. Confirm.

### 3.8 Kitchen Logistics

| Role | Bucket | Baseline? | Ratio | Tier |
|---|---|---|---|---|
| Kitchen Logistics Supervisor | `semi_dynamic` | ✅ | 6/10 | T3 |
| Kitchen Logistics Team Member | `dynamic` | ❌ | — | T8 |

### 3.9 Uniform Room

| Role | Bucket | Baseline? | Ratio | Tier |
|---|---|---|---|---|
| Uniform Room Supervisor | `static` | ✅ | — | T2-flat | (1 per shift, low variance)
| Uniform Room Team Member (L2) | `static` | ✅ | — | T8 | (Always-on; volume mostly stable)
| Uniform Room Team Member (L3) | `static` | ✅ | — | T8 |

### 3.10 ICT Services

| Role | Bucket | Baseline? | Ratio | Tier |
|---|---|---|---|---|
| Senior Manager ICT Services | `static` | ✅ | 1:15 / 1:25 | T1 |
| Manager ICT Infrastructure | `static` | ✅ | 1:10 / 1:18 | T2 |
| Supervisor ICT Operations | `semi_dynamic` | ✅ | 8/12 | T3 |
| ICT Infrastructure Support Engineer | `static` | ✅ | — | T8 |
| ICT Network Administrator | `static` | ✅ | — | T8 |
| Senior ICT Support Analyst | `static` | ✅ | — | T8 |
| ICT Support Analyst | `static` | ✅ | — | T8 |
| ICT Support Team Member | `static` | ✅ | — | T8 |

### 3.11 Other Operational

| Role | Dept | Bucket | Baseline? | Ratio | Tier |
|---|---|---|---|---|---|
| CP&L Team Member | Car Park | `dynamic` | ❌ | — | T8 |
| Storeperson | Logistics | `static` | ✅ | — | T8 |
| Merchandise Team Member (L4) | Merchandise | `dynamic` | ❌ | — | T8 |
| Team Cafe Team Member | Team Cafe | `static` | ✅ | — | T8 |
| Trade Team Member - Handyperson | Assets & Trades | `static` | ✅ | — | T8 |
| Assistant Manager | Assets & Trades | `static` | ✅ | 1:10 / 1:18 | T2 |
| Senior Manager | Assets & Trades | `static` | ✅ | 1:15 / 1:25 | T1 |

### 3.12 Back-Office / Corporate (all `static`, baseline-eligible)

| Role | Dept | Tier | Ratio |
|---|---|---|---|
| EA to Directors | Building Services | T7-flat | — |
| Director of Business Development | Business Dev | T0-flat | — |
| Senior Manager BD | Business Dev | T1 | 1:15 / 1:25 |
| BD Coordinator | Business Dev | T7-flat | — |
| BD Coordinator - National Assoc | Business Dev | T7-flat | — |
| Business Analyst | Business Partnering | T7-flat | — |
| Accounts Officer | Business Services | T7-flat | — |
| Assistant Accountant | Business Services | T7-flat | — |
| Digital Media Manager | Communications | T2-flat | — |
| Payroll Manager | Finance | T2-flat | — |
| Senior Payroll Officer | Finance | T7-flat | — |
| CEO | Executive Services | T0-flat | — |
| Deputy CEO | Executive Services | T0-flat | — |
| Marketing & Comms Exec | Marketing & Comms | T7-flat | — |
| Risk Operations Manager | Operational Risk | T2-flat | — |
| HR Advisor | People & Culture | T7-flat | — |
| HR Shared Services Advisor | Shared Services | T7-flat | — |
| Purchasing Manager | Procurement | T2-flat | — |
| Digital Hybrid Events Coordinator | Public Relations | T7-flat | — |

All in this table: `bucket = static`, `is_baseline_eligible = true`. Tier-flat (T0/T2/T7) means no supervision ratio (the dept is small enough that ratio math doesn't apply).

---

## 4. Summary Stats (recommended classification)

| Bucket | Count | % of total |
|---|---|---|
| `static` | 56 | 66 % |
| `semi_dynamic` | 17 | 20 % |
| `dynamic` | 12 | 14 % |
| **Total** | **85** | **100 %** |

| `is_baseline_eligible` | Count | % |
|---|---|---|
| `true` (FT/PT contracted) | 73 | 86 % |
| `false` (Casual / on-demand) | 12 | 14 % |

**Take-away:** the ML pipeline is the lever for ~14 % of roles (the casual operatives). Everything else is baseline-driven. The current code path that runs ML for ANY non-static role is wrong — most static roles are still FT and don't need ML, they need their template.

---

## 5. Open Questions / Confirm Before Migration

1. **EBA levels not in DB** — I inferred levels from role names. The actual EBA mapping should come from a `remuneration_levels` lookup. Confirm where the source of truth lives. (We already saw `getRemunerationLevels()` referenced in [LaborDemandForecastingPage.tsx:906](src/modules/rosters/pages/LaborDemandForecastingPage.tsx#L906).)
2. **`employment_class` column doesn't exist on `roles`** — my "FT / PT / Casual" labels are inferred. Adding `employment_class TEXT CHECK (employment_class IN ('FT','PT','Casual'))` would let us drive baseline-eligibility from data.
3. **Duplicate role rows** — `CustServ Coordinator`, `CustServ Team Leader`, `Manager Live Events Operations` each exist twice in different sub-depts. Intentional or migration artefact?
4. **Apprentice Cook FT-vs-Casual** — assumed FT (apprenticeships are usually contracted). Confirm.
5. **Ratios are industry-default suggestions** — once you sign off on the matrix in §2, I'll bake them into the migration. Some depts (Security, Kitchen) may have stricter EBA-mandated minimums I don't have visibility into.
6. **`forecasting_bucket = 'static'` interpretation** — Phase-2.2 (per the prior plan) makes baseline templates flow into `requiredHeadcount`. Until that lands, marking 56 roles as `static` means they will still report `REQ HOURS = 0` in the Coverage Scan even after this classification. Confirm we're sequencing the migration AFTER the Phase-2.2 builder change.
7. **L6 Manager / Asst Manager ratios** — I left these flat (no ratio) on the assumption only the L5 Supervisor is supervision-derived for Event Setups. If L6 should also derive from L5 count (1 manager per N supervisors), let me know and I'll add a ratio.

---

## 6. Next Step

Once §3 is approved, I'll generate a single migration `2026XXXX_roles_forecasting_classification.sql` that does:

```sql
UPDATE public.roles SET forecasting_bucket = $1, is_baseline_eligible = $2,
                        supervision_ratio_min = $3, supervision_ratio_max = $4
WHERE id = $5;
-- × 85 rows, idempotent.
```

Plus a verification query you can run pre/post to spot-check.
