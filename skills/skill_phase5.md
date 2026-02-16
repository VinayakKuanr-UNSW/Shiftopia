---
name: rbac-page-integration
description: Implements Phase 5 page level integration by wiring PersonalScopeFilter and ManagerialScopeFilter into each specific page and defining how scope selections propagate into data queries.
disable-model-invocation: true
allowed-tools: Read, Grep
---

# Phase 5 – Page Integration Skill  
Access Certificate & Global Scope Filtering System

This skill defines how each page integrates:

- PersonalScopeFilter
- ManagerialScopeFilter
- Scope propagation into API queries
- Query enforcement alignment with backend

This is the final wiring layer between UI filtering and backend enforcement.

---

# 1. Core Integration Rule

Each page must:

1. Declare its access mode
2. Mount correct filter wrapper
3. Receive normalized scope object
4. Pass scope to all data fetching hooks
5. Never override permission logic

---

# 2. Page Classification Matrix

## Personal Pages (Type X Scope)

- MyRoster
- MyAvailabilities
- MyBids
- MySwaps
- MyBroadcasts

Use: PersonalScopeFilter

Scope source:
Union of Type X certificates

---

## Managerial Pages (Type Y Scope)

- Templates
- Rosters
- Timesheets
- Open Bids
- Swap Requests
- Users
- Insights
- Broadcasts

Use: ManagerialScopeFilter

Scope source:
Single Type Y certificate

---

# 3. Personal Page Integration

## 3.1 MyRoster

Filter: PersonalScopeFilter

Default:
Select all allowed scope

Data query:

POST /api/rosters/my

Payload:
{
  org_ids,
  dept_ids,
  subdept_ids
}

Query must return:
Only shifts assigned to current user
AND within selected scope

Important:
Scope must narrow results, never expand.

---

## 3.2 MyAvailabilities

Filter: PersonalScopeFilter

Data query:

GET /api/availability/me

Include:
{
  org_ids,
  dept_ids,
  subdept_ids
}

Must filter availability entries by selected scope.

---

## 3.3 MyBids

Filter: PersonalScopeFilter

Query:

GET /api/bids/me

Must enforce:
Only bids by current user
AND within allowed certificate combinations.

---

## 3.4 MySwaps

Filter: PersonalScopeFilter

Query:

GET /api/swaps/me

Scope restricts:
Swap visibility by subdepartment only.

---

## 3.5 MyBroadcasts

Filter: PersonalScopeFilter

Query:

GET /api/broadcasts/personal

Return broadcasts targeted to selected scope.

---

# 4. Managerial Page Integration

## 4.1 Templates

Filter: ManagerialScopeFilter

Query:

GET /api/templates

Scope logic:
Gamma → fixed subdept
Delta → fixed dept
Epsilon → fixed org
Zeta → unrestricted

All queries must apply selected subdept_ids when unlocked.

---

## 4.2 Rosters

Filter: ManagerialScopeFilter

Query:

POST /api/rosters

Scope restricts:
Roster list by selected scope.

If Delta:
Dept fixed
Subdept multi select

If Gamma:
No filter UI needed
Auto apply fixed scope

---

## 4.3 Timesheets

Filter: ManagerialScopeFilter

Additional rule:
If user has Beta only:
Timesheets page accessible read only via PersonalScopeFilter

Managerial behavior:

Gamma → subdept fixed
Delta → dept fixed
Epsilon → org fixed
Zeta → unrestricted

Query:

GET /api/timesheets

Must enforce backend write restrictions.

---

## 4.4 Open Bids

Filter: ManagerialScopeFilter

Query:

GET /api/bids/open

Scope restricts:
Visible bids by hierarchy.

---

## 4.5 Swap Requests

Filter: ManagerialScopeFilter

Query:

GET /api/swaps/managerial

Scope restricts:
Only swaps inside permitted hierarchy.

---

## 4.6 Users

Filter: ManagerialScopeFilter

Query:

GET /api/users

Scope restricts:
Only users belonging to selected org, dept, subdept.

Important:
User certificate editing must validate scope of acting manager.

---

## 4.7 Insights

Filter: ManagerialScopeFilter

Query:

GET /api/insights

Scope restricts:
Aggregations computed only for selected scope.

If Gamma:
Insights limited to single subdept only.

---

## 4.8 Broadcasts (Managerial)

Filter: ManagerialScopeFilter

Query:

GET /api/broadcasts/managerial

Scope restricts:
Broadcast visibility and creation target.

Creation form must:
Auto lock target scope if Gamma or Delta.

---

# 5. Scope Propagation Pattern

Each page must use a shared hook:

useScopedQuery(endpoint, mode)

Where:

mode:
"personal"
"managerial"

Hook must:

1. Consume scope from filter
2. Validate non empty selection
3. Pass structured payload
4. Re fetch when scope changes

---

# 6. Default Scope Behavior

Personal:
Select all allowed certificate combinations.

Managerial:

Zeta:
Select all orgs by default

Epsilon:
Org fixed
Select all depts and subdepts

Delta:
Org and dept fixed
Select all subdepts

Gamma:
No filter selection needed

---

# 7. When to Hide Filter Entirely

Hide filter if:

- Gamma managerial level
- Only one possible scope combination exists

Do not hide for:
Delta or Epsilon
Even if locked partially

---

# 8. State Management Requirements

Filter state must live:

- At page level
- Not global Redux unless shared across tabs

Changing filter must:

- Reset pagination
- Reset sorting
- Trigger refetch

---

# 9. Backend Alignment Checklist per Page

Each page must confirm:

[ ] Correct mode passed  
[ ] Scope object forwarded  
[ ] No local filtering logic bypassing backend  
[ ] All data fetching respects scope  
[ ] Write operations validated server side  

---

# 10. Testing Requirements Per Page

For each page:

Test 1:
Valid scope selection returns expected data

Test 2:
Attempt illegal scope manipulation via devtools rejected

Test 3:
Locked filter cannot be altered

Test 4:
Changing scope updates results

---

# 11. Performance Considerations

For pages with heavy queries:

- Debounce filter change
- Avoid multiple rapid API calls
- Cache last scope result
- Avoid reloading hierarchy tree

---

# 12. Audit Safety

All managerial pages must log:

user_id
selected_scope
action_type

Personal pages log only write operations.

---

# 13. Completion Criteria

Phase 5 complete when:

- Every page declares mode
- Correct filter wrapper mounted
- Scope propagates to all data queries
- No page performs uncontrolled query
- Manual tampering test passes

---

End of Page Integration Skill
