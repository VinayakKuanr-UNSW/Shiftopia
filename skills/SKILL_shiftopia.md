---
name: shiftopia-state-machine
description: Authoritative specification for Shiftopia shift state machine. Use when implementing, modifying, debugging, or validating shift-related features including lifecycle management, assignment workflows, bidding, trading, attendance tracking, and UI state derivation. Required for any work involving shift states, transitions, or business rules.
---

# Shiftopia Shift State Machine

This skill provides the authoritative state machine specification for Shiftopia shifts. All shift-related development must conform to this specification.

## Core Architecture

Shifts use **orthogonal state dimensions** - no single combined status string is allowed. UI state is derived, never authoritative. All transitions must be validated server-side.

### State Dimensions

| Dimension          | Values                                                        | Required |
| ------------------ | ------------------------------------------------------------- | -------- |
| Lifecycle          | Draft, Published, InProgress, Completed, Cancelled            | Yes      |
| Assignment         | Unassigned, Assigned                                          | Yes      |
| Assignment Outcome | Pending, Offered, Confirmed, EmergencyAssigned (or null)      | No       |
| Bidding            | NotOnBidding, OnBiddingNormal, OnBiddingUrgent, BiddingClosedNoWinner | Yes      |
| Trading            | NoTrade, TradeRequested, TradeAccepted, TradeApproved         | Yes      |
| Attendance         | Unknown, CheckedIn, NoShow                                    | Yes      |
| Time Lock          | Editable, LockedByTime (derived, not stored)                  | Derived  |

## Key Invariants (Never Break)

1. Assignment cannot change after Confirmed
2. Assignment cannot change while OnBidding
3. EmergencyAssigned skips Offered flow
4. NoShow is attendance status, not cancellation
5. Time-based locks override everything
6. Only 15 valid state combinations exist (S1-S15)

## Quick Reference

### Lifecycle Flow
```
Draft → Published → InProgress → Completed
                 ↘ Cancelled
```

### Assignment Flow
```
Unassigned → Assigned (via auto/manual/emergency assign or bidding winner)
Assigned + Offered → Confirmed (employee accepts) or Unassigned (employee rejects → bidding)
```

### Cancellation Rules (Confirmed shifts only)
| Time Before Start | Result              |
| ----------------- | ------------------- |
| > 24h             | Normal bidding (S5) |
| 24h–4h            | Urgent bidding (S6) |
| < 4h              | Emergency assign (S7) |

## Detailed Specification

For complete tables and transition rules, see [references/state-machine.md](references/state-machine.md):

- **Valid State Combinations (S1-S15)**: All allowed dimension combinations
- **Transition Rules**: Draft, Offered, Bidding, Cancellation, Trading, Time-based flows
- **Edit Modal Locking**: Field-level locking rules by state
- **Compliance Enforcement Points**: When compliance engine must run
- **Bulk Action Rules**: Multi-shift operation constraints

## Implementation Guidance

### Validating State Transitions

Always check transitions against the valid combinations table. Any state outside S1-S15 must be rejected.

```
Before transition:
1. Identify current state (S1-S15)
2. Check if action is valid from current state
3. Run compliance if required (assign, emergency assign, trade approval, bidding winner)
4. Apply transition atomically
```

### Deriving UI State

UI state is always derived from the orthogonal dimensions:

```
If Lifecycle ∈ {InProgress, Completed, Cancelled} → fully locked
If Lifecycle = Published AND Outcome = Offered → modal locked
If Lifecycle = Published AND OnBidding → assignment locked, time editable
```

### Database Constraints

Enforce valid states via:
- Postgres enums for each dimension
- CHECK constraints for valid combinations
- RPC guards for transition validation
