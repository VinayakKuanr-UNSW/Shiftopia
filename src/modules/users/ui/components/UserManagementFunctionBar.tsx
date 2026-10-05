import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Search, 
  Download, 
  Filter,
  Check,
  ChevronDown
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { 
  Command, 
  CommandEmpty, 
  CommandGroup, 
  CommandInput, 
  CommandItem, 
  CommandList,
  CommandShortcut 
} from '@/modules/core/ui/primitives/command';
import { Button } from '@/modules/core/ui/primitives/button';
import { InviteUserDialog } from './InviteUserDialog';

interface Profile {
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
}

interface UserManagementFunctionBarProps {
  profiles: Profile[];
  selectedUserId: string;
  onUserSelect: (id: string) => void;
  isAdmin: boolean;
  onDelete?: () => void;
  transparent?: boolean;
}

export const UserManagementFunctionBar: React.FC<UserManagementFunctionBarProps> = ({
  profiles,
  selectedUserId,
  onUserSelect,
  isAdmin,
  onDelete,
  transparent
}) => {
  const [open, setOpen] = useState(false);
  const { isDark } = useTheme();

  const selectedProfile = profiles.find(p => p.id === selectedUserId);

  // Keyboard Escape listener
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <div
      role="toolbar"
      aria-label="User management controls"
      className={cn(
        "flex flex-col lg:flex-row items-center gap-4 w-full transition-all text-foreground",
        !transparent && (isDark ? "bg-[#111827]/40" : "bg-white/40 shadow-sm border border-white/20"),
        !transparent && "rounded-2xl p-1.5 lg:p-2"
      )}
    >
      {/* Search / Combobox Select Pod — Global Scope Dropdown Pattern */}
      <div className="flex-1 w-full min-w-0">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-label="Search or select employee"
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300",
                "border min-w-[220px] justify-between w-full h-14",
                "hover:scale-[1.01] active:scale-[0.99] relative z-30",
                open ? "ring-2 ring-primary bg-primary/5 shadow-primary/20 border-primary/40" : "",
                isDark
                  ? "bg-[#1c2333] text-white/90 hover:bg-[#252d40] border-white/10 shadow-lg shadow-black/20"
                  : "bg-white text-slate-800 hover:bg-indigo-50/50 border-slate-200/80 shadow-sm"
              )}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={cn(
                  "p-2 rounded-lg transition-colors shrink-0",
                  open ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground"
                )}>
                  <Search className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="flex flex-col items-start gap-0.5 min-w-0 text-left">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40 leading-none">
                    Employee
                  </span>
                  <span className={cn(
                    "truncate max-w-[240px] sm:max-w-[400px] text-xs sm:text-sm font-semibold",
                    !selectedProfile && "text-muted-foreground font-medium"
                  )}>
                    {selectedProfile ? selectedProfile.full_name : 'SEARCH OR SELECT EMPLOYEE'}
                  </span>
                </div>
              </div>
              <ChevronDown className={cn(
                "w-4 h-4 text-slate-400 dark:text-white/40 flex-shrink-0 transition-transform duration-300",
                open && "rotate-180 text-primary"
              )} />
            </button>
          </PopoverTrigger>

          <PopoverContent 
            side="bottom"
            align="start"
            sideOffset={8}
            avoidCollisions={false}
            className="w-[var(--radix-popover-trigger-width)] min-w-[320px] max-w-[500px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none" 
          >
            <Command 
              className="bg-transparent overflow-visible w-full outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                  e.preventDefault();
                }
              }}
            >
              <div className="flex flex-col gap-1.5 w-full">
                {/* Search Bar Container */}
                <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                  <CommandInput 
                    placeholder="Search employee by name or email..." 
                    className="h-14 text-sm sm:text-base border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                    autoFocus
                  />
                </div>

                {/* Results Container */}
                <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
                  <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                    <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-sm">
                      No employee found.
                    </CommandEmpty>
                    <CommandGroup heading="Employees" className="px-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                      {profiles.map(profile => {
                        const isSelected = profile.id === selectedUserId;
                        return (
                          <CommandItem 
                            key={profile.id} 
                            value={`${profile.full_name} ${profile.email}`}
                            onSelect={() => {
                              onUserSelect(profile.id);
                              setOpen(false);
                            }}
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all",
                              "aria-selected:bg-primary aria-selected:text-primary-foreground group"
                            )}
                          >
                            {/* Circle Checkmark Indicator */}
                            <div className={cn(
                              "w-5 h-5 rounded-full border flex items-center justify-center transition-all shrink-0",
                              isSelected 
                                ? "bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:border-white group-aria-selected:text-primary" 
                                : "border-muted-foreground/30 group-aria-selected:border-white/40"
                            )}>
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>

                            <div className="flex flex-col flex-1 min-w-0 text-left">
                              <span className="font-semibold text-sm sm:text-base capitalize truncate">
                                {profile.full_name}
                              </span>
                              <span className="text-[10px] text-muted-foreground group-aria-selected:text-white/70 truncate font-mono">
                                {profile.email}
                              </span>
                            </div>

                            <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>

                  {/* Keyboard Navigation Footer */}
                  <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em] text-primary/50 dark:text-muted-foreground/50">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">↑↓</kbd> Nav
                      </span>
                      <span className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">↵</kbd> Select
                      </span>
                    </div>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">esc</kbd> Close
                    </span>
                  </div>
                </div>
              </div>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 w-full lg:w-auto shrink-0" role="group" aria-label="Management actions">
        <Button 
          variant="outline"
          aria-label="Filter employees"
          className={cn(
            "h-10 lg:h-11 px-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border focus-visible:ring-2 focus-visible:ring-primary",
            isDark ? "bg-white/5 text-foreground hover:bg-white/10 border-white/10" : "bg-white text-slate-800 hover:bg-slate-50 border-slate-200"
          )}
        >
          <Filter className="h-3.5 w-3.5 mr-2 text-primary" aria-hidden="true" />
          FILTERS
        </Button>

        <Button 
          variant="outline"
          aria-label="Export employee data"
          className={cn(
            "h-10 lg:h-11 px-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border focus-visible:ring-2 focus-visible:ring-primary",
            isDark ? "bg-white/5 text-foreground hover:bg-white/10 border-white/10" : "bg-white text-slate-800 hover:bg-slate-50 border-slate-200"
          )}
        >
          <Download className="h-3.5 w-3.5 mr-2 text-primary" aria-hidden="true" />
          EXPORT
        </Button>

        {isAdmin && (
          <InviteUserDialog className="h-10 lg:h-11 px-6 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" />
        )}
      </div>
    </div>
  );
};
