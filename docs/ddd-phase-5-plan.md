# DDD Migration - Phase 5 Execution Plan

**Status:** In Progress
**Objective:** Complete Architectural Refinement per Architecture Reviews

---

## Scope

Based on both architecture review documents, Phase 5 addresses:

### From Architecture Refactor Review

1. ✅ **Design System Consolidation** - COMPLETED in Phase 4
2. ✅ **Strict Module Boundaries** - COMPLETED in Phases 2-3
3. ⏳ **Type Migration** - PRIMARY FOCUS for Phase 5
4. ⏳ **Router Placement** - SECONDARY FOCUS for Phase 5

### From Architecture Review Report

1. ✅ **Component Library Duplication** - COMPLETED in Phase 4
2. ⏳ **Dismantle types.ts** - PRIMARY FOCUS for Phase 5
3. ⏳ **Dissolve src/api** - TERTIARY FOCUS for Phase 5
4. ⏳ **Layout Component Organization** - TERTIARY FOCUS for Phase 5

---

## Phase 5 Priorities

### Priority 1: Types Migration (HIGH) 🔴
**Objective:** Break down monolithic `src/api/models/types.ts` into module-specific type files

**Current State:**
- 475 lines in single file
- Mix of domain types (Shift, Employee, Organization, Template, Broadcast)
- Some types already re-exported from modules (planning, timesheets)

**Target State:**
- Each module owns its types
- types.ts deleted or minimal re-exports only
- Clear type ownership

**Migration Plan:**

1. **Shift Types → rosters module**
   - `Shift`, `LifecycleStatus`, `ShiftFlag`, `LifecycleConfig`
   - `LIFECYCLE_CONFIGS`, `SHIFT_FLAG_CONFIGS` constants
   - ~160 lines

2. **Employee Types → users module**
   - `Employee`, `UserContract`, `AccessLevel`, `ContractStatus`
   - ~60 lines

3. **Organization Types → platform or core module**
   - `Organization`, `Department`, `SubDepartment`, `Role`, `RemunerationLevel`
   - ~80 lines

4. **Template Types → templates module**
   - `Template`, `TemplateShift`, `Group`, `SubGroup`
   - ~80 lines

5. **Broadcast Types → broadcasts module**
   - `BroadcastGroup`, `BroadcastMessage`, `BroadcastChannel`, etc.
   - ~95 lines

**Risk:** MEDIUM (many imports to update)
**Impact:** HIGH (cleanest architecture)

---

### Priority 2: Router Relocation (MEDIUM) 🟡
**Objective:** Move AppRouter from `src/components` to proper location

**Current State:**
- `src/components/AppRouter.tsx` - 500+ lines

**Options:**
1. `src/router/AppRouter.tsx` - Top-level router directory
2. `src/modules/core/router/AppRouter.tsx` - Within core module

**Recommendation:** Option 1 (`src/router/`)
- Clearer separation from UI components
- Standard practice in many React apps
- Easy to find

**Risk:** LOW (single file move + import updates)
**Impact:** MEDIUM (clearer architecture)

---

### Priority 3: API Layer Cleanup (MEDIUM) 🟡
**Objective:** Migrate remaining `src/api` services to modules

**Current State:**
```
src/api/
├── models/
│   ├── types.ts (to be migrated in Priority 1)
│   └── broadcastTypes.ts (re-exports from broadcasts module)
└── ... (other legacy services)
```

**Action:**
- Evaluate remaining files in `src/api`
- Migrate to appropriate modules
- Delete empty api folder

**Risk:** MEDIUM (depends on remaining services)
**Impact:** MEDIUM (cleaner structure)

---

### Priority 4: Layout Components (LOW) 🟢
**Objective:** Move layout components from `src/components` to modules

**Current State:**
- `AppSidebar.tsx`, `Navbar.tsx`, `AppLayout.tsx` in `src/components`

**Options:**
1. Create `src/modules/layout` module
2. Move to `src/modules/core/ui/layout`

**Recommendation:** Defer or make minimal
- Current location is acceptable
- Lower impact on architecture
- Can be addressed later if needed

**Risk:** LOW
**Impact:** LOW

---

## Execution Strategy

### Phase 5A: Types Migration (Week 1)
1. Create type files in each module
2. Move types incrementally (one module at a time)
3. Update imports module by module
4. Test build after each module
5. Delete or minimize types.ts

### Phase 5B: Router & API Cleanup (Week 2)
1. Move AppRouter to src/router
2. Update imports
3. Evaluate src/api
4. Migrate remaining services
5. Clean up api folder

### Phase 5C: Validation & Documentation (Week 2)
1. Full build validation
2. Architecture validation
3. Update documentation
4. Create Phase 5 summary

---

## Risk Mitigation

**High Risk Items:**
- Types migration (many imports)

**Mitigation:**
- Migrate one module at a time
- Test build after each migration
- Keep git history clean for rollback
- Use find-replace carefully

**Medium Risk Items:**
- API layer cleanup (unknown services)

**Mitigation:**
- Review before migrating
- Document each service's purpose
- Verify no breaking changes

---

## Success Criteria

- [ ] All types migrated to owner modules
- [ ] types.ts deleted or minimal
- [ ] AppRouter in src/router
- [ ] src/api cleaned up or removed
- [ ] Build successful
- [ ] Architecture validation passing
- [ ] Documentation complete

---

## Timeline

**Estimated:** 1-2 weeks
- Phase 5A: 3-5 days (types migration)
- Phase 5B: 2-3 days (router + api)
- Phase 5C: 1 day (validation + docs)

---

## Out of Scope

- Major feature work
- UI redesign
- Performance optimization
- Test coverage improvements

These can be addressed in future work.
