import React, { useRef } from 'react';
import { Plus, Search, LayoutGrid, List as ListIcon } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { ToolbarRow, ToolbarSegmented, toolbar, type ToolbarSegmentedOption } from '@/modules/core/ui/components/Toolbar';

type StatusFilter = 'published' | 'draft' | 'archived';

const TEMPLATE_VIEWS: ReadonlyArray<ToolbarSegmentedOption<'list' | 'grid'>> = [
  { id: 'list', icon: <ListIcon className="h-3.5 w-3.5" />, label: 'List' },
  { id: 'grid', icon: <LayoutGrid className="h-3.5 w-3.5" />, label: 'Card' },
];

interface TemplateFunctionBarProps {
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
  /** View-only manager (delta, epsilon): no New Template button. */
  readOnly?: boolean;
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
  readOnly = false,
  counts,
  viewMode = 'list',
  onViewModeChange,
  className,
  transparent = false,
}) => {
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
    <ToolbarRow
      className={cn(!transparent && toolbar.standalone, className)}
      views={onViewModeChange ? (
        <ToolbarSegmented value={viewMode} onValueChange={onViewModeChange} options={TEMPLATE_VIEWS} />
      ) : undefined}
      modes={
        // Status is the mode of this list. Its colour lives on the dot; the
        // selected option takes the same filled state as every mode pill.
        <div
          ref={groupRef}
          role="radiogroup"
          aria-label="Filter templates by status"
          onKeyDown={handleKeyDown}
          className={cn(toolbar.control, 'gap-0.5 max-w-full overflow-x-auto no-scrollbar')}
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
                  toolbar.controlItem,
                  'inline-flex items-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? toolbar.modeOn : toolbar.modeOff,
                )}
              >
                <span className={cn('h-2 w-2 rounded-full shrink-0', isActive ? 'bg-primary-foreground' : filter.dot)} aria-hidden="true" />
                {filter.label}
                <span className="font-mono tabular-nums opacity-80">({count})</span>
              </button>
            );
          })}
        </div>
      }
      actions={<>
        <label className={toolbar.search}>
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search templates by name or description"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className={toolbar.searchInput}
          />
        </label>
        {!readOnly && (
          <button type="button" onClick={onCreateTemplate} className={toolbar.primaryAction}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Template
          </button>
        )}
      </>}
    />
  );
};

