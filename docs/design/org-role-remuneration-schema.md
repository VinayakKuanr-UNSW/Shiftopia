# HR Organizational and Remuneration Framework Schema Design

## 1. Design Overview & Normalization

This document outlines a production-grade, normalized relational database design (3NF) to enforce a strict organizational hierarchy for HR systems. The design ensures that every role within a subdepartment adheres to a standardized remuneration framework.

### Hierarchy
`Organization → Department → Subdepartment → Role`

### Key Requirements
- **Standardized Remuneration Framework:** Every subdepartment must follow the exact same remuneration framework.
- **Remuneration Levels:** Exactly eight standardized levels (0 to 7).
  - Level 0: Trainee
  - Levels 1-7: Progressive role tiers
- **Constraints:** 
  - Each subdepartment must have exactly one role for each of the 8 levels.
  - The level is mandatory and cannot be null.
  - Unique constraint on `(subdepartment_id, remuneration_level)` ensures no duplicate levels per subdepartment.

## 2. Schema Architecture (`hr` Schema)

We introduce a namespaced `hr` schema to avoid polluting the `public` schema and to decouple the organizational structure from legacy tables.

### Tables

1. **`hr.organizations`**
   - Represents the top-level entity.

2. **`hr.departments`**
   - Belongs to an organization.

3. **`hr.subdepartments`**
   - Belongs to a department.

4. **`hr.remuneration_levels`**
   - A static lookup table defining the 8 levels (0-7).
   - Uses a natural key (`smallint` 0-7) as the Primary Key for cleaner reporting and referential integrity.

5. **`hr.roles`**
   - Associates a `subdepartment` with a `remuneration_level`.
   - Contains a unique constraint on `(subdepartment_id, remuneration_level)` to enforce the "at most one role per level" requirement.

6. **`hr.employees`**
   - Represents an employee in the system.

7. **`hr.employee_assignments`**
   - Maps employees to specific roles within the organization.

## 3. Compliance Enforcement (Triggers)

To ensure that every new subdepartment automatically complies with the remuneration framework, we implement an `AFTER INSERT` trigger (`trg_seed_subdept_roles`).

### Behavior
When a new record is inserted into `hr.subdepartments`, the trigger automatically inserts 8 corresponding records into `hr.roles`, one for each level (0-7), with default naming conventions (e.g., "[Subdepartment Name] - Level X").

## 4. Why this beats many-tables / fallback structures

- **No Fallback Logic Needed:** Because `remuneration_level` is mandatory and intrinsically tied to the role, the application codebase (e.g., projectors and pay engines) no longer needs complex fallback logic to handle "unassigned" roles.
- **Reporting:** Natural keys for levels make aggregations and analytics straightforward.
- **Scalability:** The normalized structure scales effortlessly as new departments and subdepartments are added, without requiring DDL changes or separate tables per department.
