# Architecture Overview

## System Summary

ShiftoPia is a workforce management application built with React (frontend) and Supabase (backend). It enables shift scheduling, bidding, swaps, timesheets, and broadcast communications.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| UI | Tailwind CSS, Radix UI, Shadcn |
| State | TanStack Query (React Query) |
| Backend | Supabase (Postgres + Auth + Storage) |
| Edge Functions | Deno (lifecycle automation) |

## Domain Modules

```
src/modules/
├── availability/   # Employee availability management
├── broadcasts/     # Announcements and notifications
├── insights/       # Analytics and reporting
├── planning/       # Bids and swap requests
├── rosters/        # Shift scheduling and management
├── templates/      # Shift templates
└── timesheets/     # Time tracking and payroll
```

## Module Ownership

| Module | Domain | Write Paths | Owner |
|--------|--------|-------------|-------|
| rosters | Shifts | shifts table | Roster Team |
| planning | Bids/Swaps | shift_bids, swap_requests | Planning Team |
| broadcasts | Comms | broadcasts, broadcast_reads | Comms Team |
| timesheets | Payroll | timesheets, timesheet_approval | Payroll Team |
| templates | Config | shift_templates | Roster Team |
| insights | Analytics | read-only | Analytics Team |
| availability | HR | availabilities | HR Team |

## Lifecycle Flows

### Shift Lifecycle
```
draft → scheduled → active → completed
                  ↘ cancelled
```

### Bid Lifecycle
```
pending → approved → confirmed
        ↘ rejected
```

### Swap Lifecycle
```
pending → approved → executed
        ↘ rejected
```

## Key Files

| File | Purpose |
|------|---------|
| `src/platform/realtime/client.ts` | Supabase client with auth |
| `src/platform/auth/AuthProvider.tsx` | Authentication context |
| `supabase/functions/shift-lifecycle-updater/` | Auto-progression edge function |
| `src/components/AppRouter.tsx` | Route definitions |

## Security Model

- **RLS**: All tables have Row Level Security enabled
- **Auth**: Supabase Auth with role-based access
- **Frontend**: Permissions checked via `hasPermission()` hook
- **Backend**: Always enforces permissions, frontend is convenience only
