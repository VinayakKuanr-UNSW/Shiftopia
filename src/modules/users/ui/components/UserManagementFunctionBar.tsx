import React from 'react';
import { 
  Users, 
  Search, 
  Download, 
  Filter,
  UserPlus
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/modules/core/ui/primitives/command';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';

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
  isZeta: boolean;
  onDelete?: () => void;
  transparent?: boolean;
}

export const UserManagementFunctionBar: React.FC<UserManagementFunctionBarProps> = ({
  profiles,
  selectedUserId,
  onUserSelect,
  isZeta,
  onDelete,
  transparent
}) => {
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const { isDark } = useTheme();

  const filteredProfiles = React.useMemo(() => {
    if (!searchQuery) return profiles;
    const query = searchQuery.toLowerCase();
    return profiles.filter(p => 
      p.full_name.toLowerCase().includes(query) || 
      p.email.toLowerCase().includes(query)
    );
  }, [profiles, searchQuery]);

  const selectedProfile = profiles.find(p => p.id === selectedUserId);

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
      {/* Search / Combobox Select Pod */}
      <div
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Search or select employee"
        className={cn(
          "flex flex-1 items-center gap-2 w-full lg:w-auto p-1 rounded-xl focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1 transition-all",
          isDark ? "bg-black/30 border border-white/10" : "bg-white/90 border border-slate-200 shadow-inner"
        )}
      >
        <div className="pl-3 text-muted-foreground">
          <Search className="h-4 w-4" aria-hidden="true" />
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div className="flex-1 w-full">
              <label htmlFor="user-select-input" className="sr-only">
                Search or select employee
              </label>
              <Input
                id="user-select-input"
                type="search"
                value={open ? searchQuery : (selectedProfile?.full_name || '')}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!open) setOpen(true);
                }}
                onFocus={() => {
                  setOpen(true);
                  setSearchQuery('');
                }}
                placeholder={open 
                  ? (selectedProfile?.full_name || 'SEARCH OR SELECT EMPLOYEE') 
                  : 'SEARCH OR SELECT EMPLOYEE'}
                aria-label="Search or select employee by name or email"
                className="flex-1 bg-transparent border-0 border-none shadow-none hover:bg-transparent hover:border-transparent text-[11px] font-black uppercase tracking-widest h-10 lg:h-11 px-3 text-left w-full text-foreground font-mono focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-transparent focus:outline-none placeholder:text-muted-foreground/70 outline-none"
              />
            </div>
          </PopoverTrigger>
          <PopoverContent 
            className="w-[320px] p-0 rounded-2xl border border-primary/20 shadow-2xl z-[200] bg-popover/95 backdrop-blur-xl" 
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Command 
              shouldFilter={false}
              className={cn(
                "rounded-2xl border-none",
                isDark ? "bg-[#1c2333] text-white" : "bg-white text-slate-900"
              )}
            >
              <CommandList className="max-h-[300px] scrollbar-none">
                <CommandEmpty className="py-4 text-center text-xs font-semibold text-muted-foreground">No employee found.</CommandEmpty>
                <CommandGroup heading="Employees" className="px-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                  {filteredProfiles?.map(profile => (
                    <CommandItem 
                      key={profile.id} 
                      value={`${profile.full_name} ${profile.email}`}
                      onSelect={() => {
                        onUserSelect(profile.id);
                        setSearchQuery('');
                        setOpen(false);
                      }}
                      className="py-3 px-4 focus:bg-primary/10 rounded-xl cursor-pointer aria-selected:bg-primary aria-selected:text-primary-foreground"
                    >
                      <div className="flex flex-col text-left w-full">
                        <span className="font-black uppercase tracking-widest text-[10px] text-foreground">{profile.full_name}</span>
                        <span className="text-[9px] text-muted-foreground font-mono">{profile.email}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 w-full lg:w-auto" role="group" aria-label="Management actions">
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

        {isZeta && (
          <Button 
            aria-label="Add new user"
            className="h-10 lg:h-11 px-6 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <UserPlus className="h-3.5 w-3.5 mr-2" aria-hidden="true" />
            NEW USER
          </Button>
        )}
      </div>
    </div>
  );
};
