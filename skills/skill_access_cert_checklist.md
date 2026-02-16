---
name: rbac-production-readiness
description: Validates production readiness of the Access Certificate, RBAC, and Global Scope Filtering system across backend, frontend, database, security, performance, and observability.
disable-model-invocation: true
---

# RBAC & Scope Filtering Production Readiness Checklist

Use this checklist before releasing Access Certificate and GlobalScopeFilter to production.

---

# 1. Database Readiness

[ ] Unique partial index enforcing single Type Y per user  
[ ] Foreign key constraints on org, dept, subdept  
[ ] Indexes on org_id, dept_id, subdept_id  
[ ] Soft delete strategy for certificates  
[ ] Migration tested in staging  
[ ] No nullable violations for required certificate levels  

---

# 2. Backend Enforcement

[ ] Permission resolver implemented  
[ ] Scope middleware applied to all protected routes  
[ ] No endpoint bypasses permission dependency  
[ ] Scope validation returns 403 on violation  
[ ] Timesheet read only logic enforced for Beta  
[ ] Write operations restricted by level  
[ ] Certificate creation validation complete  

---

# 3. Security Validation

[ ] Frontend manipulation cannot expand scope  
[ ] Direct API calls cannot bypass filtering  
[ ] No raw SQL without scope injection  
[ ] Logging enabled for unauthorized attempts  
[ ] Error messages do not leak permission details  
[ ] JWT auth verified before permission resolution  

---

# 4. Frontend Validation

[ ] GlobalScopeFilter renders correctly for all levels  
[ ] Locked controls cannot be edited  
[ ] Multi select works for union of Type X  
[ ] Gamma hides or locks full filter  
[ ] Invalid selection cannot be emitted  
[ ] Permission API failure blocks page  

---

# 5. Performance

[ ] Permission object cached per request  
[ ] Allowed scope tree optimized  
[ ] No full hierarchy fetch for restricted users  
[ ] Query execution under performance target  
[ ] OR union queries benchmarked  

---

# 6. Observability

[ ] Scope violations logged with user_id  
[ ] Certificate modifications logged  
[ ] High privilege users monitored  
[ ] Metrics for permission errors  
[ ] Dashboard for authorization failures  

---

# 7. Edge Case Verification

[ ] User with only Type X  
[ ] User with only Type Y  
[ ] User with Gamma and Beta in different org  
[ ] Department deletion handling  
[ ] Certificate invalidation on hierarchy change  

---

# 8. Rollback Strategy

[ ] Migration rollback plan defined  
[ ] Feature flag available  
[ ] Ability to disable GlobalScopeFilter  

---

# 9. Final Go Live Criteria

System passes:

- Security audit
- Performance benchmarks
- Manual scope tampering tests
- Regression tests

---

End of Production Readiness Checklist
