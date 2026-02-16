// src/components/templates/TemplatesSidebar.tsx
// Templates Sidebar - Matches exact design spec (FIXED, DROP-IN)

import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Lock,
  Unlock,
  MoreVertical,
  Copy,
  Trash2,
  Upload,
  FileText,
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

interface TemplatesSidebarProps {
  templates: Template[];
  selectedTemplateId: string | null;
  onSelectTemplate: (id: string) => void;
  onCreateTemplate: () => void;
  onDuplicateTemplate?: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onOpenPublish: (id: string) => void;
  isLoading?: boolean;
}

type StatusFilter = 'published' | 'draft';

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
  onOpenPublish,
  isLoading = false,
}) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('published');
  const [searchQuery, setSearchQuery] = useState('');

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

  const counts = useMemo(
    () => ({
      draft: templates.filter((t) => t.status === 'draft').length,
      published: templates.filter((t) => t.status === 'published').length,
    }),
    [templates]
  );

  return (
    <div className="flex flex-col h-full bg-card border-r border-border w-[320px]">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Templates</h2>
          <Button size="sm" onClick={onCreateTemplate}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Status Toggle */}
        <div className="flex p-1 bg-muted rounded-lg">
          <button
            onClick={() => setStatusFilter('published')}
            className={cn(
              'flex-1 px-3 py-2 text-sm font-medium rounded-md transition-all',
              statusFilter === 'published'
                ? 'bg-emerald-500/20 text-emerald-500 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <div className="flex items-center justify-center gap-2">
              <Lock className="h-3.5 w-3.5" />
              Published
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {counts.published}
              </Badge>
            </div>
          </button>
          <button
            onClick={() => setStatusFilter('draft')}
            className={cn(
              'flex-1 px-3 py-2 text-sm font-medium rounded-md transition-all',
              statusFilter === 'draft'
                ? 'bg-amber-500/20 text-amber-500 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <div className="flex items-center justify-center gap-2">
              <Unlock className="h-3.5 w-3.5" />
              Draft
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {counts.draft}
              </Badge>
            </div>
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

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
              onSwitchToDraft={() => setStatusFilter('draft')}
            />
          ) : (
            filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isSelected={selectedTemplateId === template.id}
                onClick={() => onSelectTemplate(template.id)}
                onDuplicate={() => onDuplicateTemplate?.(template.id)}
                onDelete={() => onDeleteTemplate(template.id)}
                onPublish={() => onOpenPublish(template.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-border">
        <Button variant="outline" className="w-full" onClick={onCreateTemplate}>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>
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
  onDelete: () => void;
  onPublish: () => void;
}

const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  isSelected,
  onClick,
  onDuplicate,
  onDelete,
  onPublish,
}) => {
  const isPublished = template.status === 'published';

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
              'text-xs px-2 py-0.5',
              isPublished
                ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-500 border-amber-500/30'
            )}
          >
            {isPublished ? (
              <Lock className="h-3 w-3 mr-1" />
            ) : (
              <Unlock className="h-3 w-3 mr-1" />
            )}
            {isPublished ? 'Published' : 'Draft'}
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

              {!isPublished && (
                <DropdownMenuItem onClick={onPublish}>
                  <Upload className="h-4 w-4 mr-2" />
                  Publish
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

      <div className="text-xs text-muted-foreground mb-2">
        Groups: {template.groupCount} | Subgroups: {template.subgroupCount} |
        Shifts: {template.shiftCount}
      </div>

      <div className="text-xs">
        {isPublished && startDate && endDate ? (
          <span className="text-emerald-500">
            Applied: {format(startDate, 'dd MMM yyyy')} –{' '}
            {format(endDate, 'dd MMM yyyy')}
          </span>
        ) : (
          <span className="text-muted-foreground italic">Not applied</span>
        )}
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
        <Lock className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-sm font-medium mb-1">No published templates</p>
        <p className="text-xs text-muted-foreground mb-4">
          Published templates will appear here
        </p>
        <Button variant="outline" size="sm" onClick={onSwitchToDraft}>
          Switch to Drafts
        </Button>
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
