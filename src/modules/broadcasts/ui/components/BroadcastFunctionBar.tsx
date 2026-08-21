import React from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

interface BroadcastFunctionBarProps {
  onSearchChange: (query: string) => void;
  searchQuery: string;
  onCreateGroup?: () => void;
  /**
   * Creating a group is a manager capability and only the Broadcasts Manager
   * screen implements it. My Broadcasts is a member view, so it opts out
   * rather than rendering a button with nothing behind it.
   */
  canCreateGroup?: boolean;
  isLoading?: boolean;
  className?: string;
}

export const BroadcastFunctionBar: React.FC<BroadcastFunctionBarProps> = ({
  onSearchChange,
  searchQuery,
  onCreateGroup,
  canCreateGroup = true,
  isLoading,
  className,
}) => {
  const { isDark } = useTheme();

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-4 w-full", className)}>
      <div className="flex flex-1 items-center gap-3 min-w-[240px] max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
          <Input
            placeholder="Search groups..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className={cn(
              "min-h-[44px] border-none bg-transparent pl-10 text-sm font-medium placeholder:text-muted-foreground/40 focus-visible:ring-0",
              isDark ? "bg-white/5" : "bg-slate-900/5"
            )}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {canCreateGroup && (
          <Button
            onClick={onCreateGroup}
            className="min-h-[44px] gap-2 rounded-xl bg-primary px-4 text-[10px] font-black uppercase tracking-wider text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] lg:px-6"
          >
            <Plus className="h-4 w-4" />
            Create Group
          </Button>
        )}
      </div>
    </div>
  );
};
