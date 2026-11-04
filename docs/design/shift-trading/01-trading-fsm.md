# Shift Trading — FSM Specification

**Status:** decided by the product owner 2026-11-04. All phases are live: **T1** offer integrity, **T2** lifecycle, **T3** cascades, **T4** no edits or reassignment while published, **T5** hardening from the 105-scenario matrix (`02-scenario-matrix-results.csv`). §9 tracks each item.
**Numbering:** the gapless S1–S10 model (`20261104061628_fsm_ids_s1_s10`).

A trade is a one-for-one swap of two confirmed shifts between two employees, approved by a manager. Employee **A** posts a shift; peers (**B**, **C**, …) offer one of their own shifts in exchange; A picks one; a manager approves or rejects.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | Trading is allowed only while both shifts are pre-start (TTS > 0). |
| D2 | A shift offered into a trade stays **S4** but is **held**: it cannot be dropped, posted, or offered elsewhere. It never enters S6. |
| D3 | A request takes **at most one active offer per peer**; a shift sits in **at most one active offer**. Several peers may compete for one request. |
| D4 | When A accepts an offer, both shifts move to **S7** together; every other offer on the request is declined. |
| D5 | A manager rejection **ends** the trade (no reopen). A may post again. |
| D6 | A may retract from S6 or S7; B may withdraw from S6 or S7. Either returns everything to S4. |
| D7 | In S7, the trade expires when **either** shift starts — whichever is first. |
| D8 | No edits while published (S3–S7) — every field, notes and display order included — and no reassignment. A manager unpublishes first, which cancels any trade (§6). No "small edit" exception. Filling, emptying and trade approval still change the assignee. |
| D9 | **No giveaways.** Every offer names a shift. |
| D10 | Full-time shifts are confirmed directly (never S3); they trade like any other S4 shift. |

## 2. States involved

| State | Meaning in a trade | `trading_status` |
|---|---|---|
| **S4** Confirmed | Not trading — or **held** (offered into a request; §3) | `NoTrade` |
| **S6** Trade (peer review) | A's shift is posted, collecting offers | `TradeRequested` |
| **S7** Trade (manager review) | A accepted an offer; **both** shifts await the manager | `TradeAccepted` |

`TradeApproved` exists in the enum and is never written; approval returns both shifts to `NoTrade` (S4).

## 3. Records

**Trade request** — `shift_swaps` (one per posting)

| Status | Shift state of A | Meaning |
|---|---|---|
| `OPEN` | S6 | Collecting offers |
| `MANAGER_PENDING` | S7 | An offer was accepted; `target_id` / `target_shift_id` = B / B's shift |
| `APPROVED` | S4 (now B's) | Terminal — swap done |
| `REJECTED` | S4 | Terminal — manager said no |
| `CANCELLED` | S4 | Terminal — retracted, withdrawn, or ended by a manager action (§6) |
| `EXPIRED` | S4 → S8 | Terminal — a start time was reached |

`OFFER_SELECTED` is retired (never written; must not be set).

**Offer** — `swap_offers` (one per peer per request)

| Status | Holds B's shift? | Meaning |
|---|---|---|
| `SUBMITTED` | yes | Waiting for A |
| `SELECTED` | yes (shift is S7) | A accepted it; manager reviewing |
| `ACCEPTED` *(new)* | no | The manager approved the trade |
| `REJECTED` | no | A declined it, or another offer was accepted |
| `WITHDRAWN` | no | B took it back |
| `EXPIRED` | no | A start time was reached |
| `CANCELLED` *(new)* | no | Ended by the request ending, or a manager action on B's shift |

**Hold** = an offer in `SUBMITTED` or `SELECTED` naming the shift. It is derived, not a stored flag. An offer is in those two statuses **only while its request is live**: every way a request ends moves its offers to a terminal status, so no hold outlives its request.

## 4. Invariants

| # | Invariant | Enforced by |
|---|---|---|
| I1 | `offered_shift_id` is NOT NULL (D9). | column constraint |
| I2 | ≤ 1 active offer per (request, peer). | unique index on (`swap_request_id`, `offerer_id`) where status in (`SUBMITTED`, `SELECTED`) |
| I3 | ≤ 1 active offer per offered shift (the hold). | unique index on `offered_shift_id` where status in (`SUBMITTED`, `SELECTED`) |
| I4 | ≤ 1 `SELECTED` offer per request. | existing `unique_selected_offer_per_request` |
| I5 | ≤ 1 live request (`OPEN` / `MANAGER_PENDING`) per requester shift. | unique index on `requester_shift_id` where live |
| I6 | A shift is S6/S7 **iff** it is the requester shift of a live request, or the target shift of a `MANAGER_PENDING` request. | the operations in §5 (state + records change in one transaction) |
| I7 | A held or trading shift cannot be dropped, posted, offered, or edited. | guards in §5 and `fsm_op_is_legal` |
| I8 | The offerer never equals the requester, and B's shift never equals A's. | guard on submit |

## 5. Operations

All run as one transaction. Each locks the request row (`FOR UPDATE`); two-employee steps take advisory locks in `LEAST(empA, empB)` then `GREATEST(empA, empB)` order.

| Op | Actor | Legal when | Effect |
|---|---|---|---|
| `request_trade` | A | A's shift **S4**, not held, TTS > 0 | Request `OPEN`; A's shift **S4 → S6** |
| `submit_offer` | B | Request `OPEN`; B's shift **S4**, not held, not A's, TTS > 0; B has no active offer on this request | Offer `SUBMITTED`; B's shift **held** (stays S4) |
| `decline_offer` | A | Request `OPEN`; offer `SUBMITTED` | Offer `REJECTED`; hold released. A's shift **stays S6** |
| `withdraw_offer` | B | Offer `SUBMITTED` (request `OPEN`) | Offer `WITHDRAWN`; hold released. A **stays S6** |
| `withdraw_offer` | B | Offer `SELECTED` (request `MANAGER_PENDING`) | Offer `WITHDRAWN`; request `CANCELLED`; **both shifts S7 → S4** |
| `accept_offer` | A | Request `OPEN`; offer `SUBMITTED`; both shifts TTS > 0; compliance feasible for **both** employees (snapshot stored) | Request `MANAGER_PENDING`; offer `SELECTED`; other offers `REJECTED` (holds released); **A's and B's shifts → S7**; `expires_at = LEAST(start A, start B)` |
| `cancel_trade` | A | Request `OPEN` or `MANAGER_PENDING` | Request `CANCELLED`; live offers `CANCELLED`; every involved shift → **S4** |
| `approve_trade` | Manager | Request `MANAGER_PENDING` (shifts **S7**); compliance **re-run** and feasible | Assignees swapped; both shifts **S7 → S4**, `assignment_outcome = confirmed`; request `APPROVED`; offer `ACCEPTED` |
| `reject_trade` | Manager | Request `MANAGER_PENDING` | Request `REJECTED`; offer `REJECTED`; **both shifts S7 → S4**, original owners (D5) |

Notes:
- `reject_trade` is **manager-only and S7-only**. A declining one peer is `decline_offer`, which leaves the request open.
- The compliance re-run at approval is the deferred `trg_shift_eba_compliance`, which checks both employees' post-swap rosters at commit. A blocking breach rolls the approval back and the trade stays S7. The manager can then reject it.
- `accept_offer` reads B's shift from the offer row and never trusts a shift id from the client.
- AutoPilot auto-approve (`auto_decision_id`, `review_flag`) must call the same `approve_trade` / `reject_trade`. It gets no separate path.

## 6. System events

| Event | When | Effect |
|---|---|---|
| Offer lapses | B's shift reaches its start while the offer is `SUBMITTED` | Offer `EXPIRED`; hold released; request stays `OPEN` (A unaffected) |
| Posting lapses | A's shift reaches its start while `OPEN` | Request `EXPIRED`; live offers `EXPIRED`; A's shift **S6 → S4** (then the start timer moves it to S8) |
| Review lapses | `LEAST(start A, start B)` reached while `MANAGER_PENDING` | Request `EXPIRED`; offer `EXPIRED`; **both shifts → S4**, original owners (D7) |
| Manager unpublishes / cancels / deletes **A's** shift | any live request | Request `CANCELLED`; live offers `CANCELLED`; partner shift (if S7) → S4; A's shift follows the manager's action |
| Manager unpublishes / cancels / deletes **B's** shift | while offered (`SUBMITTED`) | That offer `CANCELLED`; request stays `OPEN` |
| | while `SELECTED` | Request `CANCELLED`; A's shift **S7 → S4**; B's shift follows the manager's action |
| Approved leave covering the date of a shift someone gives in a trade | A's shift (S6/S7), or B's shift in review (S7) | Request `CANCELLED`; everything → S4 *(decided 2026-11-04)* |
| | B's shift while offered (`SUBMITTED`) | Only that offer `CANCELLED`; A's request stays `OPEN` |

Known deviation: `process_shift_timers` auto-starts shifts before it expires trades. The end state is correct (trade `EXPIRED`, shift `NoTrade`, then In Progress), but the `trade_expired` audit event records S8→S8 instead of S6→S4.

## 7. Refusals

| Attempt | State | Code |
|---|---|---|
| Drop | S6, S7, or held S4 | `TRADE_IN_PROGRESS` — retract / withdraw first |
| Post (`request_trade`) | held S4, or S6/S7 | `TRADE_IN_PROGRESS` |
| Offer a shift | already held, S6/S7, or own request | `SHIFT_ALREADY_OFFERED` / `INVALID_OFFER` |
| Second offer by the same peer | request has their active offer | `OFFER_EXISTS` |
| Edit | S3–S7 (D8) | `UNPUBLISH_TO_EDIT` |
| Post, offer, accept, approve | a shift has started (TTS ≤ 0) | `TIME_LOCKED` |
| Withdraw, retract | a shift has started | allowed until the next sweep (≤ 1 min); it only returns shifts to S4 |
| Any direct write to `shift_swaps` / `swap_offers` from the app | — | refused; only the definer functions write them |

## 8. End-to-end flows

```
Happy path        A: S4 ─post→ S6 ─accept B→ S7 ─approve→ S4 (now B's)
                  B: S4 ─offer→ S4·held ─────→ S7 ─approve→ S4 (now A's)

Manager rejects   both S7 ─reject→ S4, original owners; request REJECTED
A retracts        S6 or S7 → S4 (all); request CANCELLED
B withdraws       in S6: A stays S6 · in S7: both → S4, request CANCELLED
Earliest start    in S7: first start → both S4, request EXPIRED
```

## 9. Delta from live (implementation scope)

| # | Live today | Change | Done |
|---|---|---|---|
| L1 | No uniqueness on offers per peer or per shift | Add I2, I3, I5 indexes (tables are empty on live, so no cleanup) | T1 |
| L2 | `offered_shift_id` nullable (giveaways) | NOT NULL; remove giveaway code paths in `swaps.api` / UI | T1 |
| L3 | Offers inserted/updated directly from the client | `submit_offer`, `decline_offer`, `withdraw_offer` as guarded RPCs | T1 |
| L4 | B's shift not held: can be dropped or re-offered | Hold guards in drop / post / offer (I7) | T1 |
| L5 | B cannot withdraw once `SELECTED` | `withdraw_offer` from S7 | T2 |
| L6 | Review expiry uses A's start only (`fn_set_swap_expires_at`) | `expires_at = LEAST(start A, start B)` at `accept_offer`; offer lapse on B's start | T2 |
| L7 | `fsm_op_is_legal`: `reject_trade` in S6+S7; `edit` in S1–S7 | `reject_trade` → S7 only; `edit` → S1, S2 only (D8, affects all published shifts) | T2 (reject); T4 (edit) |
| L8 | No offer `CANCELLED` status | Add the enum value | T2 |
| L9 | `sm_unpublish_shift` also updates the empty legacy `swap_requests` table | Remove the dead branch | T3 |
| L10 | Approval does not re-run compliance | Re-run at `approve_trade` | T2 (already the deferred EBA trigger) |
| L11 | Leave approval does not touch trades | Cancel | T3 |

## 10. Acceptance tests

Each row of §5–§7 becomes one DB test (`supabase/tests/`), plus the parity test for the app's state rules. Each test must fail on the code before its change. Required cases:

1. Happy path; both assignees swapped; both S4 confirmed.
2. Two peers offer; A accepts one, and the other is `REJECTED` with its hold released.
3. The same peer's second offer is refused (`OFFER_EXISTS`).
4. A held shift is refused for a second offer, a post, and a drop.
5. B withdraws in S6 (A stays S6) and in S7 (both S4).
6. A retracts from S6 and from S7.
7. Manager rejects, the request is not reopened, and A can post again.
8. S7 expiry when B's shift starts first, and when A's starts first.
9. B's offered shift starts while `SUBMITTED`: offer `EXPIRED`, request still `OPEN`.
10. Unpublish of A's shift and of B's shift (both `SUBMITTED` and `SELECTED` cases).
11. Edit refused in S3–S7.
12. Approval refused when the compliance re-run fails, and the trade stays S7.
