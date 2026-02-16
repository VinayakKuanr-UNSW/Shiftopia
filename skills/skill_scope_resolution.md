---
name: scope-resolution-engine
description: Scope Resolution Engine — determines and enforces accessible scope for a user across the system based on Access Certificates. Central authorization resolver.
disable-model-invocation: true
---

# Claude Skill: Scope Resolution Engine

## Skill Name

Scope Resolution Engine

---

## Skill Purpose

The Scope Resolution Engine is responsible for determining and enforcing the accessible scope for a user across the system. It resolves which Organizations, Departments, and SubDepartments a user can view, select, and query based on their Access Certificates.

This engine ensures strict hierarchical enforcement, supports locked and selectable scopes, enables multi certificate aggregation, and guarantees backend level security enforcement.

This skill is a core authorization layer and must be used by all pages and data queries that operate within organizational scope.

---

## Core Responsibilities

The Scope Resolution Engine performs the following functions:

1. Resolves allowed scope for a user from Access Certificates
2. Determines which scope levels are locked and which are selectable
3. Determines whether single select or multi select is allowed
4. Produces UI ready scope configuration
5. Produces backend enforced query scope constraints
6. Prevents unauthorized scope access
7. Supports multi certificate aggregation for Alpha and Beta users
8. Supports page specific scope behavior

---

## Scope Hierarchy Definition

Scope hierarchy is strictly structured as follows:

Organization
→ Department
→ SubDepartment

Constraints:

* Each Department belongs to exactly one Organization
* Each SubDepartment belongs to exactly one Department
* SubDepartment cannot exist outside its Department
* Department cannot exist outside its Organization

---

## Access Certificate Model

Each user has one or more access certificates.

Each certificate contains:

* certificate_id
* user_id
* scope_level
* organization_id
* department_id nullable
* sub_department_id nullable

Scope levels supported:

ZETA
EPSILON
DELTA
GAMMA
BETA
ALPHA

---

## Scope Level Behavior

### ZETA Level Behavior

Definition:

User has unrestricted global access.

Engine Resolution:

allowed_organizations = ALL
allowed_departments = ALL
allowed_sub_departments = ALL

UI State:

organization_locked = false
department_locked = false
sub_department_locked = false

multi_select_enabled = false

---

### EPSILON Level Behavior

Definition:

Organization is locked. Departments and SubDepartments selectable within organization.

Engine Resolution:

allowed_organizations = certificate.organization_id
allowed_departments = ALL departments within organization
allowed_sub_departments = ALL subdepartments within organization

UI State:

organization_locked = true
department_locked = false
sub_department_locked = false

multi_select_enabled = false

---

### DELTA Level Behavior

Definition:

Organization and Department locked. SubDepartments selectable within department.

Engine Resolution:

allowed_organizations = certificate.organization_id
allowed_departments = certificate.department_id
allowed_sub_departments = ALL subdepartments within department

UI State:

organization_locked = true
department_locked = true
sub_department_locked = false

multi_select_enabled = false

---

### GAMMA Level Behavior

Definition:

Organization, Department, and SubDepartment fully locked.

Engine Resolution:

allowed_organizations = certificate.organization_id
allowed_departments = certificate.department_id
allowed_sub_departments = certificate.sub_department_id

UI State:

organization_locked = true
department_locked = true
sub_department_locked = true

multi_select_enabled = false

---

### ALPHA and BETA Level Behavior

Definition:

User may possess multiple certificates. Multi select enabled.

Engine Resolution:

allowed_organizations = all organizations from certificates
allowed_departments = all departments from certificates
allowed_sub_departments = all subdepartments from certificates

UI State:

organization_locked = false
department_locked = false
sub_department_locked = false

multi_select_enabled = true

Selection must be limited strictly to certificate scope.

---

## Scope Resolution Algorithm

Input:

user_id
page_type

Process:

Step 1. Fetch all certificates for user

Step 2. Determine highest privilege scope type

Priority order:

ZETA
EPSILON
DELTA
GAMMA
ALPHA
BETA

Step 3. Aggregate allowed scope

If ZETA present:

allow global scope

Else if EPSILON present:

lock organization

Else if DELTA present:

lock organization and department

Else if GAMMA present:

lock organization, department, subdepartment

Else if ALPHA or BETA present:

aggregate multiple scopes

Step 4. Produce resolved scope object

Output object:

resolved_scope:

allowed_organizations
allowed_departments
allowed_sub_departments

organization_locked
department_locked
sub_department_locked

multi_select_enabled

---

## Multi Certificate Aggregation Logic

For Alpha and Beta users:

Union aggregation is used.

Example:

Certificates:

Org A → Dept 1 → SubDept A
Org A → Dept 2 → SubDept B
Org B → Dept 4 → SubDept F

Result:

allowed_organizations = Org A, Org B
allowed_departments = Dept 1, Dept 2, Dept 4
allowed_sub_departments = SubDept A, SubDept B, SubDept F

---

## Page Type Behavior

Two page types exist.

Type X Pages:

Templates
Rosters
Management
Broadcast
Insights
Configurations

Scope selectable according to resolved scope.

Type Y Pages:

MyRoster
MyProfile
Personal pages

Scope fully locked to user's primary assignment.

---

## Backend Enforcement Contract

All backend queries must apply resolved scope constraints.

Mandatory constraint pattern:

organization_id must exist in allowed_organizations

department_id must exist in allowed_departments

sub_department_id must exist in allowed_sub_departments

Unauthorized scope access must be rejected.

Frontend filtering is not trusted for security.

---

## Engine Output Contract

The Scope Resolution Engine produces:

resolved_scope:

allowedOrganizations array
allowedDepartments array
allowedSubDepartments array

organizationLocked boolean
departmentLocked boolean
subDepartmentLocked boolean

multiSelectEnabled boolean

---

## Example Output

Example for Delta User:

allowedOrganizations:

ICC Sydney

allowedDepartments:

Theatre

allowedSubDepartments:

Front of House
Backstage

organizationLocked = true
departmentLocked = true
subDepartmentLocked = false

multiSelectEnabled = false

---

## Integration Points

This engine must be used by:

GlobalScopeFilter component
All backend queries
Roster queries
Template queries
Management queries
Broadcast queries
Insights queries

---

## Performance Requirements

Scope resolution must complete under 5 milliseconds.

Certificates must be cached per session.

Indexes must exist on:

access_certificates.user_id
access_certificates.organization_id
access_certificates.department_id
access_certificates.sub_department_id

---

## Security Requirements

The engine must guarantee:

No access outside certificate scope
No privilege escalation
Strict hierarchical enforcement
Backend enforced authorization

---

## Failure Behavior

If no certificate exists:

deny all scope

If invalid certificate exists:

deny all scope

If scope resolution fails:

deny all scope

---

## Summary

The Scope Resolution Engine is the central authorization resolver that determines what organizational scope a user can access. It enforces hierarchical constraints, supports locked and selectable scopes, enables multi certificate aggregation, and ensures secure backend enforced access control.
