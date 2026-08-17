// src/modules/templates/ui/components/TemplateExplorer.tsx
// File-explorer style template list and grid view with double-click open support

import React, { useState, useMemo } from 'react';
import {
  FileText,
  Plus,
  Search,
  MoreVertical,
  Pencil,
  Copy,
  Trash2,
  RotateCw,
  Clock,
  Layers,
  Users2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { Label } from '@/modules/core/ui/primitives/label';
import { cn } from '@/modules/core/lib/utils';
import { formatDistanceToNow, format, isValid } from 'date-fns';

/* ============================================================
   TYPES
   ============================================================ */

export interface ExplorerTemplate {
  id: string;
  name: string;
  description?: string | null;
  status: 'draft' | 'published' | 'archived';
  version: number;
  startDate?: string | null;
  endDate?: string | null;
  groupCount: number;
  subgroupCount: number;
  shiftCount: number;
  updatedAt: string;
  createdAt?: string;
  publishedAt?: string | null;
  organizationName?: string;
  departmentName?: string;
  subDepartmentName?: string;
}

export type SortField = 'name' | 'updated' | 'created' | 'shifts' | 'groups' | 'version';
export type SortDirection = 'asc' | 'desc';

export interface TemplateExplorerProps {
  templates: ExplorerTemplate[];
  selectedTemplateId: string | null;
  onSelectTemplate: (id: string) => void;
  onOpenTemplate: (id: string) => void;
  onCreateTemplate: () => void;
  onDuplicateTemplate?: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onRenameTemplate?: (id: string, name: string) => Promise<boolean>;
  onArchiveTemplate: (id: string) => void;
  onRestoreTemplate?: (id: string) => void;
  isLoading?: boolean;
  statusFilter: 'published' | 'draft' | 'archived';
  searchQuery: string;
  sortBy: string;
  onSortChange: (sort: string) => void;
  viewMode: 'list' | 'grid';
  onViewModeChange?: (view: 'list' | 'grid') => void;
  onSwitchToDraft?: () => void;
}

function safeDate(input?: string | null): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return isValid(d) ? d : null;
}

/* ============================================================
   COMPONENT
   ============================================================ */

export const TemplateExplorer: React.FC<TemplateExplorerProps> = ({
  templates,
  selectedTemplateId,
  onSelectTemplate,
  onOpenTemplate,
  onCreateTemplate,
  onDuplicateTemplate,
  onDeleteTemplate,
  onRenameTemplate,
  onArchiveTemplate,
  onRestoreTemplate,
  isLoading = false,
  statusFilter,
  searchQuery,
  sortBy,
  onSortChange,
  viewMode,
  onSwitchToDraft,
}) => {
  // Rename Dialog State
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Delete Dialog State
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExplorerTemplate | null>(null);

  // Parse sort field and direction from sortBy string e.g. "name-asc" or "updated-desc"
  const [sortField, sortDir]: [SortField, SortDirection] = useMemo(() => {
    const [field, dir] = sortBy.split('-');
    const validField: SortField = ['name', 'updated', 'created', 'shifts', 'groups', 'version'].includes(field)
      ? (field as SortField)
      : 'updated';
    const validDir: SortDirection = dir === 'asc' ? 'asc' : 'desc';
    return [validField, validDir];
  }, [sortBy]);

  // Handle column header sorting click
  const handleHeaderSort = (field: SortField) => {
    if (sortField === field) {
      onSortChange(`${field}-${sortDir === 'asc' ? 'desc' : 'asc'}`);
    } else {
      const defaultDir = field === 'name' ? 'asc' : 'desc';
      onSortChange(`${field}-${defaultDir}`);
    }
  };

  // Filter and Sort
  const processedTemplates = useMemo(() => {
    let result = templates.filter((t) => t.status === statusFilter);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query) ||
          t.organizationName?.toLowerCase().includes(query) ||
          t.departmentName?.toLowerCase().includes(query) ||
          t.subDepartmentName?.toLowerCase().includes(query)
      );
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          break;
        case 'updated': {
          const dateA = new Date(a.updatedAt).getTime();
          const dateB = new Date(b.updatedAt).getTime();
          comparison = dateA - dateB;
          break;
        }
        case 'created': {
          const dateA = new Date(a.createdAt || a.updatedAt).getTime();
          const dateB = new Date(b.createdAt || b.updatedAt).getTime();
          comparison = dateA - dateB;
          break;
        }
        case 'shifts':
          comparison = a.shiftCount - b.shiftCount;
          break;
        case 'groups':
          comparison = a.groupCount - b.groupCount;
          break;
        case 'version':
          comparison = a.version - b.version;
          break;
        default:
          comparison = 0;
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [templates, statusFilter, searchQuery, sortField, sortDir]);

  // Rename handlers
  const handleOpenRename = (template: ExplorerTemplate) => {
    setRenameId(template.id);
    setRenameName(template.name);
    setIsRenameOpen(true);
  };

  const handleConfirmRename = async () => {
    if (!renameId || !onRenameTemplate || !renameName.trim()) return;
    setIsRenaming(true);
    try {
      const success = await onRenameTemplate(renameId, renameName);
      if (success) setIsRenameOpen(false);
    } finally {
      setIsRenaming(false);
    }
  };

  // Delete handlers
  const handleOpenDelete = (template: ExplorerTemplate) => {
    setDeleteTarget(template);
    setIsDeleteOpen(true);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      onDeleteTemplate(deleteTarget.id);
      setIsDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden select-none">
      {/* ── Main Content Area ────────────────────────────────────────── */}
      {isLoading ? (
        <div className="p-6 space-y-3" role="status">
          <span className="sr-only">Loading templates…</span>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-xl border border-border/40 bg-muted/20 animate-pulse flex items-center px-6 gap-4"
            >
              <div className="h-9 w-9 rounded-lg bg-muted/40 shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-muted/40 rounded w-1/3" />
                <div className="h-3 bg-muted/30 rounded w-1/4" />
              </div>
              <div className="h-4 bg-muted/30 rounded w-20 hidden sm:block" />
              <div className="h-4 bg-muted/30 rounded w-24 hidden md:block" />
            </div>
          ))}
        </div>
      ) : processedTemplates.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center flex-1 min-h-[380px] p-8 text-center">
          {searchQuery ? (
            <>
              <div className="h-14 w-14 rounded-2xl bg-muted/40 flex items-center justify-center text-muted-foreground mb-4">
                <Search className="h-7 w-7 opacity-60" />
              </div>
              <h3 className="text-base font-bold text-foreground">No matching templates found</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                We couldn't find any templates matching &ldquo;{searchQuery}&rdquo;. Try adjusting your search query or scope filter.
              </p>
            </>
          ) : statusFilter === 'published' ? (
            <>
              <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mb-4">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h3 className="text-base font-bold text-foreground">No Ready Templates</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Templates marked as &ldquo;Ready&rdquo; are published and locked for operational roster generation.
              </p>
              {onSwitchToDraft && (
                <Button
                  variant="outline"
                  onClick={onSwitchToDraft}
                  className="mt-4 h-10 px-4 rounded-xl text-xs font-bold"
                >
                  View Draft Templates
                </Button>
              )}
            </>
          ) : statusFilter === 'archived' ? (
            <>
              <div className="h-14 w-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-500 mb-4">
                <Trash2 className="h-7 w-7" />
              </div>
              <h3 className="text-base font-bold text-foreground">Archive is Empty</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Archived templates are stored here safely and can be restored back to Draft at any time.
              </p>
            </>
          ) : (
            <>
              <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-4 shadow-inner">
                <FileText className="h-7 w-7" />
              </div>
              <h3 className="text-base font-bold text-foreground">No Draft Templates Yet</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Create your first shift template to start organizing subgroups, shift patterns, and roles.
              </p>
              <Button
                onClick={onCreateTemplate}
                className="mt-5 h-11 px-5 rounded-xl font-bold gap-2 text-xs uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
              >
                <Plus className="h-4 w-4" />
                Create Template
              </Button>
            </>
          )}
        </div>
      ) : viewMode === 'list' ? (
        /* ── Table / List View (Table as the direct container) ──────── */
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left border-collapse" role="grid" aria-label="Templates List">
            <thead className="sticky top-0 z-10 bg-[#f8f9fc] dark:bg-[#111827] border-b border-border/60 text-[11px] font-bold text-muted-foreground uppercase tracking-wider shadow-sm">
              <tr>
                <th
                  scope="col"
                  onClick={() => handleHeaderSort('name')}
                  className="py-3.5 px-6 cursor-pointer hover:text-foreground transition-colors"
                  aria-sort={sortField === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Name</span>
                    {sortField === 'name' ? (
                      sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </div>
                </th>
                <th
                  scope="col"
                  onClick={() => handleHeaderSort('version')}
                  className="py-3.5 px-4 cursor-pointer hover:text-foreground transition-colors text-center hidden md:table-cell"
                  aria-sort={sortField === 'version' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Version</span>
                    {sortField === 'version' ? (
                      sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </div>
                </th>
                <th
                  scope="col"
                  onClick={() => handleHeaderSort('shifts')}
                  className="py-3.5 px-4 cursor-pointer hover:text-foreground transition-colors hidden sm:table-cell"
                  aria-sort={sortField === 'shifts' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Structure</span>
                    {sortField === 'shifts' ? (
                      sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </div>
                </th>
                <th scope="col" className="py-3.5 px-4 text-center">
                  Status
                </th>
                <th
                  scope="col"
                  onClick={() => handleHeaderSort('updated')}
                  className="py-3.5 px-6 cursor-pointer hover:text-foreground transition-colors"
                  aria-sort={sortField === 'updated' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <div className="flex items-center gap-1.5">
                    <span>Modified</span>
                    {sortField === 'updated' ? (
                      sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </div>
                </th>
                <th scope="col" className="py-3.5 px-6 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 text-sm">
              {processedTemplates.map((template) => {
                const isSelected = selectedTemplateId === template.id;
                const isPublished = template.status === 'published';
                const isDraft = template.status === 'draft';
                const isArchived = template.status === 'archived';
                const updatedDate = safeDate(template.updatedAt);

                return (
                  <tr
                    key={template.id}
                    tabIndex={0}
                    role="row"
                    aria-selected={isSelected}
                    onClick={() => onSelectTemplate(template.id)}
                    onDoubleClick={() => onOpenTemplate(template.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpenTemplate(template.id);
                      }
                    }}
                    className={cn(
                      'group cursor-pointer transition-colors duration-150 outline-none',
                      isSelected
                        ? 'bg-primary/10 text-foreground'
                        : 'hover:bg-muted/30 dark:hover:bg-white/5'
                    )}
                  >
                    {/* Name & Description */}
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3.5">
                        <div
                          className={cn(
                            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all',
                            isPublished && 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20',
                            isDraft && 'bg-primary/10 text-primary border border-primary/20',
                            isArchived && 'bg-purple-500/10 text-purple-500 border border-purple-500/20'
                          )}
                        >
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground text-sm truncate max-w-[280px] sm:max-w-md group-hover:text-primary transition-colors">
                              {template.name}
                            </span>
                          </div>
                          {template.description ? (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {template.description}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    {/* Version */}
                    <td className="py-4 px-4 text-center hidden md:table-cell">
                      <Badge variant="outline" className="font-mono text-xs px-2 py-0.5">
                        v{template.version}
                      </Badge>
                    </td>

                    {/* Structure */}
                    <td className="py-4 px-4 hidden sm:table-cell">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground font-medium">
                        <span className="inline-flex items-center gap-1">
                          <Layers className="h-3.5 w-3.5 opacity-60" />
                          {template.groupCount}g
                        </span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Users2 className="h-3.5 w-3.5 opacity-60" />
                          {template.subgroupCount}sg
                        </span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-foreground/80">
                          <Clock className="h-3.5 w-3.5 text-primary opacity-80" />
                          {template.shiftCount} shifts
                        </span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-4 px-4 text-center">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border-none',
                          isPublished && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                          isDraft && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                          isArchived && 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                        )}
                      >
                        <div
                          className={cn(
                            'h-1.5 w-1.5 rounded-full mr-1.5 inline-block',
                            isPublished && 'bg-emerald-500',
                            isDraft && 'bg-amber-500',
                            isArchived && 'bg-purple-500'
                          )}
                        />
                        {isPublished ? 'Ready' : isDraft ? 'Draft' : 'Archived'}
                      </Badge>
                    </td>

                    {/* Modified */}
                    <td className="py-4 px-6 text-xs text-muted-foreground whitespace-nowrap">
                      {updatedDate ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="hover:text-foreground transition-colors">
                                {formatDistanceToNow(updatedDate, { addSuffix: true })}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {format(updatedDate, 'PPpp')}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        '—'
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onOpenTemplate(template.id)}
                          aria-label={`Open template ${template.name}`}
                          className="h-8 px-2.5 rounded-lg text-xs font-bold text-primary hover:text-primary hover:bg-primary/10 transition-all opacity-80 group-hover:opacity-100"
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          Open
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => onOpenTemplate(template.id)}>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Open Editor
                            </DropdownMenuItem>

                            {onDuplicateTemplate && (
                              <DropdownMenuItem onClick={() => onDuplicateTemplate(template.id)}>
                                <Copy className="h-4 w-4 mr-2" />
                                Duplicate
                              </DropdownMenuItem>
                            )}

                            {onRenameTemplate && (
                              <DropdownMenuItem onClick={() => handleOpenRename(template)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Rename
                              </DropdownMenuItem>
                            )}

                            {!isArchived ? (
                              <DropdownMenuItem onClick={() => onArchiveTemplate(template.id)}>
                                <Trash2 className="h-4 w-4 mr-2" />
                                Archive
                              </DropdownMenuItem>
                            ) : (
                              onRestoreTemplate && (
                                <DropdownMenuItem onClick={() => onRestoreTemplate(template.id)}>
                                  <RotateCw className="h-4 w-4 mr-2" />
                                  Restore to Draft
                                </DropdownMenuItem>
                              )
                            )}

                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleOpenDelete(template)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Permanently
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Grid / Tile View ───────────────────────────────────────── */
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {processedTemplates.map((template) => {
              const isSelected = selectedTemplateId === template.id;
              const isPublished = template.status === 'published';
              const isDraft = template.status === 'draft';
              const isArchived = template.status === 'archived';
              const updatedDate = safeDate(template.updatedAt);

              return (
                <div
                  key={template.id}
                  tabIndex={0}
                  role="button"
                  aria-selected={isSelected}
                  onClick={() => onSelectTemplate(template.id)}
                  onDoubleClick={() => onOpenTemplate(template.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenTemplate(template.id);
                    }
                  }}
                  className={cn(
                    'group relative rounded-2xl border p-5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-sm outline-none',
                    isSelected
                      ? 'bg-primary/10 border-primary shadow-md ring-1 ring-primary'
                      : 'bg-card/70 border-border/60 hover:bg-card hover:border-primary/40 hover:shadow-md'
                  )}
                >
                  {/* Top Row: Icon + Status + Dropdown */}
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div
                        className={cn(
                          'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all shadow-inner',
                          isPublished && 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20',
                          isDraft && 'bg-primary/10 text-primary border border-primary/20',
                          isArchived && 'bg-purple-500/10 text-purple-500 border border-purple-500/20'
                        )}
                      >
                        <FileText className="h-5 w-5" />
                      </div>

                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border-none',
                            isPublished && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                            isDraft && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                            isArchived && 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                          )}
                        >
                          {isPublished ? 'Ready' : isDraft ? 'Draft' : 'Archived'}
                        </Badge>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => onOpenTemplate(template.id)}>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Open Editor
                            </DropdownMenuItem>

                            {onDuplicateTemplate && (
                              <DropdownMenuItem onClick={() => onDuplicateTemplate(template.id)}>
                                <Copy className="h-4 w-4 mr-2" />
                                Duplicate
                              </DropdownMenuItem>
                            )}

                            {onRenameTemplate && (
                              <DropdownMenuItem onClick={() => handleOpenRename(template)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Rename
                              </DropdownMenuItem>
                            )}

                            {!isArchived ? (
                              <DropdownMenuItem onClick={() => onArchiveTemplate(template.id)}>
                                <Trash2 className="h-4 w-4 mr-2" />
                                Archive
                              </DropdownMenuItem>
                            ) : (
                              onRestoreTemplate && (
                                <DropdownMenuItem onClick={() => onRestoreTemplate(template.id)}>
                                  <RotateCw className="h-4 w-4 mr-2" />
                                  Restore to Draft
                                </DropdownMenuItem>
                              )
                            )}

                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleOpenDelete(template)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Permanently
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {/* Template Name */}
                    <h3 className="font-bold text-foreground text-base line-clamp-1 group-hover:text-primary transition-colors">
                      {template.name}
                    </h3>

                    {template.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                        {template.description}
                      </p>
                    )}
                  </div>

                  {/* Bottom Stats & Action */}
                  <div className="mt-4 pt-3 border-t border-border/40 space-y-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                      <div className="flex items-center gap-2">
                        <span>v{template.version}</span>
                        <span>·</span>
                        <span className="text-foreground font-semibold">
                          {template.shiftCount} shifts
                        </span>
                      </div>

                      <span>{template.groupCount} groups</span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground truncate">
                        {updatedDate ? formatDistanceToNow(updatedDate, { addSuffix: true }) : ''}
                      </span>

                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenTemplate(template.id);
                        }}
                        className="h-8 px-3 rounded-lg text-xs font-bold text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all shadow-sm"
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        Open
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* ── Rename Dialog ───────────────────────────────────────────── */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Rename Template</DialogTitle>
            <DialogDescription>
              Enter a new unique name for this shift template.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rename-input">Template Name</Label>
              <Input
                id="rename-input"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder="e.g., Weekend Standard Setup"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameOpen(false)} disabled={isRenaming}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRename} disabled={isRenaming || !renameName.trim()}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ──────────────────────────────── */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete &ldquo;{deleteTarget?.name}&rdquo;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold"
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TemplateExplorer;
