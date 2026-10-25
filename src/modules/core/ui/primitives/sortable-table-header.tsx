
import React from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { SortDirection } from '@/modules/core/hooks/useTableSorting';
import { tableTokens } from './table';

interface SortableTableHeaderProps {
  children: React.ReactNode;
  sortKey: string;
  currentSort?: { key: string; direction: SortDirection };
  onSort: (key: string) => void;
  className?: string;
}

export const SortableTableHeader: React.FC<SortableTableHeaderProps> = ({
  children,
  sortKey,
  currentSort,
  onSort,
  className,
}) => {
  const isActive = currentSort?.key === sortKey;
  const direction = isActive ? currentSort?.direction : null;

  const Icon = !isActive || direction === null ? ChevronsUpDown : direction === 'asc' ? ChevronUp : ChevronDown;

  return (
    <th
      scope="col"
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
      className={cn(tableTokens.head, isActive && 'text-foreground', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex min-h-[32px] items-center uppercase tracking-wider select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        {children}
        <Icon className={cn('ml-1 h-[14px] w-[14px]', isActive ? 'opacity-90' : 'opacity-40')} />
      </button>
    </th>
  );
};
