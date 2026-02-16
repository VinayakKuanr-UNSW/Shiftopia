
import React from 'react';
import { Calendar, List, Filter, Search, SortAsc } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';

interface EnhancedManagementHeaderProps {
  title: string;
  subtitle?: string;
  viewMode: 'list' | 'calendar';
  onViewModeChange: (mode: 'list' | 'calendar') => void;
  onFilterClick?: () => void;
  onSortClick?: () => void;
  activeFilterCount?: number;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  totalItems?: number;
  filteredItems?: number;
}

const EnhancedManagementHeader: React.FC<EnhancedManagementHeaderProps> = ({
  title,
  subtitle,
  viewMode,
  onViewModeChange,
  onFilterClick,
  onSortClick,
  activeFilterCount = 0,
  searchValue = '',
  onSearchChange,
  totalItems,
  filteredItems
}) => {
  return (
    <header className="management-header space-y-6" role="banner">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-lg text-muted-foreground">{subtitle}</p>
          )}
          {totalItems !== undefined && filteredItems !== undefined && (
            <p className="text-base text-muted-foreground" aria-live="polite">
              Showing {filteredItems} of {totalItems} total items
            </p>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Search */}
          {onSearchChange && (
            <div className="relative" role="search">
              <Search 
                className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" 
                aria-hidden="true"
              />
              <Input
                placeholder="Search..."
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-10 w-72 h-11 text-base lovable-input focus:ring-2 focus:ring-primary/30"
                aria-label="Search items"
              />
            </div>
          )}

          {/* View Mode Toggle */}
          <fieldset className="flex items-center border rounded-lg overflow-hidden bg-card/50">
            <legend className="sr-only">View mode selection</legend>
            <Button
              variant={viewMode === 'list' ? "default" : "ghost"}
              size="default"
              className={cn(
                "rounded-none border-none h-11 px-4 text-base font-medium",
                viewMode === 'list' ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent"
              )}
              onClick={() => onViewModeChange('list')}
              aria-pressed={viewMode === 'list'}
              aria-label="List view"
            >
              <List className="h-5 w-5 mr-2" aria-hidden="true" />
              List
            </Button>
            <Button
              variant={viewMode === 'calendar' ? "default" : "ghost"}
              size="default"
              className={cn(
                "rounded-none border-none h-11 px-4 text-base font-medium",
                viewMode === 'calendar' ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent"
              )}
              onClick={() => onViewModeChange('calendar')}
              aria-pressed={viewMode === 'calendar'}
              aria-label="Calendar view"
            >
              <Calendar className="h-5 w-5 mr-2" aria-hidden="true" />
              Calendar
            </Button>
          </fieldset>

          {/* Sort Button */}
          {onSortClick && (
            <Button
              variant="outline"
              size="default"
              onClick={onSortClick}
              className="lovable-btn-secondary h-11 px-4 text-base font-medium"
              aria-label="Sort options"
            >
              <SortAsc className="h-5 w-5 mr-2" aria-hidden="true" />
              Sort
            </Button>
          )}

          {/* Filter Button */}
          {onFilterClick && (
            <Button
              variant="outline"
              size="default"
              onClick={onFilterClick}
              className={cn(
                "lovable-btn-secondary relative h-11 px-4 text-base font-medium",
                activeFilterCount > 0 && "border-primary bg-primary/5"
              )}
              aria-label={`Filter options${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}`}
              aria-describedby={activeFilterCount > 0 ? "filter-count" : undefined}
            >
              <Filter className="h-5 w-5 mr-2" aria-hidden="true" />
              Filters
              {activeFilterCount > 0 && (
                <Badge 
                  variant="destructive" 
                  className="absolute -top-2 -right-2 h-6 w-6 text-xs p-0 flex items-center justify-center font-semibold"
                  id="filter-count"
                  aria-label={`${activeFilterCount} active filters`}
                >
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export default EnhancedManagementHeader;
