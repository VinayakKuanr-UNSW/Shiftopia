# Shift State Machine – Complete Specification

## Table of Contents

1. [State Dimensions](#1-state-dimensions)
2. [Valid State Combinations](#2-valid-state-combinations)
3. [Transition Rules](#3-transition-rules)
4. [Edit Modal Locking Rules](#4-edit-modal-locking-rules)
5. [Compliance Enforcement Points](#5-compliance-enforcement-points)
6. [Bulk Action Rules](#6-bulk-action-rules)
7. [Invariants](#7-invariants)
8. [UI Actions by State](#8-ui-actions-by-state)
9. [Edit Shift Modal – Field-Level Editability](#9-edit-shift-modal--field-level-editability)
10. [Button Visibility by State](#10-button-visibility-by-state)
11. [Key UI Guarantees](#11-key-ui-guarantees)

---

## 1. State Dimensions

### 1.1 Lifecycle (required)

| Value      | Meaning                             |
| ---------- | ----------------------------------- |
| Draft      | Created or pulled back, not visible |
| Published  | Visible and actionable              |
| InProgress | Start time crossed                  |
| Completed  | Ended normally                      |
| Cancelled  | Cancelled by system or manager      |

### 1.2 Assignment (required)

| Value      | Meaning         |
| ---------- | --------------- |
| Unassigned | No employee     |
| Assigned   | Employee linked |

### 1.3 Assignment Outcome (nullable)

Only valid when `Assignment = Assigned`

| Value             | Meaning                       |
| ----------------- | ----------------------------- |
| Pending           | Assigned in draft             |
| Offered           | Offer sent, awaiting response |
| Confirmed         | Accepted and locked           |
| EmergencyAssigned | Direct manager assignment     |

### 1.4 Bidding (required)

| Value                 | Meaning               |
| --------------------- | --------------------- |
| NotOnBidding          | Default               |
| OnBiddingNormal       | Standard bidding      |
| OnBiddingUrgent       | Late cancellation     |
| BiddingClosedNoWinner | Closed with no winner |

### 1.5 Trading (required)

| Value          | Meaning                    |
| -------------- | -------------------------- |
| NoTrade        | Default                    |
| TradeRequested | Employee requested trade   |
| TradeAccepted  | Another employee accepted  |
| TradeApproved  | Approved and ready to swap |

### 1.6 Attendance (required)

| Value     | Meaning           |
| --------- | ----------------- |
| Unknown   | Before check in   |
| CheckedIn | Employee attended |
| NoShow    | Did not attend    |

### 1.7 Time Lock (derived, not stored)

| Value        | Meaning                |
| ------------ | ---------------------- |
| Editable     | Start time not crossed |
| LockedByTime | Start time crossed     |

---

## 2. Valid State Combinations

**Only these 15 combinations may exist. Anything outside this table must be rejected.**

| ID  | Lifecycle  | Assignment | Outcome           | Bidding               | Trading        |
| --- | ---------- | ---------- | ----------------- | --------------------- | -------------- |
| S1  | Draft      | Unassigned | null              | NotOnBidding          | NoTrade        |
| S2  | Draft      | Assigned   | Pending           | NotOnBidding          | NoTrade        |
| S3  | Published  | Assigned   | Offered           | NotOnBidding          | NoTrade        |
| S4  | Published  | Assigned   | Confirmed         | NotOnBidding          | NoTrade        |
| S5  | Published  | Unassigned | null              | OnBiddingNormal       | NoTrade        |
| S6  | Published  | Unassigned | null              | OnBiddingUrgent       | NoTrade        |
| S7  | Published  | Assigned   | EmergencyAssigned | NotOnBidding          | NoTrade        |
| S8  | Published  | Unassigned | null              | BiddingClosedNoWinner | NoTrade        |
| S9  | Published  | Assigned   | Confirmed         | NotOnBidding          | TradeRequested |
| S10 | Published  | Assigned   | Confirmed         | NotOnBidding          | TradeAccepted  |
| S11 | InProgress | Assigned   | Confirmed         | NotOnBidding          | NoTrade        |
| S12 | InProgress | Assigned   | EmergencyAssigned | NotOnBidding          | NoTrade        |
| S13 | Completed  | Assigned   | Confirmed         | NotOnBidding          | NoTrade        |
| S14 | Completed  | Assigned   | EmergencyAssigned | NotOnBidding          | NoTrade        |
| S15 | Cancelled  | Any        | null              | NotOnBidding          | NoTrade        |

---

## 3. Transition Rules

### 3.1 Draft Transitions

| From     | Action            | To       |
| -------- | ----------------- | -------- |
| S1       | Auto assign       | S2       |
| S1       | Manual assign     | S2       |
| S2       | Change assignment | S2       |
| S1 or S2 | Publish           | S3 or S5 |

**Publish resolution:**
- Assigned → Offered (S3)
- Unassigned → OnBiddingNormal (S5)

### 3.2 Offered Flow

| From | Action           | To |
| ---- | ---------------- | -- |
| S3   | Employee accepts | S4 |
| S3   | Employee rejects | S5 |
| S3   | Pull back        | S2 |

**S3 is fully locked** - no edits allowed while offer pending.

### 3.3 Bidding Flow

| From     | Action               | To |
| -------- | -------------------- | -- |
| S5 or S6 | Winner selected      | S4 |
| S5 or S6 | Close with no winner | S8 |
| S5 or S6 | Pull back            | S1 |

**Note:** Assignment is cleared when bidding starts.

### 3.4 Cancellation by Employee (Confirmed Only)

| Time Before Start | Result                  |
| ----------------- | ----------------------- |
| > 24h             | S5 (Normal bidding)     |
| 24h–4h            | S6 (Urgent bidding)     |
| < 4h              | S7 (EmergencyAssigned)  |

**EmergencyAssigned bypasses offer flow.** Compliance must pass.

### 3.5 Trading Flow

Only allowed from S4 (Published + Confirmed).

| From | Action               | To  |
| ---- | -------------------- | --- |
| S4   | Request trade        | S9  |
| S9   | Accept trade         | S10 |
| S10  | Approve + compliance | S4  |

If compliance fails → revert to S4.

**Trading never enters bidding.**

### 3.6 Time-Based Transitions

| Condition          | Transition             |
| ------------------ | ---------------------- |
| Start time crossed | Published → InProgress |
| End time crossed   | InProgress → Completed |

### 3.7 Attendance Transitions

| State      | Action               | Result                 |
| ---------- | -------------------- | ---------------------- |
| InProgress | Check in             | Attendance = CheckedIn |
| InProgress | Grace window expires | Attendance = NoShow    |

**Attendance does NOT change lifecycle.**

### 3.8 No-Show Recovery (Optional)

| Condition        | Action                       |
| ---------------- | ---------------------------- |
| Enough time left | Emergency assign replacement |
| Not enough time  | Leave unfilled               |

**Does not reopen bidding.**

---

## 4. Edit Modal Locking Rules

### 4.1 Global Lock

If `Lifecycle ∈ {InProgress, Completed, Cancelled}` → **fully locked** 🔐

### 4.2 Field-Level Locking

| State                         | Modal     | Assignment | Time Fields |
| ----------------------------- | --------- | ---------- | ----------- |
| Draft                         | Unlocked  | Editable   | Editable    |
| Published + Offered           | Locked    | Locked     | Locked      |
| Published + OnBidding         | Partial   | Locked     | Editable    |
| Published + Confirmed         | Partial   | Locked     | Editable    |
| Published + EmergencyAssigned | Partial   | Locked     | Editable    |
| InProgress                    | Locked 🔐 | Locked     | Locked      |
| Completed                     | Locked    | Locked     | Locked      |
| Cancelled                     | Locked    | Locked     | Locked      |

---

## 5. Compliance Enforcement Points

Compliance engine **must** run on:

- Auto assign
- Manual assign
- Emergency assign
- Trade approval
- Bidding winner selection

**Failure blocks the transition.**

---

## 6. Bulk Action Rules

| Action           | Constraint                        |
| ---------------- | --------------------------------- |
| Bulk publish     | Only from Draft                   |
| Bulk push to bid | Only if Unassigned and time valid |
| Bulk pull back   | Always → Draft + Unassigned       |

- Each row evaluated independently
- Partial failures returned explicitly

---

## 7. Invariants

These rules must **never** be broken:

1. Assignment cannot change after Confirmed
2. Assignment cannot change while OnBidding
3. EmergencyAssigned skips Offered
4. NoShow is attendance, not cancellation
5. Time-based locks override everything

---

## 8. UI Actions by State

### 8.1 Publish / Unpublish Behavior

| Current State                          | Publish Click                      | Unpublish Click           |
| -------------------------------------- | ---------------------------------- | ------------------------- |
| Draft + Unassigned (S1)                | → Published + OnBiddingNormal (S5) | Not available             |
| Draft + Assigned (S2)                  | → Published + Offered (S3)         | Not available             |
| Published + Offered (S3)               | Disabled                           | → Draft + Assigned (S2)   |
| Published + OnBidding (S5, S6)         | Disabled                           | → Draft + Unassigned (S1) |
| Published + Confirmed (S4)             | Disabled                           | Disabled                  |
| Published + EmergencyAssigned (S7)     | Disabled                           | Disabled                  |
| Published + BiddingClosedNoWinner (S8) | Disabled                           | → Draft + Unassigned (S1) |
| InProgress (S11, S12)                  | Disabled                           | Disabled                  |
| Completed (S13, S14)                   | Disabled                           | Disabled                  |
| Cancelled (S15)                        | Disabled                           | Disabled                  |

**Rules:**
- Publish is the only entry point into Offered or Bidding
- Unpublish is the only exit from Offered or Bidding
- Publish and Unpublish are blocked once start time has crossed

### 8.2 Delete Shift Behavior

| State                              | Delete Allowed         | Result            |
| ---------------------------------- | ---------------------- | ----------------- |
| Draft (S1, S2)                     | Yes                    | → Cancelled (S15) |
| Published + Offered (S3)           | Yes                    | → Cancelled (S15) |
| Published + OnBidding (S5, S6, S8) | Yes                    | → Cancelled (S15) |
| Published + Confirmed (S4)         | Yes (confirm required) | → Cancelled (S15) |
| Published + EmergencyAssigned (S7) | Yes (confirm required) | → Cancelled (S15) |
| InProgress                         | No                     | Blocked           |
| Completed                          | No                     | Blocked           |
| Cancelled                          | No                     | Blocked           |

**Delete is always a hard cancel and must be audited.**

---

## 9. Edit Shift Modal – Field-Level Editability

### 9.1 Global Rules

- If `Lifecycle ∈ {InProgress, Completed, Cancelled}` → Edit modal **fully locked** 🔐
- If state is **Published + Offered** → Edit modal **fully locked** 🔐

### 9.2 Modal Tabs and Fields

**Schedule Tab:**
- Shift Date, Start Time, End Time
- Paid Break Minutes, Unpaid Break Minutes
- Timezone

**Role Tab:**
- Role, Remuneration Level

**Requirements Tab:**
- Required Skills, Required Licenses, Events

**Notes Tab:**
- Notes

**Assignment:**
- Assigned Employee

*System and Audit tabs are always read-only.*

### 9.3 Field Editability Matrix

| State                                  | Modal     | Schedule | Role     | Requirements | Notes    | Assignment |
| -------------------------------------- | --------- | -------- | -------- | ------------ | -------- | ---------- |
| Draft + Unassigned (S1)                | Unlocked  | Editable | Editable | Editable     | Editable | Editable   |
| Draft + Assigned (S2)                  | Unlocked  | Editable | Editable | Editable     | Editable | Editable   |
| Published + Offered (S3)               | Locked 🔐 | Locked   | Locked   | Locked       | Locked   | Locked     |
| Published + OnBidding (S5, S6)         | Partial   | Editable | Editable | Editable     | Editable | Locked     |
| Published + BiddingClosedNoWinner (S8) | Partial   | Editable | Editable | Editable     | Editable | Locked     |
| Published + Confirmed (S4)             | Partial   | Editable | Editable | Editable     | Editable | Locked     |
| Published + EmergencyAssigned (S7)     | Partial   | Editable | Editable | Editable     | Editable | Locked     |
| InProgress (S11, S12)                  | Locked 🔐 | Locked   | Locked   | Locked       | Locked   | Locked     |
| Completed (S13, S14)                   | Locked    | Locked   | Locked   | Locked       | Locked   | Locked     |
| Cancelled (S15)                        | Locked    | Locked   | Locked   | Locked       | Locked   | Locked     |

### 9.4 Partial Edit Rules

When modal is **Partial**:
- Assignment is always locked
- Compliance must re-run if edits affect: Role, Remuneration, Required Skills, Required Licenses
- If compliance fails, save is blocked

---

## 10. Button Visibility by State

| State                         | Publish | Unpublish | Edit     | Delete  |
| ----------------------------- | ------- | --------- | -------- | ------- |
| Draft                         | Visible | Hidden    | Visible  | Visible |
| Published + Offered           | Hidden  | Visible   | Disabled | Visible |
| Published + OnBidding         | Hidden  | Visible   | Visible  | Visible |
| Published + Confirmed         | Hidden  | Hidden    | Visible  | Visible |
| Published + EmergencyAssigned | Hidden  | Hidden    | Visible  | Visible |
| InProgress                    | Hidden  | Hidden    | Hidden   | Hidden  |
| Completed                     | Hidden  | Hidden    | Hidden   | Hidden  |
| Cancelled                     | Hidden  | Hidden    | Hidden   | Hidden  |

---

## 11. Key UI Guarantees

1. No silent state changes
2. Publish and Unpublish are symmetric and predictable
3. Assignment changes are impossible once confirmed
4. Partial edits never affect assignment
5. Time lock always wins

---

## Implementation Notes

This specification is:
- Deterministic
- Race-condition safe
- UI derivable
- Auditable
- Payroll safe
- Compliance safe

Can be translated into:
- Postgres enums + CHECK constraints
- Supabase RPC guard pseudocode
- Frontend permission helpers
- QA test cases per state and button