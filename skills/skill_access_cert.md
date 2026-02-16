---
name: access-cert-prd
description: Generates the full technical PRD for the Access Certificate and Global Scope Filtering system including architecture, DB design, permission engine, UI logic, and backend enforcement. Use when defining or updating role based access control and global filtering.
disable-model-invocation: true
---

# Access Certificate & Global Scope Filtering System  
Technical Product Requirements Document

---

# 1. Overview

This document defines the architecture and behavior of:

1. Access Certificates for Users
2. Type X and Type Y permission model
3. Global Scope Filtering system
4. UI locking logic
5. Backend enforcement
6. API contracts
7. Security model
8. Edge cases and scalability

The system must be certificate driven.  
UI and data access must always derive from certificates.

Hierarchy structure:

Organization → Department → SubDepartment

---

# 2. Business Objectives

- Support flexible but controlled access across hierarchy.
- Allow multiple personal scope certificates.
- Allow only one managerial scope certificate.
- Provide global filtering at the top of each page.
- Enforce scope restrictions at backend level.
- Prevent over permission exposure.
- Keep system scalable for future role expansion.

---

# 3. Access Certificate Model

## 3.1 Certificate Types

### Type X (Personal Access)
Multiple allowed per user.

Levels:
- Alpha
- Beta

Used for personal pages.

### Type Y (Managerial Access)
Only one allowed per user.

Levels:
- Gamma
- Delta
- Epsilon
- Zeta

Used for managerial pages.

Effective Identity Format:

Y(Level) + X(Level) + X(Level) + ...n

---

# 4. Permission Definitions

## 4.1 Type X

### Alpha
Access:
- MyRoster
- MyAvailabilities
- MyBids
- MySwaps
- MyBroadcasts

Scope:
- Org required
- Dept required
- SubDept required

### Beta
Access:
- All personal pages
- Timesheets page (view only)

Scope:
- Org required
- Dept required
- SubDept required

Timesheets restricted to certificate subdepartment only.

---

## 4.2 Type Y

Managerial Pages:
- Templates
- Rosters
- Timesheets
- Open Bids
- Swap Requests
- Users
- Insights
- Broadcasts

Only one Type Y allowed.

### Zeta
Scope:
- Org = ALL (locked)
- Dept = ALL (locked)
- SubDept = ALL (locked)

### Epsilon
Scope:
- Org selectable (single)
- Dept = ALL
- SubDept = ALL

### Delta
Scope:
- Org selectable
- Dept selectable
- SubDept = ALL

### Gamma
Scope:
- Org selectable
- Dept selectable
- SubDept selectable

---

# 5. Database Design

## 5.1 users

id  
name  
email  

## 5.2 access_certificates

id  
user_id  
certificate_type (X or Y)  
certificate_level  
organization_id nullable  
department_id nullable  
sub_department_id nullable  
created_at  

---

## 5.3 Constraints

1. Only one Type Y per user  
   unique index on user_id where certificate_type = 'Y'

2. Validation rules:
   - Zeta → org, dept, subdept must be null
   - Epsilon → dept, subdept null
   - Delta → subdept null
   - Gamma, Alpha, Beta → all required

3. Foreign key constraints enforce hierarchy validity.

---

# 6. Add Certificate Modal Requirements

Step 1  
Select Type X or Type Y

Step 2  
Select Level (dynamic based on type)

Step 3  
Dynamic scope fields

Locking rules enforced in UI and backend.

Frontend must disable inputs according to selected level.  
Backend must validate regardless of UI state.

---

# 7. Global Scope Filtering System

## 7.1 Core Principle

Global filter must be certificate aware.  
Pages must not define access logic independently.

---

## 7.2 Component Architecture

Core Component:
GlobalScopeFilter

Wrapper Components:
- PersonalScopeFilter
- ManagerialScopeFilter

Core handles:
- Allowed scope resolution
- Multi select state
- Lock state
- Scope emission

---

# 8. Personal Pages Filtering Logic

Allowed scope = union of all Type X certificates.

If user has:
Alpha Org1 Dept1 Sub1  
Beta Org2 Dept2 Sub3  

Then:

Org dropdown:
Selectable values = Org1, Org2

Dept dropdown:
Populated based on selected orgs

SubDept dropdown:
Populated based on selected departments

Only certificate allowed combinations may be selected.

Multi select required because multiple certificates may exist.

---

# 9. Managerial Pages Filtering Logic

Depends on Type Y level.

### Zeta
Org multi select enabled  
Dept multi select enabled  
SubDept multi select enabled  

No backend scope restriction.

### Epsilon
Org locked  
Dept multi select  
SubDept multi select  

Backend filter:
where organization_id = fixed

### Delta
Org locked  
Dept locked  
SubDept multi select  

Backend filter:
where org = fixed  
and dept = fixed

### Gamma
Org locked  
Dept locked  
SubDept locked  

No filter interaction required.  
Header may optionally be hidden.

---

# 10. Backend Enforcement Layer

All APIs must pass through:

Permission Middleware  
Scope Resolver  

Example pseudo logic:

if level == Zeta:
  no filter

if level == Epsilon:
  filter by org

if level == Delta:
  filter by org and dept

if level == Gamma:
  filter by org and dept and subdept

Beta:
  filter timesheets by specific subdept

Never trust frontend locking.

---

# 11. Effective Permission Object

At login, backend returns:

{
  personal_certificates: [],
  managerial_certificate: {},
  computed_scope_tree: {}
}

Frontend must never calculate allowed hierarchy manually.

---

# 12. API Contract Example

GET /api/me/permissions

Returns:

{
  typeX: [...],
  typeY: {...},
  allowed_scope_tree: {...}
}

All data endpoints accept:

{
  org_ids: [],
  dept_ids: [],
  subdept_ids: []
}

Backend validates against certificate scope before executing query.

---

# 13. Security Requirements

- Backend enforced filtering mandatory
- Scope must be validated on every request
- No raw hierarchy fetching without scope check
- Prevent certificate creation outside valid hierarchy
- Soft delete or invalidate certificates if hierarchy removed

---

# 14. Edge Cases

1. User with only Type X
   No managerial access

2. User with Type Y but no Type X
   Personal pages still accessible

3. User with Gamma Y and Beta X in different org
   Personal scope independent of managerial scope

4. Department deletion
   Certificates referencing it must be invalidated

---

# 15. Performance Considerations

- Cache resolved permission object in session
- Fetch only allowed scope tree
- Avoid global hierarchy loading
- Use indexed filters on org_id, dept_id, subdept_id

---

# 16. Future Scalability

Phase 2 enhancements:
- Role table abstraction
- Permission action matrix
- Granular permissions: view, edit, approve, delete
- Role inheritance support
- Policy based access layer

---

# 17. Non Functional Requirements

- Query response under 300ms for large datasets
- No client side only enforcement
- UI state must always reflect backend permission
- Clean separation between personal and managerial logic

---

# 18. Success Criteria

- Users only see allowed scope
- No unauthorized data exposure
- UI locking matches certificate model
- Backend validation prevents bypass
- System supports large multi org structure

---

End of PRD
