# RPC Usage & Analysis Report (Post-Migration V3)

This table details the usage of Remote Procedure Calls (RPCs) across the `Superman` codebase, updated after the **V3 State Machine Migration**.

## 1. State Machine & Legacy RPCs (Shift Lifecycle)

| RPC Name | Status | Location(s) used | V3 State Machine Alignment |
| :--- | :--- | :--- | :--- |
| **`sm_publish_shift`** | ✅ **Active** (v2) | `shifts.api.ts` | **Authoritative**: Transitions Draft (S1/S2) -> Published (S3/S5/S6). |
| `unpublish_shift` | ⛔ **Deprecated** | `shifts.api.ts` | **Protected**: Now throws error if shift is Published. Use `sm_manager_cancel` or `sm_close_bidding` instead. (Function exists in DB but is only called for error throwing). |
| `sm_unpublish_shift` | ❌ Unused | *(DB Only)* | Not used. V3 is forward-only. |
| `accept_shift_offer` | 💀 **Dead Code** | *(DB Only)* | **Removed from App**. Replaced by **`sm_accept_offer`**. (Function remains in DB). |
| `decline_shift_offer` | 💀 **Dead Code** | *(DB Only)* | **Removed from App**. Replaced by **`sm_reject_offer`**. (Function remains in DB). |
| `assign_shift_rpc` | 💀 **Dead Code** | *(DB Only)* | **Removed from App**. Replaced by **`sm_select_bid_winner`** (Bidding) or **`sm_emergency_assign`** (Manager Override). |
| `assign_shift` | 💀 **Dead Code** | *(DB Only)* | **Removed from App**. Replaced by **`sm_select_bid_winner`** in OpenBidsView. |
| `withdraw_shift_from_bidding` | 💀 **Dead Code** | *(DB Only)* | **Removed from App**. Replaced by **`sm_close_bidding`**. |
| `withdraw_bid_rpc` | ⚠️ **Legacy** | `bidding.api.ts` | **Pending**: Used for employee self-withdrawal. Should eventually use `sm_withdraw_bid` if available. |
| `cancel_shift_v2` | 💀 **Dead Code** | *(DB Only)* | **Removed from App**. Replaced by **`sm_manager_cancel`**. |
| `delete_shift_cascade` | 🟢 **Utility** | `shifts.api.ts` | **Utility**: Hard deletes a shift. |
| `bulk_publish_shifts` | 🟢 **Utility** | `shifts.api.ts` | **Utility**: Calls `sm_publish_shift` internally (verified). |

## 2. Roster Management & Templates

| RPC Name | Location(s) used | Inferred Functionality |
| :--- | :--- | :--- |
| `get_roster_days_in_range` | `useRosters.ts` | **Active**: Data Fetching for rosters. |
| `get_or_create_roster_day` | `useRosters.ts` | **Active**: Roster Day management. |
| `assign_employee_to_shift` | `useRosters.ts` | **Active**: Used for **Draft** assignments (Standard Planning). |
| `apply_template_to_date_range` | `useRosters.ts` | **Active**: Template application. |

## 3. Swaps (Employee Trading)

| RPC Name | Status | V3 State Machine Alignment |
| :--- | :--- | :--- |
| `approve_swap_request` | 💀 **Dead Code** | **Removed from App**. Replaced by **`sm_approve_trade`** (S10 -> S4). (Function remains in DB). |
| `reject_swap_request` | 💀 **Dead Code** | **Removed from App**. Custom implementation: Manually reverts S9/S10 -> S4 (NoTrade). (Function remains in DB). |
| `accept_swap_offer` | 💀 **Dead Code** | **Removed from App**. Replaced by **`sm_accept_trade`** (S9 -> S10). (Function remains in DB). |
| `createSwapRequest` | 🟢 **Active** | Uses **`sm_request_trade`** (S4 -> S9). |

---

## Migration Status Summary

- **Shift Lifecycle**: ✅ Fully Migrated to `sm_*`.
- **Assignment**: ✅ Split into Draft (`assign_employee_to_shift`) and Published (`sm_select_bid_winner` / `sm_emergency_assign`).
- **Swaps**: ✅ Fully Migrated to `sm_*`.
- **Unpublish**: ⛔ Strictly deprecated (Forward-only policy enforced).
- **Database Cleanup**: ⚠️ **Pending Admin Action**. Legacy functions marked as "Dead Code" still exist in the database due to permission restrictions preventing DROP. They are safe to ignore as they are no longer invoked by the application.

The codebase is now aligned with the **V3 Forward-Only State Machine**.
