---
description: Access Control System - Identity vs Authority, Schema, and Page Behavior
---

# Access Control Logic

This skill defines the enterprise access control system. It distinguishes between **Identity** (who you are/where you belong) and **Authority** (what power you have).

## 1. Identity vs. Authority

### Position Contract (Identity)
*   **Definition:** Represents a user's employment record.
*   **Purpose:** Defines the primary "Identity" of the user within the organization hierarchy.
*   **Hierarchy Resolution:** Each contract strictly maps to: `Organization -> Department -> Sub-Department -> Role`.
*   **Multi-Role:** A user can have multiple active Position Contracts (e.g., Working as a Waiter in 'Dept A' and a Supervisor in 'Dept B').

### Access Certificate (Authority)
*   **Definition:** Represents a granted "Authority" level and its effective scope.
*   **Purpose:** Determines the **Access Level** (Alpha to Epsilon) and whether the user's scope is locked or open across the hierarchy.
*   **Authority Fallback:** For **Delta** and **Epsilon** levels, the certificate overrides specific contract permissions (Superuser Fallback).

## 2. Database Schema

### `user_contracts` (Position Contracts)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Primary Key |
| `user_id` | UUID | Foreign Key to `profiles.id` |
| `organization_id` | UUID | Primary Organization |
| `department_id` | UUID | Primary Department |
| `sub_department_id` | UUID | Primary Sub-Department |
| `role_id` | UUID | Job Role (maps to name/permissions) |
| `status` | Text | 'Active', 'Inactive', etc. |
| `access_level` | Enum | [DEPRECATED] Use `app_access_certificates` |

### `app_access_certificates` (Access Authority)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Primary Key |
| `user_id` | UUID | Foreign Key to `profiles.id` |
| `organization_id` | UUID | Authority limited to this Org |
| `department_id` | UUID? | If set, Authority is locked to this Dept |
| `sub_department_id` | UUID? | If set, Authority is locked to this Sub-Dept |
| `access_level` | Enum | `alpha`, `beta`, `gamma`, `delta`, `epsilon` |

## 3. Global Header Behavior

*   **Organization:** **LOCKED**. Users cannot change Organization in the header. To change Orgs, a user must switch their **Access Certificate** via the sidebar.
*   **Hierarchy Filtering:**
    *   **Epsilon:** Can select any Department/Sub-Department in the Org.
    *   **Delta:** Department is **Locked**. Can select any Sub-Department within it.
    *   **Gamma/Beta/Alpha:** Department and Sub-Department are both **Locked**.

## 4. Page Visibility & Behavior Matrix

Managerial Pages include: *Templates, Rosters, Timesheets, Open Bids, Swap Requests, Audit Trail, Broadcasts, Insights.*

| Level | Available Pages | Behavior & Scope |
| :--- | :--- | :--- |
| **Alpha** | Personal Pages Only | Locked strictly to their **Position Contract's** Sub-Department. |
| **Beta** | Alpha + Timesheets | **Timesheets:** View-only for their Sub-Department. |
| **Gamma** | Alpha + Managerial | **Scope:** Locked to their specific Sub-Department. |
| **Delta** | Alpha + Managerial + Admin | **Scope:** Locked to Department. Can manage **ANY** Sub-Department under it. |
| **Epsilon** | Alpha + Managerial + Admin + Users/Config | **Scope:** Locked to Organization. Can manage **ANY** Dept/Sub-Dept under it. |

### Page Definitions:
*   **Personal Pages:** Dashboard, My Rosters, Availabilities, My Bids, My Swaps, My Broadcasts.
*   **Managerial Pages:** Templates, Rosters, Timesheets, Open Bids, Swap Requests, Audit Trail, Broadcasts, Insights.
*   **Admin Pages:** Approvals, Budgeting, Compliance (Delta/Epsilon).
*   **Global Admin Pages:** Users Management, Configurations, Global Settings (Epsilon Only).

## 5. Page Behavior & Interactive Elements

### Personal Pages (All Levels)
*   **Behavior:** Strictly filtered to the user's `employee_id`.
*   **Common Buttons:**
    *   **"Shift Offers" (Mail Icon):** Opens modal to **Accept** or **Decline** direct offers.
    *   **"Request Swap":** Initiates a swap request for an assigned shift.
    *   **"Withdraw Bid":** Removes a pending bid from a shift.

### Managerial Pages (Gamma+)
*   **Rosters Page:**
    *   **"Add Shift" (Plus Icon):** Create a new shift. Allowed for Gamma+.
    *   **"Publish Roster":** Makes shifts visible to employees. Allowed for Gamma+ (Scope limited).
    *   **"Lock Toggle":** Locks the roster for the period. Usually restricted to Delta+.
*   **Timesheets Page:**
    *   **"Adjust Entry":** Modify clock-in/out times. Allowed for Gamma+.
    *   **"Approve/Reject" (Bulk):** Move entries to payroll status. Restricted to **Delta+**.
*   **Open Bids Page:**
    *   **"Assign Winner" (Check Icon):** Selects an employee from the bid list.
    *   **"Withdraw Shift":** Removes shift from bidding.

### Global Admin Pages (Epsilon Only)
*   **Users Page:**
    *   **"Add Contract":** Create a new Position Contract for a user.
    *   **"Manage Certificates":** Assign Authority levels.
*   **Configurations:** Master data management (Organizations, Depts, Roles).

## 6. Real-World Examples

### Example A: The Dual-Role User
*   **Position Contract 1:** Waiter (Role) in the 'Cafe' (Sub-Dept).
*   **Position Contract 2:** Supervisor (Role) in the 'Kitchen' (Sub-Dept).
*   **Access Certificate:** **Gamma (Manager)** locked to 'Kitchen' Sub-Dept.
*   **Result:** When using this certificate, they can manage the Kitchen roster (Add Shifts, etc.) but can only view their own shifts in the Cafe via personal pages.

### Example B: The Regional Manager
*   **Access Certificate:** **Delta (Dept Admin)** locked to 'Food & Beverage' (Department).
*   **Result:** The Global Header locks their Department to 'F&B'. They can select $any$ Sub-Department (Cafe, Kitchen, Bar) in the header and manage all of them.

### Example C: The Global Admin
*   **Access Certificate:** **Epsilon (Global Admin)**.
*   **Result:** They have an "Open Scope". They can select any Department and any Sub-Department in the Org. The "Users" and "Configurations" links are visible in their sidebar.

## 7. Switching Identity Context
Users switch their active **Access Certificate** in the sidebar. This triggers:
1.  Reload of `accessScope` (Setting new locking rules).
2.  Reset of Header selections (Clearing Dept/Sub-Dept to defaults).
3.  Re-evaluation of `hasPermission()` (Sidebar sections appear/disappear).
