# Swaps + Shift State Machine – Combined Complete Specification

> This document defines the **combined state machine** for **Shift Trading (Swaps)** and the **core Shift State Machine**.
> It is written so an **agentic AI** can operate **only from DB state** and still:
> - Know which page it is on
> - Know which buttons are visible
> - Know which actions are legal
> - Know which RPC to call
> - Know which transitions are forbidden

---

## Table of Contents

1. [State Dimensions](#1-state-dimensions)
2. [Combined Valid State Combinations](#2-combined-valid-state-combinations)
3. [Combined State Diagram (Narrative)](#3-combined-state-diagram-narrative)
4. [Transition Rules (Swaps + Shift SM)](#4-transition-rules-swaps--shift-sm)
5. [Pages and Their Responsibilities](#5-pages-and-their-responsibilities)
6. [UI Actions by Combined State](#6-ui-actions-by-combined-state)
7. [Modal-Level Rules](#7-modal-level-rules)
8. [Compliance Enforcement Points](#8-compliance-enforcement-points)
9. [Time-Based Rules](#9-time-based-rules)
10. [Invariants](#10-invariants)
11. [Key UI Guarantees](#11-key-ui-guarantees)

---

## 1. State Dimensions

### 1.1 Shift Lifecycle (authoritative)

| Value      | Meaning                             |
| ---------- | ----------------------------------- |
| Draft      | Not visible to employees            |
| Published  | Visible and actionable              |
| InProgress | Start time crossed                  |
| Completed  | Ended normally                      |
| Cancelled  | Cancelled by system or manager      |

---

### 1.2 Shift Trading (derived from swaps)

| Value          | Meaning                               |
| -------------- | ------------------------------------- |
| NoTrade        | Default                               |
| TradeRequested | Swap request exists (S9)              |
| TradeAccepted  | Offer selected (S10)                  |

---

### 1.3 Swap Request State (`shift_swaps.status`)

| Value           | Meaning                                  |
| --------------- | ---------------------------------------- |
| OPEN            | Accepting offers                         |
| MANAGER_PENDING | Offer selected, awaiting approval        |
| APPROVED        | Swap applied                             |
| REJECTED        | Manager rejected                         |
| CANCELLED       | Requester cancelled                     |
| EXPIRED         | Time lock expired                       |

---

### 1.4 Swap Offer State (`swap_offers.status`)

| Value      | Meaning                                      |
| ---------- | -------------------------------------------- |
| SUBMITTED  | Offer sent                                   |
| SELECTED   | Chosen by requester                          |
| REJECTED   | Rejected due to another selection            |
| WITHDRAWN  | Withdrawn by offerer                         |

---

### 1.5 Time Lock (derived)

| Value        | Meaning                        |
| ------------ | ------------------------------ |
| Editable     | Now < shift start − 4h         |
| LockedByTime | Now ≥ shift start − 4h         |

---

## 2. Combined Valid State Combinations

Only the following **Shift + Swap** combinations may exist.

| ID | Shift State | Trading | Swap Request | Meaning |
|----|------------|---------|--------------|--------|
| C1 | S4         | NoTrade | —            | Normal confirmed shift |
| C2 | S9         | TradeRequested | OPEN | Swap posted, collecting offers |
| C3 | S10        | TradeAccepted | MANAGER_PENDING | Offer selected |
| C4 | S4         | NoTrade | APPROVED | Swap completed |
| C5 | S4         | NoTrade | REJECTED | Swap rejected |
| C6 | S4         | NoTrade | CANCELLED | Swap cancelled |
| C7 | S4         | NoTrade | EXPIRED | Swap expired |

Anything outside this table is invalid and must be rejected.

---

## 3. Combined State Diagram (Narrative)

This is the **end-to-end story** an agent must understand.

1. A **Published + Confirmed shift (S4)** is stable.
2. Employee clicks **Request Swap**.
   - Shift transitions **S4 → S9**
   - Swap request enters **OPEN**
3. Other employees submit offers.
   - Multiple `swap_offers = SUBMITTED`
4. Requester selects one offer.
   - Swap request → **MANAGER_PENDING**
   - Shift transitions **S9 → S10**
5. Manager reviews.
   - Approve → `sm_approve_peer_swap`
     - Shift A reassigned
     - Shift B reassigned
     - Shift returns to **S4**
     - Swap → **APPROVED**
   - Reject
     - Shift returns **S10 → S4**
     - Swap → **REJECTED**
6. If time lock hits at any point:
   - Swap → **EXPIRED**
   - Shift rolls back to **S4**

---

## 4. Transition Rules (Swaps + Shift SM)

| T | From (Shift, Swap) | Action | To (Shift, Swap) | Actor |
|---|-------------------|--------|------------------|-------|
| T1 | S4, — | Request Swap | S9, OPEN | Requester |
| T2 | S9, OPEN | Submit Offer | S9, OPEN | Offerer |
| T3 | S9, OPEN | Withdraw Offer | S9, OPEN | Offerer |
| T4 | S9, OPEN | Select Offer | S10, MANAGER_PENDING | Requester |
| T5 | S10, MANAGER_PENDING | Approve | S4, APPROVED | Manager |
| T6 | S10, MANAGER_PENDING | Reject | S4, REJECTED | Manager |
| T7 | S9, OPEN | Cancel | S4, CANCELLED | Requester |
| T8 | S9/S10 | Time Lock | S4, EXPIRED | System |

---

## 5. Pages and Their Responsibilities

### 5.1 My Roster (Shift Context)

**Purpose**
- Entry point into swaps

**Buttons**
- Request Swap (only if Shift = S4 and Editable)

**DB Signal**
- Shift = S4
- No active swap exists

---

### 5.2 My Swaps Page

**Purpose**
- Personal swap dashboard

**Shows**
- Requests I created
- Requests I offered on

**Buttons by Role**
- Requester: View Offers, Cancel
- Offerer: Withdraw
- Everyone: Read-only past swaps

---

### 5.3 Available Swaps Page

**Purpose**
- Marketplace for swap offers

**Shows**
- All swaps where `status = OPEN`

**Buttons**
- Make Offer

---

### 5.4 View Offers Modal (Requester)

**Purpose**
- Review candidates

**Buttons**
- Select Offer (exactly one)

**Locks**
- Closes immediately after selection

---

### 5.5 Offer Swap Modal (Offerer)

**Purpose**
- Submit an offer

**Buttons**
- Run Compliance
- Send Offer

**Guards**
- Must pass 2-way compliance

---

### 5.6 Manager Review Page

**Purpose**
- Final authority

**Buttons**
- Approve
- Reject

**Effect**
- Calls `sm_approve_peer_swap`

---

## 6. UI Actions by Combined State

| Combined State | Page | Button | Enabled | Action |
|---------------|------|--------|---------|--------|
| C1 | Roster | Request Swap | Yes | Create swap |
| C2 | My Swaps | Cancel | Yes | Cancel swap |
| C2 | Available Swaps | Make Offer | Yes | Offer |
| C2 | My Swaps | Withdraw | Yes | Withdraw |
| C2 | View Offers | Select | Yes | Lock |
| C3 | Manager Review | Approve | Yes | Commit |
| C3 | Manager Review | Reject | Yes | Rollback |
| C4–C7 | Any | Any | No | Read-only |

---

## 7. Modal-Level Rules

| Modal | When Open | Locked When |
|-----|-----------|-------------|
| Offer Swap | Swap = OPEN | After submit |
| View Offers | Swap = OPEN | After select |
| Shift Edit | Never during swap | Always |

---

## 8. Compliance Enforcement Points

Compliance **must run on**:
- Offer submission
- Offer selection snapshot
- Manager approval (authoritative)

Failure blocks transition.

---

## 9. Time-Based Rules

| Condition | Result |
|---------|--------|
| Now ≥ start − 4h | Swap → EXPIRED |
| Time locked | All buttons disabled |
| Approval after lock | Forbidden |
| Expired Lifecycle | Visible for context, but non-actionable (greyed out) |

---

## 10. Invariants

1. Only one swap per shift
2. Only one selected offer
3. Shift SM is authoritative
4. Assignment changes only in SM
5. Time lock overrides all intent
6. Approved swaps are irreversible

---

## 11. Key UI Guarantees

1. UI is derived only from DB state
2. No hidden transitions
3. No partial swaps
4. Buttons reflect legality exactly
5. Agent can reason without UI context

---

## Implementation Notes

This spec is:
- Agent-readable
- Deterministic
- Race-safe
- Auditable
- Fully aligned with Shift SM

It can directly drive:
- Agentic planners
- Guardrail policies
- Frontend permissions
- QA automation
- Observability rules
---

## 12. Agentic AI – Reasoning Contract (DB-Only Context)

This section defines **how an agentic AI must reason** using **only database state**.  
The agent must **never assume UI state**, user intent, or frontend flow.

---

### 12.1 Authoritative Inputs for the Agent

The agent may read **only**:

- `shifts`
- `shift_swaps`
- `swap_offers`
- `profiles`
- Current server time

The agent must **not rely on**:
- Cached UI flags
- Client-side timers
- Derived frontend labels

---

### 12.2 How the Agent Infers “Where the User Is”

The agent infers the **current page context** strictly from state.

| DB Observation | Agent Interpretation |
|---------------|---------------------|
| Shift = S4 AND no swap | User is on **My Roster** |
| shift_swaps.status = OPEN AND requester_id = user | **My Swaps – Requester view** |
| swap_offers.SUBMITTED AND offerer_id = user | **My Swaps – Offerer view** |
| shift_swaps.status = OPEN AND user ≠ requester | **Available Swaps** |
| shift_swaps.status = MANAGER_PENDING AND user is manager | **Manager Review** |

---

### 12.3 How the Agent Decides Which Buttons Exist

Buttons are **derived**, never stored.

Example logic:

```text
IF shift.lifecycle = Published
AND shift.trading = NoTrade
AND time_lock = Editable
THEN show Request Swap
