/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-imports',
      comment:
        'Modules should not import from other modules directly (except allowed dependencies)',
      severity: 'error',
      from: {
        path: '^src/modules/([^/]+)',
        pathNot: '^src/modules/(rosters|planning|templates|timesheets|audit)/.*$',
      },
      to: {
        path: '^src/modules/([^/]+)',
        pathNot: [
          '^src/modules/compliance', // Compliance is a utility module
        ],
      },
    },
    {
      name: 'no-bypass-module-public-api',
      comment:
        'Do not import from module internals - use the public API (index.ts)',
      severity: 'error',
      from: {
        pathNot: '^src/modules/([^/]+)',
      },
      to: {
        path: '^src/modules/[^/]+/(api|domain|model|pages|services|state|ui|hooks|infra|utils|engine|rules)/',
      },
    },
    {
      name: 'rosters-allowed-dependencies',
      comment: 'Rosters module can only import from compliance',
      severity: 'error',
      from: {
        path: '^src/modules/rosters',
      },
      to: {
        path: '^src/modules/([^/]+)',
        pathNot: [
          '^src/modules/rosters',
          '^src/modules/compliance',
        ],
      },
    },
    {
      name: 'planning-allowed-dependencies',
      comment: 'Planning module can import from rosters and compliance',
      severity: 'error',
      from: {
        path: '^src/modules/planning',
      },
      to: {
        path: '^src/modules/([^/]+)',
        pathNot: [
          '^src/modules/planning',
          '^src/modules/rosters',
          '^src/modules/compliance',
        ],
      },
    },
    {
      name: 'templates-allowed-dependencies',
      comment: 'Templates module can import from rosters and compliance',
      severity: 'error',
      from: {
        path: '^src/modules/templates',
      },
      to: {
        path: '^src/modules/([^/]+)',
        pathNot: [
          '^src/modules/templates',
          '^src/modules/rosters',
          '^src/modules/compliance',
        ],
      },
    },
    {
      name: 'timesheets-allowed-dependencies',
      comment: 'Timesheets module can import from rosters and compliance',
      severity: 'error',
      from: {
        path: '^src/modules/timesheets',
      },
      to: {
        path: '^src/modules/([^/]+)',
        pathNot: [
          '^src/modules/timesheets',
          '^src/modules/rosters',
          '^src/modules/compliance',
        ],
      },
    },
    {
      name: 'audit-allowed-dependencies',
      comment: 'Audit module can import from timesheets and rosters',
      severity: 'error',
      from: {
        path: '^src/modules/audit',
      },
      to: {
        path: '^src/modules/([^/]+)',
        pathNot: [
          '^src/modules/audit',
          '^src/modules/timesheets',
          '^src/modules/rosters',
        ],
      },
    },
    {
      name: 'design-system-no-business-logic',
      comment: 'Design system must not import from business logic layers',
      severity: 'error',
      from: {
        path: '^src/design-system',
      },
      to: {
        path: [
          '^src/modules/',
          '^src/api/',
          '^src/hooks/',
          '^src/pages/',
        ],
      },
    },
    {
      name: 'no-circular-dependencies',
      comment: 'Circular dependencies are not allowed',
      severity: 'warn',
      from: {},
      to: {
        circular: true,
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+',
      },
      archi: {
        collapsePattern: '^src/modules/[^/]+|^src/[^/]+',
      },
      text: {
        highlightFocused: true,
      },
    },
  },
};
