
import React from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { SortDirection } from '@/modules/core/hooks/useTableSorting';

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

  const getSortIcon = () => {
    if (!isActive || direction === null) {
      return <ChevronsUpDown className="ml-1 h-4 w-4 text-white/40" />;
    }
    if (direction === 'asc') {
      return <ChevronUp className="ml-1 h-4 w-4 text-white/80" />;
    }
    return <ChevronDown className="ml-1 h-4 w-4 text-white/80" />;
  };

  return (
    <th
      className={cn(
        "p-4 text-left font-medium cursor-pointer hover:bg-white/5 transition-colors select-none",
        isActive && "text-white bg-white/10",
        className
      )}
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center">
        {children}
        {getSortIcon()}
      </div>
    </th>
  );
};
