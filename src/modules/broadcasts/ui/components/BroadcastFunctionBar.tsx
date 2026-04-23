import React from 'react';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

interface BroadcastFunctionBarProps {
  onSearchChange: (query: string) => void;
  searchQuery: string;
  onRefresh: () => void;
  onCreateGroup: () => void;
  isLoading?: boolean;
  className?: string;
}

export const BroadcastFunctionBar: React.FC<BroadcastFunctionBarProps> = ({
  onSearchChange,
  searchQuery,
  onRefresh,
  onCreateGroup,
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
              "pl-10 h-10 lg:h-11 border-none bg-transparent font-medium text-sm placeholder:text-muted-foreground/40 focus-visible:ring-0",
              isDark ? "bg-white/5" : "bg-slate-900/5"
            )}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          className={cn(
            "h-10 lg:h-11 w-10 lg:w-11 rounded-xl transition-all border shadow-sm",
            isDark ? "bg-[#111827]/60 border-white/5" : "bg-slate-100 border-slate-200/50"
          )}
          disabled={isLoading}
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </Button>

        <Button
          onClick={onCreateGroup}
          className="h-10 lg:h-11 px-4 lg:px-6 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase text-[10px] tracking-wider rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Create Group
        </Button>
      </div>
    </div>
  );
};
