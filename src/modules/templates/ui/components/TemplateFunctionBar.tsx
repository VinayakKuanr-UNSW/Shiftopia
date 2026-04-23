import React from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

interface TemplateFunctionBarProps {
  statusFilter: 'published' | 'draft' | 'archived';
  onStatusFilterChange: (status: 'published' | 'draft' | 'archived') => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onCreateTemplate: () => void;
  counts: {
    published: number;
    draft: number;
    archived: number;
  };
  className?: string;
  transparent?: boolean;
}

export const TemplateFunctionBar: React.FC<TemplateFunctionBarProps> = ({
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
  onCreateTemplate,
  counts,
  className,
  transparent = false,
}) => {
  const { isDark } = useTheme();

  return (
    <div className={cn(
      "flex flex-col lg:flex-row items-stretch lg:items-center gap-3 w-full transition-all p-1.5 rounded-2xl",
      !transparent && (
        isDark 
          ? "bg-[#1c2333]/40 backdrop-blur-md border border-white/5 shadow-2xl shadow-black/20" 
          : "bg-white/60 backdrop-blur-md border border-white/80 shadow-lg shadow-slate-200/50"
      ),
      className
    )}>
      {/* 1. Status Toggles (Left Pod) */}
      <div className={cn(
        "flex p-1 rounded-xl flex-shrink-0",
        isDark ? "bg-[#111827]/60" : "bg-slate-200/50"
      )}>
        <button
          onClick={() => onStatusFilterChange('published')}
          className={cn(
            'flex items-center gap-2 px-3 h-9 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all',
            statusFilter === 'published'
              ? 'bg-emerald-500 text-white shadow-sm'
              : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-slate-900/40 hover:text-slate-900 hover:bg-slate-900/5')
          )}
        >
          <div className={cn("h-1.5 w-1.5 rounded-full", statusFilter === 'published' ? "bg-white" : "bg-emerald-500")} />
          Ready
          <span className="opacity-50 font-mono">({counts.published})</span>
        </button>
        <button
          onClick={() => onStatusFilterChange('draft')}
          className={cn(
            'flex items-center gap-2 px-3 h-9 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all',
            statusFilter === 'draft'
              ? 'bg-amber-500 text-white shadow-sm'
              : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-slate-900/40 hover:text-slate-900 hover:bg-slate-900/5')
          )}
        >
          <div className={cn("h-1.5 w-1.5 rounded-full", statusFilter === 'draft' ? "bg-white" : "bg-amber-500")} />
          Draft
          <span className="opacity-50 font-mono">({counts.draft})</span>
        </button>
        <button
          onClick={() => onStatusFilterChange('archived')}
          className={cn(
            'flex items-center gap-2 px-3 h-9 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all',
            statusFilter === 'archived'
              ? 'bg-purple-500 text-white shadow-sm'
              : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-slate-900/40 hover:text-slate-900 hover:bg-slate-900/5')
          )}
        >
          <div className={cn("h-1.5 w-1.5 rounded-full", statusFilter === 'archived' ? "bg-white" : "bg-purple-500")} />
          Archive
          <span className="opacity-50 font-mono">({counts.archived})</span>
        </button>
      </div>

      <div className="hidden lg:block h-6 w-px bg-border/20 flex-shrink-0" />

      {/* 2. Search & Action Pod (Right/Center) */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className={cn(
              "pl-9 h-11 border-none bg-transparent focus-visible:ring-0 text-xs font-medium placeholder:text-muted-foreground/40",
              isDark ? "text-white" : "text-slate-900"
            )}
          />
        </div>

        <div className="h-6 w-px bg-border/20 flex-shrink-0" />

        <Button
          onClick={onCreateTemplate}
          className={cn(
            "h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-wider transition-all shadow-lg shadow-primary/10",
            "bg-primary text-primary-foreground hover:scale-[1.02] active:scale-[0.98]"
          )}
        >
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>
    </div>
  );
};
