# Shift State Machine – Unpublish-Aware Specification

This document extends the existing **Shift State Machine – Complete Specification** to explicitly support **Unpublish** as a first-class action, with deterministic state transitions and hard guarantees about employee-facing visibility.

---

## 0. Core Principle

> **Unpublish is a controlled reversal to Draft that immediately removes the shift from all employee-facing surfaces, without destroying history.**

Unpublish:
- Is **not Delete**
- Is **not Cancel**
- Is **not silent**
- Always results in **Draft**
- Clears employee exposure immediately

---

## 1. Publication Status (Derived)

Publication is **derived from Lifecycle**, not stored.

| Lifecycle   | Published? |
|------------|------------|
| Draft      | ❌ No       |
| Published  | ✅ Yes      |
| InProgress | ✅ Yes (historical) |
| Completed  | ✅ Yes (historical) |
| Cancelled  | ❌ No       |

**Rule:**  
Only `Lifecycle = Published` shifts may appear on employee-facing pages.

---

## 2. Unpublish Action – Definition

### 2.1 What Unpublish Is

**Unpublish** is a manager-only action that:

- Transitions a shift from `Published → Draft`
- Immediately removes the shift from:
  - MyRoster
  - MyBids
  - MySwaps
- Preserves the shift for editing, reassignment, or re-publishing

---

## 3. Valid Unpublish Entry Points

Unpublish is allowed from **any Published state** (before time lock).

| Current State | Unpublish Allowed | Resulting State |
|--------------|------------------|-----------------|
| S3 – Published + Offered | ✅ | S2 – Draft + Assigned |
| S4 – Published + Confirmed | ✅ | S2 – Draft + Assigned |
| S5 – Published + OnBiddingNormal | ✅ | S1 – Draft + Unassigned |
| S6 – Published + OnBiddingUrgent | ✅ | S1 – Draft + Unassigned |
| S7 – Published + EmergencyAssigned | ✅ | S2 – Draft + Assigned |
| S8 – Published + BiddingClosedNoWinner | ✅ | S1 – Draft + Unassigned |
| S9 – Published + Confirmed + TradeRequested | ✅ | S2 – Draft + Assigned |

**Rule:** Assigned shifts → S2 (assignment retained, outcome cleared to pending). Unassigned / bidding shifts → S1 (assignment and bidding cleared).

### 3.1 Explicitly Blocked

Unpublish is **not allowed** from:

- S11, S12 – InProgress (shift is underway)
- S13, S14 – Completed (historical record)
- S15 – Cancelled

---

## 4. Unpublish Resolution Rules

### 4.1 Offered → Draft

**From:**  
`Published + Assigned + Offered (S3)`

**To:**  
`Draft + Assigned + Pending (S2)`

**Rules:**
- Assignment is preserved
- Offer is revoked
- Employee is notified:  
  _“Shift offer withdrawn”_
- Shift disappears from:
  - MyRoster
  - MySwaps

---

### 4.2 Confirmed / EmergencyAssigned → Draft

**From:**
`Published + Assigned + Confirmed (S4)` or `Published + Assigned + EmergencyAssigned (S7)`

**To:**
`Draft + Assigned + Pending (S2)`

**Rules:**
- Assignment is preserved (employee remains assigned)
- Confirmation / emergency-assignment outcome is cleared (outcome resets to `pending`)
- Employee is notified:
  _”Your confirmed shift on [date/time] was retracted by the employer.”_
- Shift disappears from:
  - MyRoster

---

### 4.3 Bidding → Draft

**From:**
`Published + Unassigned + OnBidding (S5 / S6 / S8)`

**To:**
`Draft + Unassigned (S1)`

**Rules:**
- All bids are invalidated
- No winner selection is possible
- Employees may see:
  _”Shift removed by employer”_
- Shift disappears from:
  - MyBids
  - MyRoster

---

## 5. Employee-Facing Visibility Rules

### 5.1 Visibility Matrix

| Page     | Visible When | Hidden When |
|---------|--------------|-------------|
| MyRoster | Published + Confirmed, InProgress | Draft, Offered, Bidding, Cancelled |
| MyBids   | Published + OnBidding | Draft, Offered, Confirmed, Cancelled |
| MySwaps  | Published + Confirmed | Draft, Offered, Bidding, Cancelled |

**Guarantee:**  
Unpublish removes the shift from all employee-facing pages immediately.  
No caching grace period is allowed.

---

## 6. Notifications & Side Effects

### 6.1 Offered Shift Unpublished

- Push + in-app notification:
  > “Your shift offer on **[date/time]** was withdrawn by the employer.”

### 6.2 Confirmed / EmergencyAssigned Shift Unpublished

- Push + in-app notification:
  > “Your confirmed shift on **[date/time]** was retracted by the employer.”

### 6.3 Bidding Shift Unpublished

- Optional (configurable) notification:
  > “A shift you bid on is no longer available.”

---

## 7. Audit & Compliance Rules

### 7.1 Audit Record (Mandatory)

Each Unpublish action must record:

- Actor (manager or system)
- Timestamp
- Previous state
- Reason code (required):
  - Scheduling change
  - Staffing change
  - Error correction
  - Other (free text)

---

### 7.2 Compliance Engine

Compliance **does not run on Unpublish** because:

- No assignment is created
- No work is scheduled
- No payroll impact occurs

---

## 8. Edit Modal After Unpublish

| Resulting State | Edit Modal |
|---------------|------------|
| S1 – Draft + Unassigned | Fully unlocked |
| S2 – Draft + Assigned | Fully unlocked |

**Rule:**  
Unpublish is the **only safe path** to regain full editability once Published.

---

## 9. Button Behavior (Updated)

### 9.1 Publish / Unpublish Matrix

| State | Publish | Unpublish |
|-----|--------|-----------|
| Draft + Unassigned (S1) | Visible | Hidden |
| Draft + Assigned (S2) | Visible | Hidden |
| Published + Offered (S3) | Hidden | Visible |
| Published + OnBidding (S5, S6, S8) | Hidden | Visible |
| Published + Confirmed (S4) | Hidden | Visible |
| Published + EmergencyAssigned (S7) | Hidden | Visible |
| InProgress | Hidden | Hidden |
| Completed | Hidden | Hidden |
| Cancelled | Hidden | Hidden |

---

## 10. Invariants (Extended)

Add the following invariants to the existing list:

6. Unpublish always results in `Draft`  
7. Unpublished shifts are invisible to employees  
8. Unpublish never changes assignment except when clearing bidding  
9. Time lock blocks Unpublish absolutely  

---

## 11. Mental Model

- **Publish** = expose to employees  
- **Unpublish** = retract exposure  
- **Cancel** = destroy intent  
- **Delete** = hard stop  

If a shift is visible to employees, it **must** be Published.  
If it is not Published, it **must not** appear on any employee-facing surface.

---

## 12. Properties

This specification is:

- Deterministic
- Race-condition safe
- UI-derivable
- Auditable
- Payroll-safe
- Compliance-safe
