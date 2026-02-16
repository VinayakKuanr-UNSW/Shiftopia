# DDD Migration - Phase 4 Plan

**Status:** In Progress
**Objective:** Architectural Cleanup & Refinement

---

## Scope

Based on the Architecture Review Report, Phase 4 addresses:

### 1. Component Library Consolidation ✅ READY
**Issue:** Duplicate components in `src/components/ui` and `src/design-system/components`
**Analysis:** Files are identical (confirmed via diff)
**Action:**
- Migrate 170 files from `@/design-system` → `@/components/ui`
- Delete `src/design-system` folder
- Update ESLint to prevent future design-system imports

### 2. Dismantle Monolithic types.ts 🔄 PARTIAL
**Issue:** `src/api/models/types.ts` acts as a God file
**Current State:** Already partially migrated (BidStatus, SwapStatus re-exported from modules)
**Action:**
- Move remaining types to their owner modules
- Update all imports
- Delete types.ts when empty

### 3. Dissolve Legacy API Layer ⏳ DEFERRED
**Issue:** `src/api` competes with module-level APIs
**Action:** Defer to Phase 5 (requires broader refactoring)

### 4. Layout Component Organization ⏳ DEFERRED
**Issue:** Root components clutter
**Action:** Defer to Phase 5 (lower priority)

---

## Phase 4 Focus

**Primary:** Component library consolidation
**Secondary:** Complete types.ts migration
**Deferred:** API layer dissolution (Phase 5)

---

## Execution Plan

### Step 1: Component Library Consolidation
1. Create migration script for imports
2. Test with small batch (10 files)
3. Migrate all 170 files
4. Delete `src/design-system` folder
5. Update ESLint to block design-system imports
6. Validate build

### Step 2: Types Migration
1. Identify remaining types in types.ts
2. Determine owner module for each type
3. Move types to modules
4. Update imports
5. Delete types.ts if empty

### Step 3: Validation
1. Run full build
2. Run ESLint
3. Run architecture validation
4. Test dev server

---

## Risk Assessment

**Low Risk:**
- Component consolidation (files are identical)
- Automated find-replace for imports

**Medium Risk:**
- Types migration (may have complex dependencies)

**Mitigation:**
- Test build after each major batch
- Keep git history clean for easy rollback
