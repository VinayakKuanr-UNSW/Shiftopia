# ADR-001: Modular Frontend Architecture

## Status
Proposed

## Context
The application has grown significantly, leading to a "tangled web" of dependencies where business logic, UI components, and API services are scattered across the codebase. This makes it difficult to reason about the application, leads to high risk during refactoring, and slows down development.

## Decision
We will adopt a modular "Atlassian-style" frontend architecture. This architecture enforces strict boundaries between different parts of the application.

### Key Principles
1.  **Domain Modules (`src/modules/*`)**:
    *   All domain-specific logic, types, API services, and UI components must live within their respective module.
    *   Modules are self-contained.
    *   Modules must not import from other modules directly.
    *   Public API for a module is defined in its `index.ts`.

2.  **Shared UI (`src/design-system/*`)**:
    *   Pure UI components (e.g., buttons, inputs, modals) live here.
    *   They must be agnostic of any business logic or domain data.
    *   They must not import anything outside of the design system itself (except for basic utilities like `cn`).

3.  **Platform Services (`src/platform/*`)**:
    *   Cross-cutting technical services like Authentication, Database/Supabase client, and global state providers live here.
    *   These are used by modules to perform infrastructure-level tasks.

4.  **Pages (`src/pages/*`)**:
    *   Pages are primarily for routing and layout.
    *   They compose components from modules and the design system.
    *   Pages should not own complex business logic.

### Dependency Rules
*   `pages` → `modules` → `platform`
*   `pages` → `design-system`
*   `modules` → `platform`
*   `modules` ✖ `modules` (Strictly forbidden)
*   `components` ✖ `modules` (Strictly forbidden)

## Consequences
*   **Improved Maintainability**: Clearer structure makes it easier to find and update code.
*   **Scalability**: New features can be added as isolated modules without affecting existing ones.
*   *Separation of Concerns**: UI is separated from logic, and domains are separated from each other.
*   **Initial Overhead**: Migrating existing code requires effort and discipline.
