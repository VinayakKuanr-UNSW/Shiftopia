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
}

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
    <div className="flex flex-col h-full bg-transparent w-[320px]">
      {/* Template List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="p-4 rounded-lg border border-border animate-pulse"
              >
                <div className="h-4 bg-muted rounded w-3/4 mb-3" />
                <div className="h-3 bg-muted rounded w-full mb-2" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            ))
          ) : filteredTemplates.length === 0 ? (
            <EmptyState
              statusFilter={statusFilter}
              hasSearch={!!searchQuery}
              onCreateTemplate={onCreateTemplate}
              onSwitchToDraft={() => {}} // Controlled by parent now
            />
          ) : (
            filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isSelected={selectedTemplateId === template.id}
                onClick={() => onSelectTemplate(template.id)}
                onDuplicate={() => onDuplicateTemplate?.(template.id)}
                onRename={() => handleOpenRename(template)}
                onDelete={() => onDeleteTemplate(template.id)}
                onArchive={() => onArchiveTemplate(template.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Rename Dialog */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Rename Template</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">New Name</Label>
              <Input
                id="name"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder="Enter template name..."
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameOpen(false)} disabled={isRenaming}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRename} disabled={isRenaming || !renameName.trim()}>
              {isRenaming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
  const startDate = safeDate(template.startDate);
  const endDate = safeDate(template.endDate);

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-4 rounded-lg cursor-pointer transition-all border',
        isSelected
          ? 'bg-primary/10 border-primary/50 shadow-sm'
          : 'bg-background border-border hover:bg-muted/50 hover:border-muted-foreground/30'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          {(template.organizationName || template.departmentName) && (
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold truncate">
              {[
                template.organizationName,
                template.departmentName,
                template.subDepartmentName
              ].filter(Boolean).join(' › ')}
            </div>
          )}
          <h3 className="font-medium text-sm leading-tight line-clamp-1">
            {template.name}
          </h3>
        </div>

        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] px-1.5 py-0 h-4 border-none flex items-center gap-1',
              isPublished && 'text-emerald-500 bg-emerald-500/10',
              isDraft && 'text-amber-500 bg-amber-500/10',
              isArchived && 'text-purple-500 bg-purple-500/10'
            )}
          >
            <div className={cn(
              "h-1 w-1 rounded-full",
              isPublished && "bg-emerald-500",
              isDraft && "bg-amber-500",
              isArchived && "bg-purple-500"
            )} />
            {template.status.charAt(0).toUpperCase() + template.status.slice(1)}
          </Badge>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </DropdownMenuItem>

              <DropdownMenuItem onClick={onRename}>
                <Pencil className="h-4 w-4 mr-2" />
                Rename
              </DropdownMenuItem>

              {!isArchived && (
                <DropdownMenuItem onClick={onArchive}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Archive
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {template.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
          {template.description}
        </p>
      )}

      <div className="text-xs text-muted-foreground mb-2">
        v{template.version}
      </div>

      <div className="text-xs text-muted-foreground mb-1">
        Groups: {template.groupCount} | Subgroups: {template.subgroupCount} |
        Shifts: {template.shiftCount}
      </div>

      <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        {updatedDate ? (
          <>Updated {formatDistanceToNow(updatedDate, { addSuffix: true })}</>
        ) : (
          <>No update date</>
        )}
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
  onSwitchToDraft: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  statusFilter,
  hasSearch,
  onCreateTemplate,
  onSwitchToDraft,
}) => {
  if (hasSearch) {
    return (
      <div className="p-8 text-center">
        <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          No templates match your search
        </p>
      </div>
    );
  }

  if (statusFilter === 'published') {
    return (
      <div className="p-8 text-center">
        <div className="h-10 w-10 mx-auto mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <Lock className="h-5 w-5 text-emerald-500/50" />
        </div>
        <p className="text-sm font-medium mb-1">No ready templates</p>
        <p className="text-xs text-muted-foreground mb-4">
          Templates marked as 'Ready' will appear here
        </p>
        <Button variant="outline" size="sm" onClick={onSwitchToDraft}>
          View Drafts
        </Button>
      </div>
    );
  }

  if (statusFilter === 'archived') {
    return (
      <div className="p-8 text-center">
        <div className="h-10 w-10 mx-auto mb-3 rounded-full bg-purple-500/10 flex items-center justify-center">
          <Trash2 className="h-5 w-5 text-purple-500/50" />
        </div>
        <p className="text-sm font-medium mb-1">Archive is empty</p>
        <p className="text-xs text-muted-foreground">
          Archived templates are stored here
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 text-center">
      <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
      <p className="text-sm font-medium mb-1">No draft templates yet</p>
      <p className="text-xs text-muted-foreground mb-4">
        Create your first template to get started
      </p>
      <Button size="sm" onClick={onCreateTemplate}>
        <Plus className="h-4 w-4 mr-2" />
        Create Template
      </Button>
    </div>
  );
};

export default TemplatesSidebar;
