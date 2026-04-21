import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "scripts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Global rule: Prevent bypassing module public APIs
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/modules/*/api/*",
                "@/modules/*/domain/*",
                "@/modules/*/model/*",
                "@/modules/*/pages/*",
                "@/modules/*/services/*",
                "@/modules/*/state/*",
                "@/modules/*/ui/*",
                "@/modules/*/hooks/*",
                "@/modules/*/infra/*",
                "@/modules/*/utils/*",
                "@/modules/*/engine/*",
                "@/modules/*/rules/*",
                "@modules/*/api/*",
                "@modules/*/domain/*",
                "@modules/*/model/*",
                "@modules/*/pages/*",
                "@modules/*/services/*",
                "@modules/*/state/*",
                "@modules/*/ui/*",
                "@modules/*/hooks/*",
                "@modules/*/infra/*",
                "@modules/*/utils/*",
                "@modules/*/engine/*",
                "@modules/*/rules/*",
              ],
              message: "❌ Module Boundary Violation: Import from the module's public API (index.ts) instead of internal paths.\n\nExample:\n  ❌ import { Shift } from '@/modules/rosters/api/shifts.api'\n  ✅ import { Shift } from '@/modules/rosters'\n\nThis enforces encapsulation and makes refactoring safer.",
            },
            {
              group: [
                "@/design-system/*",
                "@design-system/*",
              ],
              message: "❌ Deprecated Path: design-system has been consolidated into components/ui.\n\nExample:\n  ❌ import { Button } from '@/design-system/components/button'\n  ✅ import { Button } from '@/components/ui/button'\n\nThe design-system folder has been removed in Phase 4.",
            },
          ],
        },
      ],
    },
  },
  // Module-specific rules for preventing cross-module imports
  {
    files: ["src/modules/rosters/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/*",
                "!@/components/ui",
                "@/hooks/*",
                "@/api/*",
                "!@/api/models",
                "@/pages/*",
                "@/modules/*",
                "!@/modules/rosters",
                "!@/modules/compliance",
              ],
              message: "Rosters module violation: Do not import from legacy layers or other modules (except compliance). Use internal module code or shared platform/UI libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/planning/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/*",
                "!@/components/ui",
                "@/hooks/*",
                "@/api/*",
                "!@/api/models",
                "@/pages/*",
                "@/modules/*",
                "!@/modules/planning",
                "!@/modules/rosters",
                "!@/modules/compliance",
              ],
              message: "Planning module violation: Do not import from legacy layers or unauthorized modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/templates/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/*",
                "!@/components/ui",
                "@/hooks/*",
                "@/api/*",
                "@/pages/*",
                "@/modules/*",
                "!@/modules/templates",
                "!@/modules/rosters",
                "!@/modules/compliance",
              ],
              message: "Templates module violation: Do not import from legacy layers or unauthorized modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/timesheets/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/*",
                "!@/components/ui",
                "@/hooks/*",
                "@/api/*",
                "@/pages/*",
                "@/modules/*",
                "!@/modules/timesheets",
                "!@/modules/rosters",
                "!@/modules/compliance",
              ],
              message: "Timesheets module violation: Do not import from legacy layers or unauthorized modules.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["src/design-system/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/*",
                "!@/components/ui",
                "@/hooks/*",
                "@/api/*",
                "@/pages/*",
                "@/modules/*",
              ],
              message: "Design System violation: Design system components must be pure and cannot import from business logic layers.",
            },
          ],
        },
      ],
    },
  }
);
