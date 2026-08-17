// src/components/templates/TemplatesSidebar.tsx
// Templates Sidebar - Matches exact design spec (FIXED, DROP-IN)

import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Lock,
  Unlock,
  MoreVertical,
  Pencil,
  Copy,
  Trash2,
  Upload,
  FileText,
  Loader2,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Badge } from '@/modules/core/ui/primitives/badge';
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
import { Label } from '@/modules/core/ui/primitives/label';
import { cn } from '@/modules/core/lib/utils';
import { format, formatDistanceToNow, isValid } from 'date-fns';

/* ============================================================
   TYPES
   ============================================================ */
interface Template {
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
  publishedAt?: string | null;
  organizationName?: string;
  departmentName?: string;
  subDepartmentName?: string;
}

type StatusFilter = 'published' | 'draft' | 'archived';

interface TemplatesSidebarProps {
  templates: Template[];
  selectedTemplateId: string | null;
  onSelectTemplate: (id: string) => void;
  onCreateTemplate: () => void;
  onDuplicateTemplate?: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onRenameTemplate?: (id: string, name: string) => Promise<boolean>;
  onArchiveTemplate: (id: string) => void;
  isLoading?: boolean;
  statusFilter: StatusFilter;
  searchQuery: string;
  /** Escape hatch from an empty Ready/Archive list. */
  onSwitchToDraft?: () => void;
}

const STATUS_LABEL: Record<StatusFilter, string> = {
  published: 'Ready',
  draft: 'Draft',
  archived: 'Archived',
};

/* ============================================================
   HELPERS
   ============================================================ */
function safeDate(input?: string | null): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return isValid(d) ? d : null;
}

/* ============================================================
   COMPONENT
   ============================================================ */
export const TemplatesSidebar: React.FC<TemplatesSidebarProps> = ({
  templates,
  selectedTemplateId,
  onSelectTemplate,
  onCreateTemplate,
  onDuplicateTemplate,
  onDeleteTemplate,
  onRenameTemplate,
  onArchiveTemplate,
  isLoading = false,
  statusFilter,
  searchQuery,
  onSwitchToDraft,
}) => {
  // Rename Dialog State
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  const filteredTemplates = useMemo(() => {
    let result = templates.filter((t) => t.status === statusFilter);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query)
      );
    }

    result.sort((a, b) => {
      const dateA =
        statusFilter === 'published'
          ? a.publishedAt || a.updatedAt
          : a.updatedAt;
      const dateB =
        statusFilter === 'published'
          ? b.publishedAt || b.updatedAt
          : b.updatedAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    return result;
  }, [templates, statusFilter, searchQuery]);

  const handleOpenRename = (template: Template) => {
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

  return (
    <div className="flex flex-col h-full bg-transparent w-full md:w-[320px]">
      {/* Template List */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading ? (
            <div className="space-y-2" role="status">
              <span className="sr-only">Loading templates…</span>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="p-4 rounded-lg border border-border animate-pulse"
                  aria-hidden="true"
                >
                  <div className="h-4 bg-muted rounded w-3/4 mb-3" />
                  <div className="h-3 bg-muted rounded w-full mb-2" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : filteredTemplates.length === 0 ? (
            <EmptyState
              statusFilter={statusFilter}
              hasSearch={!!searchQuery}
              onCreateTemplate={onCreateTemplate}
              onSwitchToDraft={onSwitchToDraft}
            />
          ) : (
            /* A real list, so a screen reader announces "3 of 7" while arrowing
               through instead of reading seven unrelated blocks of text. */
            <ul
              className="space-y-2"
              aria-label={`${STATUS_LABEL[statusFilter]} templates`}
            >
              {filteredTemplates.map((template) => (
                <li key={template.id}>
                  <TemplateCard
                    template={template}
                    isSelected={selectedTemplateId === template.id}
                    onClick={() => onSelectTemplate(template.id)}
                    onDuplicate={() => onDuplicateTemplate?.(template.id)}
                    onRename={() => handleOpenRename(template)}
                    onDelete={() => onDeleteTemplate(template.id)}
                    onArchive={() => onArchiveTemplate(template.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>

      {/* Rename Dialog */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Rename Template</DialogTitle>
            <DialogDescription>
              Enter a new name for this template.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              {/* Was id="name" — generic enough to collide with any other form
                  mounted at the same time, which silently breaks both labels. */}
              <Label htmlFor="rename-template-name">New Name</Label>
              <Input
                id="rename-template-name"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder="Enter template name..."
                autoFocus
                // text-base under sm keeps iOS from zooming the page on focus.
                className="h-11 min-h-[44px] text-base sm:text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setIsRenameOpen(false)}
              disabled={isRenaming}
              className="h-11 min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmRename}
              disabled={isRenaming || !renameName.trim()}
              className="h-11 min-h-[44px]"
            >
              {isRenaming && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* ============================================================
   TEMPLATE CARD
   ============================================================ */
interface TemplateCardProps {
  template: Template;
  isSelected: boolean;
  onClick: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onArchive: () => void;
}

/**
 * Selecting a template was a bare `<div onClick>` — no role, no tab stop, no
 * name, no pressed state. It could not be reached by keyboard or switch control
 * at all (WCAG 2.1.1), and a screen reader read it as a wall of loose text.
 *
 * It is now a real <button> that fills the card, with the row menu as a SIBLING
 * rather than a nested control: a button inside a button is invalid HTML that
 * browsers silently un-nest, and the previous `stopPropagation` wrapper only
 * papered over the mouse half of the problem.
 */
const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  isSelected,
  onClick,
  onDuplicate,
  onRename,
  onDelete,
  onArchive,
}) => {
  const isPublished = template.status === 'published';
  const isArchived = template.status === 'archived';
  const isDraft = template.status === 'draft';

  const updatedDate = safeDate(template.updatedAt);
  const statusLabel = template.status.charAt(0).toUpperCase() + template.status.slice(1);
  const scopePath = [
    template.organizationName,
    template.departmentName,
    template.subDepartmentName,
  ].filter(Boolean).join(' › ');

  return (
    <div
      className={cn(
        'relative rounded-lg transition-all border',
        isSelected
          ? 'bg-primary/10 border-primary/50 shadow-sm'
          : 'bg-background border-border hover:bg-muted/50 hover:border-muted-foreground/30'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        // Marks which template the editor is currently showing — the visual
        // highlight alone conveyed that to sighted users only.
        aria-current={isSelected ? 'true' : undefined}
        className={cn(
          'w-full text-left p-4 pr-14 rounded-lg',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1'
        )}
      >
        {scopePath && (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold truncate mb-1">
            {scopePath}
          </div>
        )}

        <div className="flex items-center gap-2 mb-2 min-w-0">
          <h3 className="font-semibold text-sm leading-tight line-clamp-1 min-w-0">
            {template.name}
          </h3>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] px-1.5 py-0 h-4 border-none flex items-center gap-1 shrink-0',
              isPublished && 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
              isDraft && 'text-amber-700 dark:text-amber-400 bg-amber-500/10',
              isArchived && 'text-purple-700 dark:text-purple-400 bg-purple-500/10'
            )}
          >
            <span className={cn(
              "h-1 w-1 rounded-full",
              isPublished && "bg-emerald-500",
              isDraft && "bg-amber-500",
              isArchived && "bg-purple-500"
            )} aria-hidden="true" />
            {statusLabel}
          </Badge>
        </div>

        {template.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {template.description}
          </p>
        )}

        {/* One sentence instead of four fragments and a pile of pipes, which a
            screen reader reads out character by character. */}
        <p className="text-xs text-muted-foreground">
          Version {template.version} · {template.groupCount} groups,{' '}
          {template.subgroupCount} subgroups, {template.shiftCount} shifts
        </p>

        <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
          {updatedDate
            ? `Updated ${formatDistanceToNow(updatedDate, { addSuffix: true })}`
            : 'No update date'}
        </p>
      </button>

      {/* Sibling of the select button, positioned over its reserved pr-14 gutter. */}
      <div className="absolute right-2 top-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${template.name}`}
              className="h-11 w-11 min-h-[44px] min-w-[44px] p-0 text-muted-foreground hover:text-foreground"
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="h-4 w-4 mr-2" aria-hidden="true" />
              Duplicate
            </DropdownMenuItem>

            <DropdownMenuItem onClick={onRename}>
              <Pencil className="h-4 w-4 mr-2" aria-hidden="true" />
              Rename
            </DropdownMenuItem>

            {!isArchived && (
              <DropdownMenuItem onClick={onArchive}>
                <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                Archive
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

/* ============================================================
   EMPTY STATE
   ============================================================ */
interface EmptyStateProps {
  statusFilter: StatusFilter;
  hasSearch: boolean;
  onCreateTemplate: () => void;
  onSwitchToDraft?: () => void;
}

/** Shared 44px sizing — an empty state's one action is the worst place to
 *  under-size a tap target, since it is the only thing on screen to hit. */
const EMPTY_ACTION_CLS = 'mt-4 h-11 min-h-[44px] px-4 font-semibold';

const EmptyState: React.FC<EmptyStateProps> = ({
  statusFilter,
  hasSearch,
  onCreateTemplate,
  onSwitchToDraft,
}) => {
  if (hasSearch) {
    return (
      <div className="p-8 text-center" role="status">
        <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          No templates match your search
        </p>
      </div>
    );
  }

  if (statusFilter === 'published') {
    return (
      <div className="p-8 text-center" role="status">
        <div className="h-10 w-10 mx-auto mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <Lock className="h-5 w-5 text-emerald-500/50" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium mb-1">No ready templates</p>
        <p className="text-xs text-muted-foreground">
          Templates marked as 'Ready' will appear here
        </p>
        {onSwitchToDraft && (
          <Button variant="outline" onClick={onSwitchToDraft} className={EMPTY_ACTION_CLS}>
            View Drafts
          </Button>
        )}
      </div>
    );
  }

  if (statusFilter === 'archived') {
    return (
      <div className="p-8 text-center" role="status">
        <div className="h-10 w-10 mx-auto mb-3 rounded-full bg-purple-500/10 flex items-center justify-center">
          <Trash2 className="h-5 w-5 text-purple-500/50" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium mb-1">Archive is empty</p>
        <p className="text-xs text-muted-foreground">
          Archived templates are stored here
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 text-center" role="status">
      <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm font-medium mb-1">No draft templates yet</p>
      <p className="text-xs text-muted-foreground">
        Create your first template to get started
      </p>
      <Button onClick={onCreateTemplate} className={EMPTY_ACTION_CLS}>
        <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
        Create Template
      </Button>
    </div>
  );
};

export default TemplatesSidebar;
