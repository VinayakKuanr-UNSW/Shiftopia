---
name: access-cert-backend
description: Implements FastAPI middleware, permission resolution, and scope enforcement for the Access Certificate system including Type X, Type Y, and global filtering validation.
disable-model-invocation: true
allowed-tools: Read, Grep
---

# Access Certificate Backend Enforcement Skill

This skill defines the backend architecture and implementation strategy for enforcing:

- Type X certificates
- Type Y certificates
- Scope resolution
- Global filtering validation
- Secure data querying
- Middleware based permission control

This applies to FastAPI services.

---

# 1. Architecture Overview

The backend must enforce access in three layers:

1. Certificate Resolver
2. Permission Engine
3. Scope Enforcement Middleware

Frontend filtering must never be trusted.

---

# 2. Core Components

## 2.1 Certificate Service

Responsible for:

- Fetching user certificates
- Validating constraints
- Building effective permission model

Function:

resolve_user_permissions(user_id) → PermissionObject

PermissionObject structure:

{
  typeX: [ {level, org, dept, subdept} ],
  typeY: {level, org, dept, subdept} or null,
  allowed_personal_scope: [],
  allowed_managerial_scope: {}
}

This object should be cached per request or session.

---

# 3. Permission Model Resolution

## 3.1 Personal Scope Resolution

Allowed combinations = union of all Type X certificates.

Example:

If user has:
Alpha Org1 Dept1 Sub1  
Beta Org2 Dept2 Sub3  

Allowed_personal_scope becomes:

[
  {org:1, dept:1, sub:1},
  {org:2, dept:2, sub:3}
]

---

## 3.2 Managerial Scope Resolution

Based on Type Y:

Zeta → unrestricted  
Epsilon → restrict org  
Delta → restrict org + dept  
Gamma → restrict org + dept + subdept  

Construct scope rules:

{
  org_ids: [],
  dept_ids: [],
  subdept_ids: [],
  lock_level: "org" | "dept" | "subdept" | "none"
}

---

# 4. Middleware Design

Create a FastAPI dependency:

get_permission_context()

This must:

1. Extract user_id from auth token
2. Load certificates
3. Resolve permission model
4. Attach to request.state.permission

Example:

request.state.permission = PermissionObject

---

# 5. Scope Validation Utility

All filtered endpoints must call:

validate_scope(request_scope, permission_scope)

If request tries selecting:
- org not allowed
- dept outside allowed org
- subdept outside allowed dept

Return 403.

Never silently adjust scope.

---

# 6. Query Enforcement Layer

Create a helper:

apply_scope_filter(query, permission_scope, request_scope, mode)

mode:
- personal
- managerial

---

## 6.1 Personal Mode Logic

Only allow queries that match one of allowed_personal_scope combinations.

Pseudo:

WHERE (
   (org=1 AND dept=1 AND sub=1)
   OR
   (org=2 AND dept=2 AND sub=3)
)

If Beta:
Timesheets must be read only.

---

## 6.2 Managerial Mode Logic

If Zeta:
No filter.

If Epsilon:
WHERE org = fixed

If Delta:
WHERE org = fixed AND dept = fixed

If Gamma:
WHERE org = fixed AND dept = fixed AND subdept = fixed

---

# 7. Endpoint Pattern

All protected endpoints must:

1. Inject permission context
2. Validate filter payload
3. Apply scoped query

Example pattern:

@router.post("/rosters")
async def get_rosters(
    filters: FilterPayload,
    permission = Depends(get_permission_context)
):
    validate_scope(filters, permission)
    query = base_query()
    query = apply_scope_filter(query, permission, filters, mode="managerial")
    return execute(query)

---

# 8. Write Protection Rules

Before mutating endpoints:

validate_action_permission(action, permission)

Examples:

Alpha:
- deny write on managerial pages

Beta:
- deny edit timesheets

Gamma:
- allow within subdept only

Delta:
- allow within dept only

---

# 9. Certificate Creation Validation

On POST /users/{id}/certificates:

Validate:

1. Only one Type Y
2. Level scope matches rules
3. Org hierarchy valid
4. No overlapping invalid combinations

Reject invalid input with 400.

---

# 10. Performance Optimizations

- Cache permission object per request
- Use indexed fields: org_id, dept_id, subdept_id
- Avoid dynamic OR queries if possible
- Precompute union scopes

---

# 11. Error Handling Standards

Return:

403 → Scope violation  
400 → Invalid certificate structure  
404 → Hierarchy not found  

Never expose internal permission structure in error message.

---

# 12. Logging Requirements

Log:

- Scope violations
- Unauthorized attempts
- Certificate creation failures

Include:
user_id
requested_scope
endpoint

---

# 13. Testing Requirements

Unit tests must cover:

- Single Type Y enforcement
- Multiple Type X union logic
- Zeta unrestricted
- Gamma fully locked
- Beta timesheet read only
- Scope tampering attempt

Integration tests must verify:

- Backend blocks invalid filter even if frontend manipulated.

---

# 14. Security Guarantees

This system guarantees:

- No horizontal data leakage
- No vertical privilege escalation
- No reliance on frontend enforcement
- Strict role separation

---

# 15. Future Enhancements

Phase 2:

- Action based permission matrix
- Policy based access control layer
- Dynamic role registry table
- Audit trail for permission changes

---

End of Backend Enforcement Skill
