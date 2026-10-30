import React from 'react';
import { Plus, Search } from 'lucide-react';
import { ToolbarRow, toolbar } from '@/modules/core/ui/components/Toolbar';

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
  // No views or modes: search and create are zone-3 actions.
  return (
    <ToolbarRow
      className={className}
      actions={<>
        <label className={toolbar.search}>
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search groups"
            placeholder="Search groups..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className={toolbar.searchInput}
          />
        </label>
        {canCreateGroup && (
          <button type="button" onClick={onCreateGroup} className={toolbar.primaryAction}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create Group
          </button>
        )}
      </>}
    />
  );
};
