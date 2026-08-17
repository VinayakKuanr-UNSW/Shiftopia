import React, { useState } from 'react';
import { Search } from 'lucide-react';
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
} from '@/modules/core/ui/primitives/command';

interface EmployeeOption {
  id: string;
  full_name: string;
  email: string;
}

interface EmployeeSearchSelectProps {
  employees: EmployeeOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * Type-to-filter employee picker rendered as the header search pod.
 * Replaces the click-only Radix Select so managers can search by name or email.
 */
export const EmployeeSearchSelect: React.FC<EmployeeSearchSelectProps> = ({
  employees,
  selectedId,
  onSelect,
}) => {
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = employees.find((e) => e.id === selectedId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex flex-1 items-center gap-2 w-full lg:w-auto p-1 rounded-xl text-left transition-all',
            isDark ? 'bg-black/20' : 'bg-white/60 border border-slate-200/50 shadow-inner',
          )}
        >
          <span className="pl-3 text-muted-foreground/40">
            <Search className="h-4 w-4" />
          </span>
          <span
            className={cn(
              'flex flex-1 h-10 lg:h-11 items-center truncate text-[11px] font-black uppercase tracking-widest',
              !selected && 'text-muted-foreground',
            )}
          >
            {selected ? selected.full_name : 'SEARCH OR SELECT EMPLOYEE'}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={8}
        className={cn(
          'w-[var(--radix-popover-trigger-width)] p-0 overflow-hidden rounded-2xl border-0 shadow-2xl',
          isDark ? 'bg-[#1c2333] text-white' : 'bg-white text-slate-900',
        )}
      >
        <Command className="bg-transparent">
          <CommandInput placeholder="Search by name or email..." className="text-sm" />
          <CommandList className="max-h-[300px]">
            <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
              No employees found.
            </CommandEmpty>
            <CommandGroup>
              {employees.map((employee) => (
                <CommandItem
                  key={employee.id}
                  value={`${employee.full_name} ${employee.email}`}
                  onSelect={() => {
                    onSelect(employee.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'py-3 px-4 rounded-xl cursor-pointer aria-selected:bg-primary/10',
                    selectedId === employee.id && 'bg-primary/10',
                  )}
                >
                  <div className="flex flex-col">
                    <span className="font-black uppercase tracking-widest text-[10px]">
                      {employee.full_name}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">{employee.email}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
