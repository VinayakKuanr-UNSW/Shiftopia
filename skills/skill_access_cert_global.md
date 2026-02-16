---
name: global-scope-filter-react
description: Implements the React architecture for the certificate aware GlobalScopeFilter including PersonalScopeFilter and ManagerialScopeFilter with locking logic, multi select behavior, and strict alignment with backend permission models.
disable-model-invocation: true
allowed-tools: Read, Grep
---

# React Global Scope Filter Architecture Skill

This skill defines the frontend architecture for implementing the certificate aware GlobalScopeFilter component.

It applies to React applications using a centralized permission model provided by backend.

Frontend must never compute permissions independently.
It must render based on backend resolved permission object.

---

# 1. Architectural Principles

1. Certificate driven UI
2. No permission calculation in UI
3. Locking derived from certificate level
4. Scope tree provided by backend
5. Clear separation between personal and managerial logic
6. All filters emit structured scope object to parent page

---

# 2. Expected Backend Contract

GET /api/me/permissions

Returns:

{
  typeX: [
    { level, org_id, dept_id, subdept_id }
  ],
  typeY: {
    level,
    org_id,
    dept_id,
    subdept_id
  } | null,
  allowed_scope_tree: {
    organizations: [
      {
        id,
        name,
        departments: [
          {
            id,
            name,
            subdepartments: [
              { id, name }
            ]
          }
        ]
      }
    ]
  }
}

Frontend must rely entirely on allowed_scope_tree.

---

# 3. Component Structure

Core:

GlobalScopeFilter

Wrappers:

PersonalScopeFilter
ManagerialScopeFilter

Parent pages decide which wrapper to use.

---

# 4. Component Responsibility

GlobalScopeFilter handles:

- Render Org multi select
- Render Dept multi select
- Render SubDept multi select
- Apply locking rules
- Maintain local state
- Emit normalized scope object

Wrappers handle:

- Lock configuration
- Default selection rules
- Mode selection personal or managerial

---

# 5. State Model

Internal state:

{
  selectedOrgIds: [],
  selectedDeptIds: [],
  selectedSubDeptIds: []
}

Lock model:

{
  orgLocked: boolean,
  deptLocked: boolean,
  subDeptLocked: boolean
}

Mode:

"personal" | "managerial"

---

# 6. PersonalScopeFilter Logic

Allowed combinations = union of all Type X certificates.

Initialization:

1. Extract allowed orgs from certificates
2. Prefill selectedOrgIds with all allowed
3. Prefill dept and subdept accordingly

Multi select required because multiple certificates may exist.

Selection rules:

- Org selection updates dept list
- Dept selection updates subdept list
- Subdept must match at least one certificate combination

User cannot select combinations outside allowed certificate scope.

Filtering must enforce:

If user selects Org1 and Org2
Dept dropdown shows only depts under those orgs from allowed_scope_tree.

---

# 7. ManagerialScopeFilter Logic

Derived from Type Y level.

If Zeta:
orgLocked = false
deptLocked = false
subDeptLocked = false

If Epsilon:
orgLocked = true
deptLocked = false
subDeptLocked = false

If Delta:
orgLocked = true
deptLocked = true
subDeptLocked = false

If Gamma:
orgLocked = true
deptLocked = true
subDeptLocked = true

For locked fields:
- Prefill with certificate value
- Disable selection control

Optional:
If all three locked, hide entire filter.

---

# 8. Locking Behavior Rules

Locked means:

- Value preselected
- Control disabled
- Cannot emit change

Multi select must be disabled when locked.

Do not remove field visually.
Disabled state keeps clarity.

---

# 9. Emitted Scope Format

On change:

onScopeChange({
  org_ids: [],
  dept_ids: [],
  subdept_ids: []
})

Parent page passes this object to API.

---

# 10. Preventing Illegal UI State

Before emitting:

Validate local state against allowed_scope_tree.

If invalid:
- Do not emit
- Reset to last valid state

Never allow illegal combinations even visually.

---

# 11. Performance Considerations

- Memoize filtered departments
- Memoize filtered subdepartments
- Avoid full tree recalculation on every render
- Use useMemo for derived lists
- Avoid deep re rendering

For large org structures:
- Lazy render dropdown content
- Consider virtualization

---

# 12. UX Rules

Default behavior:

If unlocked:
Prefill with all allowed scope.

If locked:
Prefill with fixed scope.

Empty selection not allowed.

Show badge summary:

Org: 2 selected
Dept: 3 selected
SubDept: 5 selected

---

# 13. Separation of Concerns

Pages must not:
- Access permission object directly
- Override locking logic
- Hardcode certificate rules

Pages only:
- Render correct wrapper
- Receive scope object
- Fetch data using scope

---

# 14. Error Handling

If permission API fails:
- Show blocking state
- Do not render filter
- Do not allow page data fetch

If allowed_scope_tree empty:
- Show no access message

---

# 15. Testing Requirements

Unit tests:

- Zeta fully unlocked
- Gamma fully locked
- Epsilon org locked only
- Personal union logic correct
- Multi select updates cascade properly

Integration tests:

- Filter emits correct payload
- Locked controls cannot be changed
- Invalid manual DOM changes do not emit illegal scope

---

# 16. Scalability Considerations

Future enhancements:

- Add action level permission badges
- Add scope summary chips
- Add saved filter presets
- Support dynamic role registry from backend

Component must be extensible for additional certificate levels.

---

# 17. Security Reminder

Frontend locking is for UX only.

Backend remains source of truth.

Never rely on UI filtering alone.

---

End of React Global Scope Filter Skill
