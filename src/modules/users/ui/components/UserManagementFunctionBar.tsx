import React, { useId, useRef } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Search, X } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { ToolbarRow, toolbar } from '@/modules/core/ui/components/Toolbar';
import { Button } from '@/modules/core/ui/primitives/button';
import { InviteUserDialog } from './InviteUserDialog';
import { ColumnsPicker } from './ColumnsPicker';
import { PageMenu, PageMenuContent, PageMenuItem, PageMenuTrigger } from './PageMenu';
import type { ColumnVisibility } from '../usersTableColumns';

export type UsersExportFormat = 'xlsx' | 'pdf';

interface UserManagementFunctionBarProps {
  isAdmin: boolean;
  /** Export the rows the table shows (the scope, narrowed by the search). */
  onExport: (format: UsersExportFormat) => void;
  /** Nothing to export yet, or an export is running. */
  exportDisabled?: boolean;
  /** The search: name, email, role or place. */
  search: string;
  onSearchChange: (query: string) => void;
  /** Which table columns this viewer shows. */
  columns?: ColumnVisibility;
  onColumnsChange: (next: ColumnVisibility) => void;
  transparent?: boolean;
}

/**
 * The Users page function line (2026-10-17): search the table, choose its
 * columns, export it, or add a user. There is no person picker: the table
 * below is the page.
 */
export const UserManagementFunctionBar: React.FC<UserManagementFunctionBarProps> = ({
  isAdmin,
  onExport,
  exportDisabled = false,
  search,
  onSearchChange,
  columns = {},
  onColumnsChange,
  transparent,
}) => {
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  const clearSearch = () => {
    onSearchChange('');
    searchRef.current?.focus();
  };

  // No views or modes on this page: everything is a zone-3 action.
  return (
    <ToolbarRow
      className={cn('text-foreground', !transparent && toolbar.standalone)}
      actions={<>
        <div role="search" aria-label="Users" className="relative w-full md:w-72 min-w-0">
          <label htmlFor={searchId} className="sr-only">Search users</label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears, as the platform's own search fields do.
              if (e.key === 'Escape' && search) {
                e.preventDefault();
                onSearchChange('');
              }
            }}
            placeholder="Search name, email, role or place"
            autoComplete="off"
            spellCheck={false}
            className={cn(
              // The shared search field's look, as a bare input so the clear button can sit inside it.
              'h-[44px] w-full rounded-xl border pl-10 pr-11 text-[16px] md:text-[11px] font-semibold text-foreground placeholder:text-muted-foreground',
              'bg-slate-100 border-slate-200 dark:bg-black/20 dark:border-white/5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              // One clear button: ours, which every browser shows the same way.
              '[&::-webkit-search-cancel-button]:appearance-none',
            )}
          />
          {search && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-0 top-1/2 flex h-[44px] w-[44px] -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <ColumnsPicker columns={columns} onColumnsChange={onColumnsChange} triggerClassName={toolbar.secondaryAction} />

        <PageMenu modal={false}>
          <PageMenuTrigger asChild>
            <Button variant="outline" aria-label="Export users" className={toolbar.secondaryAction} disabled={exportDisabled}>
              <Download className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Export
              <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
            </Button>
          </PageMenuTrigger>
          <PageMenuContent align="end" heading="Export">
            <PageMenuItem icon={<FileSpreadsheet />} onSelect={() => onExport('xlsx')}>Excel (.xlsx)</PageMenuItem>
            <PageMenuItem icon={<FileText />} onSelect={() => onExport('pdf')}>PDF</PageMenuItem>
          </PageMenuContent>
        </PageMenu>

        {isAdmin && <InviteUserDialog className={toolbar.primaryAction} />}
      </>}
    />
  );
};
