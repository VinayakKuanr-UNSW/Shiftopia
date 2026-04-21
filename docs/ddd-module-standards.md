# DDD Module Standards

## Overview

This document defines the standardized folder structure for all modules in the ShiftoPia application. The structure follows Domain-Driven Design (DDD) principles while respecting different levels of module complexity.

## Module Types & Structure

### 1. Simple Module (Page-Focused)

**Used for:** auth, core, dashboard, search, settings, users, configurations, contracts

**Structure:**
```
module-name/
├── pages/           # Page components
│   └── *.tsx
├── types/           # Optional: Module-specific types
│   └── *.ts
└── index.ts         # Public API exports
```

**Characteristics:**
- Minimal business logic
- Primarily routing and layout
- May have simple types
- Exports pages only

**Example `index.ts`:**
```typescript
export { default as LoginPage } from './pages/LoginPage';
export { default as UnauthorizedPage } from './pages/UnauthorizedPage';
```

---

### 2. Feature Module (Standard)

**Used for:** availability, insights, broadcasts, templates, timesheets

**Structure:**
```
module-name/
├── api/             # External API calls and data fetching
│   ├── *.api.ts
│   ├── *.queries.ts
│   └── *.commands.ts
├── model/           # Domain types, interfaces, DTOs
│   └── *.types.ts
├── pages/           # Page components
│   └── *.tsx
├── state/           # State management (hooks, context, stores)
│   ├── use*.ts
│   └── *Context.tsx
├── ui/              # UI components and views
│   ├── components/  # Reusable components
│   ├── dialogs/     # Modal dialogs
│   └── views/       # Complex view components
├── hooks/           # Optional: Module-specific custom hooks
│   └── use*.ts
├── utils/           # Optional: Module utilities
│   └── *.utils.ts
└── index.ts         # Public API exports
```

**Characteristics:**
- Complete feature implementation
- Rich state management
- Reusable components
- Clear API/Model separation

**Example `index.ts`:**
```typescript
// API Layer
export * from './api/feature.api';

// Domain Models
export * from './model/feature.types';

// State Management
export * from './state/useFeature';
export * from './state/FeatureContext';

// UI Components (selectively)
export { FeatureTable } from './ui/components/FeatureTable';
export { FeatureModal } from './ui/dialogs/FeatureModal';

// Pages
export { default as FeaturePage } from './pages/FeaturePage';
```

---

### 3. Domain Module (DDD/CQRS)

**Used for:** rosters (and future complex domains)

**Structure:**
```
module-name/
├── domain/          # Core domain logic (DDD)
│   ├── commands/    # Write operations
│   ├── queries/     # Read operations
│   ├── policies/    # Business rules and policies
│   ├── entities/    # Domain entities
│   └── *.entity.ts  # Entity definitions
├── api/             # External API integration
│   ├── *.queries.ts
│   └── *.commands.ts
├── infra/           # Infrastructure layer
│   ├── repositories/
│   └── *.repo.ts
├── model/           # DTOs and types
│   └── *.types.ts
├── services/        # Application services
│   └── *.service.ts
├── pages/           # Page components
│   └── *.tsx
├── state/           # State management
│   └── use*.ts
├── ui/              # UI layer
│   ├── components/
│   ├── dialogs/
│   ├── modes/       # Different view modes
│   └── views/       # Calendar views, grids, etc.
├── hooks/           # Module-specific hooks
│   └── use*.ts
└── index.ts         # Public API exports
```

**Characteristics:**
- Complex business logic
- CQRS pattern (command/query separation)
- Domain entities and policies
- Repository pattern for data access
- Rich domain model

**Example `index.ts`:**
```typescript
// Domain Commands
export * from './domain/commands/createEntity';
export * from './domain/commands/updateEntity';

// Domain Queries
export * from './domain/queries/getEntityDetails';

// Domain Policies
export * from './domain/policies/canEditEntity';

// State
export * from './state/useEntities';

// Pages
export { default as EntityPlannerPage } from './pages/EntityPlannerPage';
```

---

### 4. Container Module (Multi-Feature)

**Used for:** planning (and future multi-feature modules)

**Structure:**
```
module-name/
├── feature-a/       # Sub-module A
│   ├── api/
│   ├── model/
│   ├── state/
│   ├── ui/
│   └── index.ts     # Feature A public API
├── feature-b/       # Sub-module B
│   ├── api/
│   ├── model/
│   ├── state/
│   ├── ui/
│   └── index.ts     # Feature B public API
└── index.ts         # Re-exports from sub-modules
```

**Characteristics:**
- Logically related features
- Each sub-module is autonomous
- Parent module aggregates exports
- Clear feature boundaries

**Example parent `index.ts`:**
```typescript
// Re-export from feature-a
export * from './feature-a';

// Re-export from feature-b
export * from './feature-b';

// Optional: Shared types
export * from './shared.types';
```

---

### 5. Specialized Module (Rules Engine, Services)

**Used for:** compliance (and future specialized logic)

**Structure:**
```
module-name/
├── api/             # External API
│   └── *.api.ts
├── rules/           # Business rules (for rules engine)
│   └── *.rule.ts
├── engine/          # Core engine logic
│   ├── engine.ts
│   ├── types.ts
│   └── utils.ts
├── hooks/           # Hooks for engine usage
│   └── use*.ts
├── ui/              # Optional: UI components
│   └── components/
└── index.ts         # Public API exports
```

**Characteristics:**
- Specialized business logic
- Rule-based or algorithmic processing
- Focused on computation/validation
- Reusable across multiple modules

**Example `index.ts`:**
```typescript
// Core Engine
export * from './engine/engine';
export * from './engine/types';
export * from './engine/utils';

// Rules
export * from './rules/rule-a';
export * from './rules/rule-b';

// Hooks
export * from './hooks/useEngine';

// API
export * from './api/engine.api';
```

---

## Dependency Rules (ADR-001)

**Allowed:**
- `pages` → `modules` → `platform`
- `pages` → `design-system`
- `modules` → `platform`
- `modules` → `design-system`

**Strictly Forbidden:**
- `modules` ✖ `modules` (cross-module imports)
- `design-system` ✖ `modules`

**Enforcement:**
- All module imports must go through `index.ts` (public API)
- Internal module structure is private
- Use ESLint rules to enforce boundaries

---

## Public API Guidelines (`index.ts`)

### What to Export
1. **Types/Interfaces** - All public domain types
2. **API functions** - Data fetching and mutation functions
3. **Hooks** - State management hooks, custom hooks
4. **Components** - Reusable UI components (selectively)
5. **Pages** - Top-level page components
6. **Context Providers** - State providers
7. **Utilities** - Shared utility functions (if needed)

### What NOT to Export
1. Internal implementation details
2. Private helper functions
3. Component sub-parts (unless explicitly reusable)
4. Internal constants
5. Test utilities

### Export Patterns

**Prefer named exports:**
```typescript
export { FeatureTable } from './ui/components/FeatureTable';
export { useFeature } from './state/useFeature';
```

**Use wildcard for types:**
```typescript
export * from './model/feature.types';
```

**Default exports for pages:**
```typescript
export { default as FeaturePage } from './pages/FeaturePage';
```

---

## File Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Components | PascalCase.tsx | `UserTable.tsx` |
| Pages | PascalCase + Page.tsx | `DashboardPage.tsx` |
| Hooks | camelCase + use prefix | `useAuth.ts` |
| Types | kebab-case + .types | `user.types.ts` |
| API | kebab-case + .api | `users.api.ts` |
| Utils | kebab-case + .utils | `date.utils.ts` |
| Services | kebab-case + .service | `auth.service.ts` |
| Context | PascalCase + Context | `AuthContext.tsx` |
| Commands | camelCase + .command | `createUser.command.ts` |
| Queries | camelCase + .query | `getUser.query.ts` |
| Policies | camelCase + .policy | `canEditUser.policy.ts` |

---

## Migration Strategy

### Phase 1: Standardize Structure (Current)
1. Create missing directories for each module type
2. Move files to appropriate directories
3. Create `index.ts` for all modules
4. Update imports to use public APIs

### Phase 2: Enforce Boundaries
1. Add ESLint rules for module boundaries
2. Configure path aliases
3. Set up architectural testing

### Phase 3: Documentation
1. Add README.md to each major module
2. Document domain concepts
3. Create developer guidelines

---

## Examples by Module

### Simple Module: `auth`
```
auth/
├── pages/
│   ├── LoginPage.tsx
│   └── UnauthorizedPage.tsx
├── types/
│   └── auth.types.ts        # Optional
└── index.ts
```

### Feature Module: `broadcasts`
```
broadcasts/
├── api/
│   └── broadcasts.api.ts
├── model/
│   └── broadcast.types.ts
├── pages/
│   ├── BroadcastsManagerPage.tsx
│   └── MyBroadcastsPage.tsx
├── state/
│   └── useBroadcasts.ts
├── ui/
│   ├── components/
│   │   ├── BroadcastItem.tsx
│   │   └── ComposeSection.tsx
│   ├── dialogs/
│   │   └── CreateGroupDialog.tsx
│   └── views/
│       └── ControlRoom.tsx
└── index.ts
```

### Domain Module: `rosters`
```
rosters/
├── domain/
│   ├── commands/
│   │   ├── createShift.ts
│   │   └── assignShift.ts
│   ├── queries/
│   │   └── getShiftDetails.ts
│   ├── policies/
│   │   └── canEditShift.ts
│   └── shift.entity.ts
├── api/
│   ├── shifts.queries.ts
│   └── shifts.commands.ts
├── infra/
│   └── shifts.repo.ts
├── model/
│   └── roster.types.ts
├── services/
│   └── compliance.service.ts
├── pages/
│   └── RostersPlannerPage.tsx
├── state/
│   └── useRosters.ts
├── ui/
│   ├── components/
│   ├── dialogs/
│   ├── modes/
│   └── views/
├── hooks/
│   └── useResolvedAvailability.ts
└── index.ts
```

### Container Module: `planning`
```
planning/
├── bidding/
│   ├── api/
│   ├── model/
│   ├── state/
│   ├── ui/
│   └── index.ts
├── swapping/
│   ├── api/
│   ├── model/
│   ├── state/
│   ├── ui/
│   └── index.ts
└── index.ts              # Aggregates bidding + swapping
```

### Specialized Module: `compliance`
```
compliance/
├── api/
│   └── compliance.api.ts
├── engine/
│   ├── engine.ts
│   ├── types.ts
│   ├── utils.ts
│   ├── bulk-engine.ts
│   └── prevalidation.ts
├── rules/
│   ├── max-daily-hours.ts
│   ├── min-rest-gap.ts
│   └── student-visa-48h.ts
├── hooks/
│   └── useCompliance.ts
├── ui/
│   └── components/
│       ├── ComplianceBadge.tsx
│       └── ComplianceModal.tsx
└── index.ts
```

---

## Next Steps

1. ✅ Define standard structures (this document)
2. ⏳ Apply structure to all modules
3. ⏳ Create index.ts for all modules
4. ⏳ Update imports to use public APIs
5. ⏳ Add ESLint enforcement rules
6. ⏳ Document domain concepts in each module

---

## References

- [ADR-001: Modular Frontend Architecture](./adr/ADR-001-modular-frontend.md)
- [Architecture Overview](./architecture-overview.md)
