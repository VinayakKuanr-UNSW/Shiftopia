# Codebase Architecture Review & Recommendations

## 1. Executive Summary

The codebase has successfully transitioned to a **Domain-Driven Design (DDD)** or **Feature-Sliced** modular architecture (`src/modules/*`).

The recent refactoring of `planning` and `rosters` modules sets the standard for the application:
-   **Encapsulation:** Logic, UI, Types, and State are co-located by domain.
-   **Scalability:** New features can be added without polluting the global namespace.
-   **Clarity:** It is obvious where specific business logic lives.

Significant progress has been made, but key areas still require standardization.

## 2. Key Findings

### ✅ Strengths
1.  **Modular Core:** `src/modules/rosters` and `src/modules/planning` are reference implementations with clear barrel-file (`index.ts`) boundaries.
2.  **Clean Imports:** Manual refactoring has removed many direct deep imports (e.g., `planning/bidding/api` -> `planning`).
3.  **Platform Abstraction:** `src/platform` correctly isolates cross-cutting technical concerns.

### ⚠️ Areas for Improvement

#### A. Component Library Duplication
There is overlap between:
-   `src/components/ui`: Standard Shadcn/Radix implementation.
-   `src/design-system/components`: Parallel implementation.
**Recommendation:** Standardize on `src/components/ui`.

#### B. The "God" Types File (`src/api/models/types.ts`)
This file acts as a monolithic bucket.
**Recommendation:** Continue dismantling this file. Move `Shift`, `Employee`, and `Organization` types to their respective modules (`rosters`, `users`, `core`).

#### C. Legacy API Layer
`src/api` competes with module-level APIs.
**Recommendation:** Migrate remaining services to their modules and dissolve `src/api`.

#### D. Root Components Clutter
`src/components` contains layouts and feature components mixed with UI primitives.
**Recommendation:** Move layouts to `modules/core/ui` or `modules/layout`.

## 3. Recommended Roadmap

### Phase 1: Standardization (Immediate)
1.  **Consolidate Design System:** Select ONE source of truth (e.g., `src/components/ui`).
2.  **Standardize Module Structure:** Ensure new modules (`dashboard`, `users`) follow the `rosters` pattern.

### Phase 2: Dismantling the Monolith (Short Term)
3.  **Refactor `types.ts`:**
    -   Move `Shift` -> `modules/rosters/model/shift.types.ts`
    -   Move `Employee` -> `modules/users/model/employee.types.ts`
    -   Move `Organization` -> `modules/core/model/org.types.ts`
    -   Delete `src/api/models/types.ts` once empty.
4.  **Dissolve `src/api`:** Move remaining services to modules.

### Phase 3: Cleanup (Medium Term)
5.  **Clean up `src/components`:** Move `AppSidebar`, `Navbar`, `AppLayout` to `src/modules/layout`.

## 4. Ideal Module Structure

```typescript
// src/modules/users/
index.ts           // exports: useUser, UserProfile (component), User (type)
├── model/
│   └── user.types.ts
├── api/
│   └── users.api.ts
├── state/
│   └── useUser.ts
└── ui/
    ├── pages/
    │   └── ProfilePage.tsx
    └── components/
        └── UserAvatar.tsx
```
