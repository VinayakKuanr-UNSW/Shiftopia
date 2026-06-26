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

  return (
    <div className={cn(
      "flex flex-col lg:flex-row items-center gap-4 w-full transition-all",
      !transparent && (isDark ? "bg-[#111827]/40" : "bg-white/40 shadow-sm border border-white/20"),
      !transparent && "rounded-2xl p-1.5 lg:p-2"
    )}>
      {/* Left side: Search/Select Pod */}
      <div className={cn(
        "flex flex-1 items-center gap-2 w-full lg:w-auto p-1 rounded-xl",
        isDark ? "bg-black/20" : "bg-white/60 border border-slate-200/50 shadow-inner"
      )}>
        <div className="pl-3 text-muted-foreground/40">
          <Search className="h-4 w-4" />
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Input
              type="text"
              value={open ? searchQuery : (profiles.find(p => p.id === selectedUserId)?.full_name || '')}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!open) setOpen(true);
              }}
              onFocus={() => {
                setOpen(true);
                setSearchQuery('');
              }}
              placeholder={open 
                ? (profiles.find(p => p.id === selectedUserId)?.full_name || 'SEARCH OR SELECT EMPLOYEE') 
                : 'SEARCH OR SELECT EMPLOYEE'}
              className="flex-1 bg-transparent border-0 border-none shadow-none hover:bg-transparent hover:border-transparent text-[11px] font-black uppercase tracking-widest h-10 lg:h-11 px-3 text-left w-full text-foreground/90 font-mono focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-transparent focus:outline-none placeholder:text-muted-foreground/40 outline-none"
            />
          </PopoverTrigger>
          <PopoverContent 
            className="w-[320px] p-0 rounded-2xl border-none shadow-2xl z-[200]" 
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
              <CommandList>
                <CommandEmpty className="py-4 text-center text-xs font-semibold text-muted-foreground/60">No employee found.</CommandEmpty>
                <CommandGroup>
                  {filteredProfiles?.map(profile => (
                    <CommandItem 
                      key={profile.id} 
                      value={`${profile.full_name} ${profile.email}`}
                      onSelect={() => {
                        onUserSelect(profile.id);
                        setSearchQuery('');
                        setOpen(false);
                      }}
                      className="py-3 px-4 focus:bg-primary/10 rounded-xl cursor-pointer"
                    >
                      <div className="flex flex-col text-left w-full">
                        <span className="font-black uppercase tracking-widest text-[10px]">{profile.full_name}</span>
                        <span className="text-[9px] text-muted-foreground/60 font-mono">{profile.email}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Right side: Action Pods */}
      <div className="flex items-center gap-2 w-full lg:w-auto">
        <Button 
          variant="outline" 
          className={cn(
            "h-10 lg:h-11 px-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border-0",
            isDark ? "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white" : "bg-white/60 text-slate-900/40 hover:bg-white hover:text-slate-900 border border-slate-200/50"
          )}
        >
          <Filter className="h-3.5 w-3.5 mr-2" />
          FILTERS
        </Button>

        <Button 
          variant="outline" 
          className={cn(
            "h-10 lg:h-11 px-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border-0",
            isDark ? "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white" : "bg-white/60 text-slate-900/40 hover:bg-white hover:text-slate-900 border border-slate-200/50"
          )}
        >
          <Download className="h-3.5 w-3.5 mr-2" />
          EXPORT
        </Button>

        {isZeta && (
          <Button 
            className="h-10 lg:h-11 px-6 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all bg-primary text-white shadow-lg shadow-primary/20 hover:scale-105 active:scale-95"
          >
            <UserPlus className="h-3.5 w-3.5 mr-2" />
            NEW USER
          </Button>
        )}
      </div>
    </div>
  );
};
