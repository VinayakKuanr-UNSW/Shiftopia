# Shift Bidding — FSM Specification

**Status:** decided by the product owner 2026-11-04 (all recommendations in the bidding review accepted). Phases B1–B5 in §8.
**Numbering:** the gapless S1–S10 model (`20261104061628_fsm_ids_s1_s10`). Trading is specified in `01-trading-fsm.md`.

Bidding fills an **S5** shift: a published shift with nobody on it. Employees bid; a manager picks a winner (standard lane), or the first compliant bidder wins (urgent lane, TTS ≤ 24h). A shift reaches S5 when a manager publishes an unassigned draft, an employee rejects an offer, an offer is ignored for 48h, or an employee drops a confirmed shift.

## 1. Decisions

| # | Decision |
|---|---|
| B-D1 | Bidding is open only while the shift is S5 and TTS > 0. |
| B-D2 | A manager may pick a winner any time while TTS > 0. There is no 4h lock (the emergent lane is gone). |
| B-D3 | **Urgent lane** (0 < TTS ≤ 24h): a compliant bid placed inside the window wins at once (S5 → S4). When a shift crosses into the window, the earliest compliant pending bid wins (FIFO). A manager may still pick by hand until someone wins. No per-org toggle. |
| B-D4 | A bid is refused only for hard impossibilities: approved leave on the day, an overlapping shift, missing/expired qualifications, or no contract matching the shift's employment target in its sub-department. Every other rule is checked when the winner is chosen. |
| B-D5 | Whoever dropped the shift, or rejected its offer, may not bid on it. A withdrawn bid may be placed again (it rejoins the back of the queue). |
| B-D6 | Approved leave cancels the employee's pending bids on shifts dated inside the leave. |
| B-D7 | A manager may fill an S5 shift with someone who did not bid; it goes straight to **S4**. |
| B-D8 | Bids end in a terminal status that says why (§3). No pending bid outlives the S5 state. |
| B-D9 | **Offer expiry**: an offer (S3) not answered within `LEAST(published + 48h, start)` goes to **S5** like a rejection. If it is still pending at start, the shift goes to **S10** with reason **A**. |
| B-D10 | **Cancellation reasons** at start (TTS = 0), stored in `shifts.kickoff_cancel_code`: **A** offer ignored · **B** bidding found no winner · **C** draft never assigned (S1) · **D** assigned draft never published (S2). NULL for a manager's cancellation. Codes do not feed reliability or fairness scoring: a coded cancellation is logged as one `OP_APPLIED` `cancel` event carrying the code, never as `CANCELLED`/`LATE_CANCELLED` against the employee. A and D keep the assignee on the record (a started shift cannot change hands). |
| B-D11 | Drafts that started before the C/D rule went live (2026-11-04 10:00 UTC) are left alone. |
| B-D12 | Once a shift has started, nothing unpublishes or drops it (`SHIFT_STARTED`), even before the minute timer has swept it: an unpublished S5 would be swept as a draft (C) instead of B. Drop is S4-only — an unanswered offer (S3) is rejected, which costs the employee nothing. |
| B-D13 | **Delete is for drafts (S1/S2) only** (`fsm_op_is_legal`, `_shift_delete_refusal`, `shifts_delete_rbac`). Published shifts are cancelled instead (`SHIFT_PUBLISHED`), which preserves their history and audit trail. Singly and in bulk. |
| B-D14 | **`sm_cancel_shift`** cancels published shifts (S3–S7) and in-progress shifts before clock-in (S8 with no punch; punched shifts return `SHIFT_WORKED`). A non-empty reason note is required (`REASON_REQUIRED`). Assignees and trade partners are notified via `notify_user` (`shift_cancelled`). Pending offers expire, and bids/trades close via existing triggers. |
| B-D15 | A manager's cancellation is logged in `shift_events` as an `OP_APPLIED` `cancel` event carrying the note, never as `CANCELLED`/`LATE_CANCELLED` against the employee (no reliability impact). |
| B-D16 | Gateway publish enforces parity with `sm_bulk_publish_shifts`: refuses started shifts (`SHIFT_STARTED`), full-time shifts go directly to S4 confirmed and require an assignee (`FT_NEEDS_ASSIGNEE`). `sm_employee_drop_shift` no longer records an 'emergent' (< 4h) urgency band on drops (an emergent-lane label, never a lockout). |

## 2. States involved

| State | Meaning for bidding |
|---|---|
| **S5** Bidding | Published, unassigned. The only state that holds pending bids. |
| **S4** Confirmed | A winner was chosen (or the manager filled it directly). |
| **S1** Draft | The manager unpublished it; bidding closed. |
| **S10** Cancelled | Cancelled by a manager, or reached its start without a winner (reason B). |

## 3. Records — `shift_bids` (one row per shift per employee)

| Status | Meaning |
|---|---|
| `pending` | Live bid on an S5 shift |
| `accepted` | This bidder got the shift |
| `rejected` | Someone else got the shift |
| `withdrawn` | The bidder took it back (may bid again) |
| `expired` *(new)* | The shift reached its start with no winner |
| `cancelled` *(new)* | The shift left bidding without a winner being chosen (unpublished, cancelled), or the bidder's leave was approved |

## 4. Invariants

| # | Invariant | Enforced by |
|---|---|---|
| BI1 | A bid is `pending` only while its shift is S5. | `trg_shift_close_bids` (every way out of S5) |
| BI2 | ≤ 1 row per (shift, employee). | unique key `shift_bids_shift_id_employee_id_key` |
| BI3 | Clients never write `shift_bids`. | grants revoked (B2); only `sm_place_bid`, `withdraw_bid_rpc` and the gateway write |
| BI4 | No bid from the person who dropped or rejected the shift. | `sm_place_bid` |

## 5. Operations

| Op | Actor | Legal when | Effect |
|---|---|---|---|
| `sm_place_bid(shift, notes)` | employee (self) | S5, TTS > 0, not excluded (B-D5), no hard impossibility (B-D4), no pending bid already | inserts, or reopens a closed row as `pending` with a fresh `created_at` |
| `withdraw_bid_rpc(bid, employee)` | bidder or manager | bid `pending`, TTS > 0 | `withdrawn` |
| `sm_select_bid_winner(shift, winner)` | manager | S5, TTS > 0, winner's bid `pending`, blocking compliance passes | S5 → S4 via the gateway |
| leave approved | system | — | pending bids on leave dates → `cancelled` |

## 6. Closing bids (single owner)

`trg_shift_close_bids` fires whenever a shift leaves S5 and closes every pending bid:

| Shift moves to | Pending bids become |
|---|---|
| S3/S4 (winner chosen, direct fill) | assignee's bid `accepted`, the rest `rejected` |
| S10 at or after start (timer) | `expired` |
| S10 before start (manager cancel) or S1 (unpublish) | `cancelled` |

A deleted shift takes its bids with it (FK cascade). Each bidder is notified by `trg_bid_outcome_notification`.

## 7. Timers (`process_shift_timers`)

| When | Shift | Result |
|---|---|---|
| offer deadline (48h) passed, TTS > 0 | S3 | → S5 (B-D9) |
| TTS ≤ 24h, compliant pending bid | S5 | → S4, earliest bid wins (B-D3) |
| TTS = 0 | S3 | → S10, reason A |
| TTS = 0 | S5 | → S10, reason B |
| TTS = 0 | S1 / S2 | → S10, reason C / D |

## 8. Phases

| Phase | Scope | Status |
|---|---|---|
| **B1** | `sm_place_bid`; bid statuses `expired`/`cancelled`; `trg_shift_close_bids`; leave cancels bids; 4h lock removed; app places bids through the RPC | built (#56) |
| **B2** | Revoke client writes on `shift_bids`; `shifts.kickoff_cancel_code`; offer expiry → S5 / code A; S5 → S10 code B; drafts → S10 codes C/D | built |
| **B3** | Urgent lane in the database (on bid and at the 24h crossover) | deferred |
| **B4** | App: kickoff codes on the roster card's state badge (tooltip + screen-reader label) | built |
| **B4b** | Client auto-assign loop removed (with B3) | deferred |
| **P4** | Delete drafts only; `sm_cancel_shift` + Cancel Shift dialog (required note) in the Group/Roles/drill-down menus; bulk delete skips published; gateway publish parity; manager cancellations never count against the employee | built |
| **B5** | Scenario matrix + hardening | — |
