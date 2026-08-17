import React, { useRef } from 'react';
import { Plus, Search, LayoutGrid, List as ListIcon } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

type StatusFilter = 'published' | 'draft' | 'archived';

export interface TemplateFunctionBarProps {
  statusFilter: StatusFilter;
  onStatusFilterChange: (status: StatusFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onCreateTemplate: () => void;
  counts: {
    published: number;
    draft: number;
    archived: number;
  };
  viewMode?: 'list' | 'grid';
  onViewModeChange?: (view: 'list' | 'grid') => void;
  className?: string;
  transparent?: boolean;
}

const FILTERS: { value: StatusFilter; label: string; countKey: keyof TemplateFunctionBarProps['counts']; dot: string; active: string }[] = [
  { value: 'published', label: 'Ready', countKey: 'published', dot: 'bg-emerald-500', active: 'bg-emerald-600 text-white shadow-md' },
  { value: 'draft', label: 'Draft', countKey: 'draft', dot: 'bg-amber-500', active: 'bg-amber-600 text-white shadow-md' },
  { value: 'archived', label: 'Archive', countKey: 'archived', dot: 'bg-purple-500', active: 'bg-purple-600 text-white shadow-md' },
];

export const TemplateFunctionBar: React.FC<TemplateFunctionBarProps> = ({
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
  onCreateTemplate,
  counts,
  viewMode = 'list',
  onViewModeChange,
  className,
  transparent = false,
}) => {
  const { isDark } = useTheme();
  const groupRef = useRef<HTMLDivElement>(null);

  /** Arrow keys move selection AND focus, per the radiogroup pattern. */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
          : 0;
    if (!delta) return;
    e.preventDefault();

    const index = FILTERS.findIndex((f) => f.value === statusFilter);
    const next = FILTERS[(index + delta + FILTERS.length) % FILTERS.length];
    onStatusFilterChange(next.value);
    groupRef.current
      ?.querySelector<HTMLButtonElement>(`[data-status="${next.value}"]`)
      ?.focus();
  };

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
      {/* 1. Status filter */}
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label="Filter templates by status"
        onKeyDown={handleKeyDown}
        className={cn(
          "flex items-center gap-1 p-1 rounded-xl flex-nowrap overflow-x-auto no-scrollbar shrink-0 max-w-full",
          isDark ? "bg-[#111827]/80 border border-white/10" : "bg-slate-200/70 border border-slate-300/50"
        )}
      >
        {FILTERS.map((filter) => {
          const isActive = statusFilter === filter.value;
          const count = counts[filter.countKey];
          return (
            <button
              key={filter.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              data-status={filter.value}
              onClick={() => onStatusFilterChange(filter.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 sm:px-3.5 h-11 min-h-[44px] rounded-lg text-[11px] sm:text-xs font-extrabold uppercase tracking-wider transition-all whitespace-nowrap shrink-0',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                isActive
                  ? filter.active
                  : (isDark ? 'text-slate-300 hover:text-white hover:bg-white/10' : 'text-slate-700 hover:text-slate-900 hover:bg-slate-900/10')
              )}
            >
              <span className={cn("h-2 w-2 rounded-full shrink-0", isActive ? "bg-white" : filter.dot)} aria-hidden="true" />
              {filter.label}
              <span className="opacity-75 font-mono text-[10px] sm:text-[11px]">({count})</span>
            </button>
          );
        })}
      </div>

      <div className="hidden lg:block h-6 w-px bg-border/20 flex-shrink-0" aria-hidden="true" />

      {/* 2. Search bar */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search templates by name or description"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className={cn(
              "pl-9 h-11 min-h-[44px] border-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary text-base sm:text-xs font-semibold placeholder:text-slate-500 dark:placeholder:text-slate-400",
              isDark ? "text-white" : "text-slate-900"
            )}
          />
        </div>

        {/* 3. Table / Card View Switcher */}
        {onViewModeChange && (
          <div className="flex items-center rounded-xl border border-border/40 bg-background/50 dark:bg-black/30 p-1 shrink-0">
            <button
              type="button"
              onClick={() => onViewModeChange('list')}
              aria-label="Table View"
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg transition-all',
                viewMode === 'list'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <ListIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('grid')}
              aria-label="Card View"
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg transition-all',
                viewMode === 'grid'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="h-6 w-px bg-border/20 flex-shrink-0" aria-hidden="true" />

        {/* 4. Create New Button */}
        <Button
          onClick={onCreateTemplate}
          className={cn(
            "h-11 min-h-[44px] px-4 rounded-xl font-extrabold uppercase text-xs tracking-wider transition-all shadow-md shadow-primary/10 shrink-0",
            "bg-primary text-primary-foreground hover:scale-[1.02] active:scale-[0.98]"
          )}
        >
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
          New Template
        </Button>
      </div>
    </div>
  );
};

export default TemplateFunctionBar;
