import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Clock,
  Users,
  Workflow,
  CalendarDays,
  FileSpreadsheet,
  BellRing,
  BadgeCheck,
  RefreshCw,
  TrendingUp,
  User,
  Shield,
  ShieldX,
  Sparkles,
  Radio,
  LucideIcon,
  Activity,
  Palmtree,
  Wallet,
  Grid3x3,
  Settings,
  Fingerprint,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/modules/core/ui/primitives/command';
import { cn } from '@/modules/core/lib/utils';
import { useAuth } from '@/platform/auth/useAuth';
import { usePersona } from '@/platform/auth/PersonaProvider';
import { prefetchRouteChunk } from '@/router/routePrefetch';

export interface SearchPageItem {
  id: string;
  title: string;
  description: string;
  path: string;
  icon: LucideIcon;
  section: string;
  permission?: string;
  persona?: 'employee' | 'employer' | 'admin' | 'all';
}

interface QuickSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const QuickSearchDialog: React.FC<QuickSearchDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { persona } = usePersona();

  // Listen for Cmd+K and Cmd+S globally
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  // Master catalog of all navigable pages in Shiftopia
  const allPages: SearchPageItem[] = useMemo(() => [
    // Employee: Work
    {
      id: 'my-roster',
      title: 'My Roster',
      description: 'Your assigned shifts and schedule',
      path: '/my-roster',
      icon: Calendar,
      section: 'Work',
      persona: 'employee',
    },
    {
      id: 'my-attendance',
      title: 'Clock In / Out',
      description: 'Digital time clock and attendance logs',
      path: '/my-attendance',
      icon: Fingerprint,
      section: 'Work',
      persona: 'employee',
    },
    {
      id: 'my-availabilities',
      title: 'My Availabilities',
      description: 'Recurring and specific schedule availability',
      path: '/my-availabilities',
      icon: CalendarDays,
      section: 'Work',
      persona: 'employee',
    },

    // Employee: Requests
    {
      id: 'my-bids',
      title: 'My Bids',
      description: 'Open shift bidding and application history',
      path: '/my-bids',
      icon: BadgeCheck,
      section: 'Requests',
      persona: 'employee',
    },
    {
      id: 'my-swaps',
      title: 'My Swaps',
      description: 'Shift trade and swap requests',
      path: '/my-swaps',
      icon: RefreshCw,
      section: 'Requests',
      persona: 'employee',
    },
    {
      id: 'my-leave',
      title: 'My Leave',
      description: 'Leave balances and time-off requests',
      path: '/my-leave',
      icon: Palmtree,
      section: 'Requests',
      persona: 'employee',
    },

    // Employee: Communication
    {
      id: 'my-broadcasts',
      title: 'My Broadcasts',
      description: 'Company announcements and channel messages',
      path: '/my-broadcasts',
      icon: Radio,
      section: 'Communication',
      persona: 'employee',
    },
    {
      id: 'performance',
      title: 'Performance',
      description: 'Attendance metrics, bids, swaps, and reliability',
      path: '/performance',
      icon: TrendingUp,
      section: 'Communication',
      persona: 'employee',
    },

    // Employer: Rostering
    {
      id: 'rosters',
      title: 'Rosters Planner',
      description: 'Interactive roster grid and scheduling',
      path: '/rosters',
      icon: FileSpreadsheet,
      section: 'Rostering',
      persona: 'employer',
      permission: 'rosters',
    },
    {
      id: 'templates',
      title: 'Shift Templates',
      description: 'Reusable shift patterns and templates',
      path: '/templates',
      icon: Workflow,
      section: 'Rostering',
      persona: 'employer',
      permission: 'templates',
    },
    {
      id: 'timesheet',
      title: 'Timesheets',
      description: 'Employee time tracking and verification',
      path: '/timesheet',
      icon: Clock,
      section: 'Rostering',
      persona: 'employer',
      permission: 'timesheet-view',
    },

    // Employer: Management
    {
      id: 'management-bids',
      title: 'Open Bids Management',
      description: 'Review and award employee shift bids',
      path: '/management/bids',
      icon: BadgeCheck,
      section: 'Management',
      persona: 'employer',
      permission: 'management',
    },
    {
      id: 'management-swaps',
      title: 'Swap Approvals',
      description: 'Review and approve peer shift swaps',
      path: '/management/swaps',
      icon: RefreshCw,
      section: 'Management',
      persona: 'employer',
      permission: 'management',
    },
    {
      id: 'team-grid',
      title: 'Team Availability Grid',
      description: 'Real-time employee hours, compliance, and availability',
      path: '/team-availability',
      icon: Grid3x3,
      section: 'Management',
      persona: 'employer',
      permission: 'management',
    },
    {
      id: 'management-leave',
      title: 'Leave Approvals',
      description: 'Approve or decline staff leave applications',
      path: '/management/leave',
      icon: Palmtree,
      section: 'Management',
      persona: 'employer',
      permission: 'management',
    },
    {
      id: 'management-payroll',
      title: 'Gross Pay & Payroll',
      description: 'Itemised award-compliant gross earnings report',
      path: '/management/payroll',
      icon: Wallet,
      section: 'Management',
      persona: 'employer',
      permission: 'management',
    },

    // Employer: Features
    {
      id: 'broadcast',
      title: 'Broadcasts Hub',
      description: 'Send instant notifications and group announcements',
      path: '/broadcast',
      icon: BellRing,
      section: 'Features',
      persona: 'employer',
      permission: 'broadcast',
    },
    {
      id: 'insights',
      title: 'Workforce Insights',
      description: 'Executive analytics, attendance, and compliance metrics',
      path: '/insights',
      icon: Sparkles,
      section: 'Features',
      persona: 'employer',
      permission: 'insights',
    },

    // Admin
    {
      id: 'labor-demand',
      title: 'Labor Demand Forecasting',
      description: 'AI-driven event staffing and workload planning',
      path: '/labor-demand',
      icon: Activity,
      section: 'Admin',
      persona: 'admin',
      permission: 'labor-demand',
    },
    {
      id: 'users',
      title: 'User Management',
      description: 'Manage staff accounts, contracts, and roles',
      path: '/users',
      icon: Users,
      section: 'Admin',
      persona: 'admin',
      permission: 'users',
    },
    {
      id: 'compliance-rejections',
      title: 'Compliance Rejections Audit',
      description: 'Audit log of blocked scheduling operations',
      path: '/compliance/rejections',
      icon: ShieldX,
      section: 'Admin',
      persona: 'admin',
      permission: 'compliance',
    },

    // Shared Workspace
    {
      id: 'notifications',
      title: 'Notifications',
      description: 'Workspace alerts, updates, and reminders',
      path: '/my-notifications',
      icon: BellRing,
      section: 'Workspace',
      persona: 'all',
    },
    {
      id: 'profile',
      title: 'My Profile',
      description: 'Personal details and credentials',
      path: '/profile',
      icon: User,
      section: 'Workspace',
      persona: 'all',
    },
    {
      id: 'settings',
      title: 'Settings',
      description: 'Application and notification preferences',
      path: '/settings',
      icon: Settings,
      section: 'Workspace',
      persona: 'all',
    },
  ], []);

  // Filter pages by current persona and permissions
  const filteredPages = useMemo(() => {
    return allPages.filter((item) => {
      // Persona check
      if (item.persona && item.persona !== 'all') {
        if (persona === 'admin' && item.persona !== 'admin') {
          // Admin can see employer pages too if permitted
          if (item.persona !== 'employer') return false;
        } else if (item.persona !== persona) {
          return false;
        }
      }

      // Permission check
      if (item.permission && !hasPermission(item.permission)) {
        return false;
      }

      return true;
    });
  }, [allPages, persona, hasPermission]);

  // Group by section
  const groupedPages = useMemo(() => {
    const groups: Record<string, SearchPageItem[]> = {};
    for (const page of filteredPages) {
      if (!groups[page.section]) {
        groups[page.section] = [];
      }
      groups[page.section].push(page);
    }
    return groups;
  }, [filteredPages]);

  const handleSelect = (path: string) => {
    prefetchRouteChunk(path);
    navigate(path);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        size="lg"
        className="border-none shadow-none p-0 bg-transparent overflow-visible gap-0"
      >
        <DialogTitle className="sr-only">Quick Search Navigation</DialogTitle>
        <DialogDescription className="sr-only">
          Search pages or jump to route
        </DialogDescription>
        <Command className="bg-transparent overflow-visible w-full outline-none">
          <div className="flex flex-col gap-1.5 w-full">
            {/* Search Bar Container — Global Scope Style */}
            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-4">
              <CommandInput
                placeholder="Search pages or jump to route..."
                className="h-12 text-[14px] md:h-14 md:text-[15px] border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                autoFocus
              />
            </div>

            {/* Results Container — Global Scope Style */}
            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
              <CommandList className="max-h-[380px] p-1.5 scrollbar-thin scrollbar-thumb-muted-foreground/30 hover:scrollbar-thumb-muted-foreground/50 overflow-y-auto overflow-x-hidden">
                <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-[13px]">
                  No matching pages found.
                </CommandEmpty>

                {Object.entries(groupedPages).map(([section, items]) => (
                  <CommandGroup
                    key={section}
                    heading={section}
                    className="px-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-black [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60"
                  >
                    {items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <CommandItem
                          key={item.id}
                          value={`${item.title} ${item.description} ${item.path}`}
                          onSelect={() => handleSelect(item.path)}
                          className={cn(
                            "flex items-center gap-3 px-3.5 py-2.5 rounded-xl mb-1 cursor-pointer transition-all",
                            "data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground aria-selected:bg-primary aria-selected:text-primary-foreground group"
                          )}
                        >
                          <div className="h-8 w-8 rounded-lg bg-muted/60 group-data-[selected=true]:bg-white/20 group-aria-selected:bg-white/20 flex items-center justify-center shrink-0 text-muted-foreground group-data-[selected=true]:text-white group-aria-selected:text-white transition-colors">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <span className="font-semibold text-[13px] sm:text-[14px] truncate block text-foreground group-data-[selected=true]:text-primary-foreground group-aria-selected:text-primary-foreground">
                              {item.title}
                            </span>
                            <span className="text-[11px] text-muted-foreground group-data-[selected=true]:text-primary-foreground/80 group-aria-selected:text-primary-foreground/80 truncate block">
                              {item.description}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-muted-foreground/70 group-data-[selected=true]:text-primary-foreground/70 group-aria-selected:text-primary-foreground/70 shrink-0 mr-1">
                            {item.path}
                          </span>
                          <CommandShortcut className="group-data-[selected=true]:text-primary-foreground/80 group-aria-selected:text-primary-foreground/80 text-[13px]">
                            ↵
                          </CommandShortcut>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </CommandList>

              {/* Keyboard Navigation Footer — Global Scope Style */}
              <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.15em] text-primary/60 dark:text-muted-foreground/60">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit font-mono">
                      ↑↓
                    </kbd>
                    Nav
                  </span>
                  <span className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit font-mono">
                      ↵
                    </kbd>
                    Select
                  </span>
                </div>
                <span className="flex items-center gap-1.5">
                  <kbd className="px-1.5 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit font-mono">
                    esc
                  </kbd>
                  Close
                </span>
              </div>
            </div>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

export default QuickSearchDialog;
