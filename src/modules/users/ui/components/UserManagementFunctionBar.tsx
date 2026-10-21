import React, { useId, useRef } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Search, X } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
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
  const { isDark } = useTheme();
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  const pill = cn(
    'min-h-11 px-4 rounded-xl text-[11px] font-black uppercase tracking-[0.2em] transition-all border',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    isDark ? 'bg-white/5 text-foreground hover:bg-white/10 border-white/10' : 'bg-white text-slate-800 hover:bg-slate-50 border-slate-200',
  );

  const clearSearch = () => {
    onSearchChange('');
    searchRef.current?.focus();
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-2 w-full transition-all text-foreground sm:flex-row sm:items-center',
        !transparent && (isDark ? 'bg-[#111827]/40' : 'bg-white/40 shadow-sm border border-white/20'),
        !transparent && 'rounded-2xl p-1.5 lg:p-2',
      )}
    >
      <div role="search" aria-label="Users" className="relative w-full sm:max-w-md sm:flex-1 min-w-0">
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
            'min-h-11 w-full rounded-xl border pl-10 pr-11 text-sm font-medium text-foreground placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            // One clear button: ours, which every browser shows the same way.
            '[&::-webkit-search-cancel-button]:appearance-none',
            isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200',
          )}
        />
        {search && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 sm:ml-auto">
        <ColumnsPicker columns={columns} onColumnsChange={onColumnsChange} triggerClassName={pill} />

        <PageMenu modal={false}>
          <PageMenuTrigger asChild>
            <Button variant="outline" aria-label="Export users" className={pill} disabled={exportDisabled}>
              <Download className="h-3.5 w-3.5 mr-2 text-primary" aria-hidden="true" />
              Export
              <ChevronDown className="h-3.5 w-3.5 ml-1.5 opacity-60" aria-hidden="true" />
            </Button>
          </PageMenuTrigger>
          <PageMenuContent align="end" heading="Export">
            <PageMenuItem icon={<FileSpreadsheet />} onSelect={() => onExport('xlsx')}>Excel (.xlsx)</PageMenuItem>
            <PageMenuItem icon={<FileText />} onSelect={() => onExport('pdf')}>PDF</PageMenuItem>
          </PageMenuContent>
        </PageMenu>

        {isAdmin && (
          <InviteUserDialog className="min-h-11 px-6 rounded-xl text-[11px] font-black uppercase tracking-[0.2em] transition-all bg-primary text-primary-foreground shadow-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" />
        )}
      </div>
    </div>
  );
};
