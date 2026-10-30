// src/modules/templates/ui/components/TemplateExplorer.tsx
// File-explorer style template list and grid view with double-click open support

import { PageState } from '@/modules/core/ui/components/PageState';
import React, { useState, useMemo } from 'react';
import {
  FileText,
  Search,
  MoreVertical,
  Pencil,
  Copy,
  Archive,
  Trash2,
  RotateCw,
  Clock,
  Layers,
  Users2,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';

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

type SortField = 'name' | 'updated' | 'created' | 'shifts' | 'groups' | 'version';
type SortDirection = 'asc' | 'desc';

interface TemplateExplorerProps {
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
  /** View-only manager (delta, epsilon): open and browse, never change. */
  readOnly?: boolean;
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
  readOnly = false,
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

  const currentSort = { key: sortField, direction: sortDir };
  const onSort = (key: string) => handleHeaderSort(key as SortField);

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
        /* Empty State — one PageState per filter, each with its next step. */
        searchQuery ? (
          <PageState
            state="empty"
            className="flex-1"
            icon={Search}
            title="No matching templates"
            description={<>Nothing matches &ldquo;{searchQuery}&rdquo;. Try a different search or scope.</>}
          />
        ) : statusFilter === 'published' ? (
          <PageState
            state="empty"
            className="flex-1"
            icon={CheckCircle2}
            title="No ready templates"
            description="Templates marked “Ready” are published and locked for roster generation."
            action={onSwitchToDraft ? { label: 'View draft templates', onClick: onSwitchToDraft } : undefined}
          />
        ) : statusFilter === 'archived' ? (
          <PageState
            state="empty"
            className="flex-1"
            icon={Trash2}
            title="Archive is empty"
            description="Archived templates are kept here and can be restored to Draft at any time."
          />
        ) : (
          <PageState
            state="empty"
            className="flex-1"
            icon={FileText}
            title="No draft templates yet"
            description="Create your first shift template to start organising subgroups, shift patterns and roles."
            action={!readOnly && onCreateTemplate ? { label: 'Create template', onClick: onCreateTemplate } : undefined}
          />
        )
      ) : viewMode === 'list' ? (
        /* ── Table / List View (Table as the direct container) ──────── */
        <div className="flex-1 min-h-0 overflow-auto">
          <Table containerClassName="overflow-visible" role="grid" aria-label="Templates List">
            <TableHeader sticky>
              <TableRow>
                <SortableTableHeader sortKey="name" currentSort={currentSort} onSort={onSort}>Name</SortableTableHeader>
                <SortableTableHeader sortKey="version" currentSort={currentSort} onSort={onSort} className="text-center hidden md:table-cell">Version</SortableTableHeader>
                <SortableTableHeader sortKey="shifts" currentSort={currentSort} onSort={onSort} className="hidden sm:table-cell">Structure</SortableTableHeader>
                <TableHead scope="col" className="text-center">
                  Status
                </TableHead>
                <SortableTableHeader sortKey="updated" currentSort={currentSort} onSort={onSort}>Modified</SortableTableHeader>
                <TableHead scope="col" className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processedTemplates.map((template) => {
                const isSelected = selectedTemplateId === template.id;
                const isPublished = template.status === 'published';
                const isDraft = template.status === 'draft';
                const isArchived = template.status === 'archived';
                const updatedDate = safeDate(template.updatedAt);

                return (
                  <TableRow
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
                      'group cursor-pointer outline-none focus-visible:bg-muted/40',
                      isSelected && 'bg-primary/10 hover:bg-primary/10'
                    )}
                  >
                    {/* Name & Description */}
                    <TableCell>
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
                            <span className="font-bold text-foreground text-[13px] truncate max-w-[280px] sm:max-w-md group-hover:text-primary transition-colors">
                              {template.name}
                            </span>
                          </div>
                          {template.description ? (
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                              {template.description}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>

                    {/* Version */}
                    <TableCell className="text-center hidden md:table-cell">
                      <Badge variant="outline" className="font-mono text-[11px] px-2 py-0.5">
                        v{template.version}
                      </Badge>
                    </TableCell>

                    {/* Structure */}
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-medium">
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
                    </TableCell>

                    {/* Status */}
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 border-none',
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
                    </TableCell>

                    {/* Modified */}
                    <TableCell className="text-muted-foreground whitespace-nowrap">
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
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onOpenTemplate(template.id)}
                          aria-label={`Open template ${template.name}`}
                          className="h-8 px-2.5 rounded-lg text-[11px] font-bold text-primary hover:text-primary hover:bg-primary/10 transition-all opacity-80 group-hover:opacity-100"
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

                            {readOnly ? null : !isArchived ? (
                              <DropdownMenuItem onClick={() => onArchiveTemplate(template.id)}>
                                <Archive className="h-4 w-4 mr-2" />
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

                            {!readOnly && (
                            <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleOpenDelete(template)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Permanently
                            </DropdownMenuItem>
                            </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
                            'text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 border-none',
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

                            {readOnly ? null : !isArchived ? (
                              <DropdownMenuItem onClick={() => onArchiveTemplate(template.id)}>
                                <Archive className="h-4 w-4 mr-2" />
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

                            {!readOnly && (
                            <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleOpenDelete(template)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Permanently
                            </DropdownMenuItem>
                            </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {/* Template Name */}
                    <h3 className="font-bold text-foreground text-[14px] line-clamp-1 group-hover:text-primary transition-colors">
                      {template.name}
                    </h3>

                    {template.description && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                        {template.description}
                      </p>
                    )}
                  </div>

                  {/* Bottom Stats & Action */}
                  <div className="mt-4 pt-3 border-t border-border/40 space-y-3">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
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
                        className="h-8 px-3 rounded-lg text-[11px] font-bold text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all shadow-sm"
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
        <DialogContent size="sm">
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
