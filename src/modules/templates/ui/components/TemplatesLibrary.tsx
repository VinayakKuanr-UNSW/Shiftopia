
// TemplatesLibrary.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import {
  MoreVertical,
  Pencil,
  Copy,
  Trash,
  Calendar,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Search,
} from 'lucide-react';
import { Card, CardContent } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { Template, Shift } from '@/types';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';

/* ---------- props ---------- */

interface DateRange {
  start: Date;
  end: Date;
}

interface TemplatesLibraryProps {
  initialTemplates: Template[];
  currentTemplateId: number | string | null;
  onSelectTemplate: (templateId: number | string) => void;
  onDelete: (templateId: string) => Promise<void>;
  onDuplicate: (templateId: string) => Promise<void>;
  onBulkShiftUpdate: (
    shiftIds: string[],
    updates: Partial<Shift>
  ) => Promise<void>;
}

/* ---------- Template card (with DnD & checkbox) ---------- */

const TemplateItem = ({
  template,
  index,
  moveTemplate,
  selected,
  isActive,
  onCardSelect,
  onCheckboxChange,
  onAction,
}: any) => {
  const ref = useRef<HTMLDivElement | null>(null);

  /* DnD */
  const [{ isDragging }, drag] = useDrag({
    type: 'TEMPLATE',
    item: { id: template.id, index },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });
  const [, drop] = useDrop({
    accept: 'TEMPLATE',
    hover(item: any) {
      if (!ref.current) return;
      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) return;
      moveTemplate(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });
  drag(drop(ref));

  return (
    <div
      ref={ref}
      onClick={() => onCardSelect(template.id)}
      className={cn(
        'relative p-4 mb-3 rounded-lg border transition-all cursor-pointer',
        isActive
          ? 'border-primary bg-primary/10 ring-2 ring-primary/20'
          : selected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card hover:bg-muted/50',
        isDragging && 'opacity-50',
        'pl-10'
      )}
    >
      {/* checkbox (always visible) */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2">
        <Checkbox
          checked={selected}
          onCheckedChange={(val) => onCheckboxChange(template, val as boolean)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <div className="flex items-start justify-between">
        {/* name + badge */}
        <div className="flex-1 mr-2">
          <div className="flex items-center">
            <h3 className="font-medium text-base">{template.name}</h3>
            <Badge
              variant={
                template.status === 'published' ? 'default' : 'secondary'
              }
              className="ml-2 capitalize"
            >
              {template.status}
            </Badge>
          </div>
          <div className="flex items-center mt-1 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 mr-1" />
            <span>{format(new Date(template.createdAt), 'MMM d, yyyy')}</span>
          </div>
        </div>

        {/* drag handle + menu */}
        <div className="flex items-center">
          <GripVertical
            className="h-5 w-5 cursor-move text-muted-foreground mr-2"
            onMouseDown={(e) => e.stopPropagation()}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAction('rename', template.id)}>
                <Pencil className="h-4 w-4 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction('clone', template.id)}>
                <Copy className="h-4 w-4 mr-2" />
                Clone
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onAction('delete', template.id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
};

/* ---------- Main component ---------- */

const TemplatesLibrary: React.FC<TemplatesLibraryProps> = ({
  initialTemplates,
  currentTemplateId,
  onSelectTemplate,
  onDelete,
  onDuplicate,
}) => {
  /* state */
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeList, setActiveList] = useState<'published' | 'draft' | null>(
    null
  ); // keeps track of which list is selected

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<
    'all' | 'published' | 'draft'
  >('all');
  const [sortBy, setSortBy] = useState<
    'name-asc' | 'name-desc' | 'newest' | 'oldest'
  >('newest');

  const [showPublished, setShowPublished] = useState(true);
  const [showDrafts, setShowDrafts] = useState(true);

  /* dialogs */
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { toast } = useToast();

  /* load initial */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTemplates(initialTemplates);
      setIsLoading(false);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [initialTemplates]);

  /* helpers: filter + sort */
  const filtered = templates
    .filter((t) => {
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (
        searchQuery &&
        !t.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'newest':
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        case 'oldest':
          return (
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        default:
          return 0;
      }
    });

  const published = filtered.filter((t) => t.status === 'published');
  const drafts = filtered.filter((t) => t.status === 'draft');

  /* drag reorder */
  const moveTemplate = useCallback((dragIdx: number, hoverIdx: number) => {
    setTemplates((prev) => {
      const arr = [...prev];
      const [removed] = arr.splice(dragIdx, 1);
      arr.splice(hoverIdx, 0, removed);
      return arr;
    });
  }, []);

  /* selection logic */
  const selectList = (listType: 'published' | 'draft') => {
    if (activeList && activeList !== listType) {
      setSelectedIds([]);
    }
    setActiveList(listType);
  };

  const handleCheckboxChange = (template: Template, checked: boolean) => {
    selectList(template.status as 'published' | 'draft');
    setSelectedIds((prev) =>
      checked ? [...prev, String(template.id)] : prev.filter((id) => id !== String(template.id))
    );
  };

  const handleSelectAll = (listType: 'published' | 'draft') => {
    selectList(listType);
    const ids = (listType === 'published' ? published : drafts).map(
      (t) => String(t.id)
    );
    const isAllSelected = ids.every((id) => selectedIds.includes(id));
    setSelectedIds(isAllSelected ? [] : ids);
  };

  /* bulk actions */
  const bulkDelete = async () => {
    await Promise.all(selectedIds.map((id) => onDelete(id)));
    setTemplates((prev) => prev.filter((t) => !selectedIds.includes(String(t.id))));
    setSelectedIds([]);
    toast({ title: 'Templates deleted' });
  };

  const bulkClone = async () => {
    const originals = templates.filter((t) => selectedIds.includes(String(t.id)));
    for (const t of originals) await onDuplicate(String(t.id));
    const clones: Template[] = originals.map((o) => ({
      ...o,
      id: Date.now() + Math.random(),
      name: `${o.name} (COPY)`,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    setTemplates((prev) => [...prev, ...clones]);
    setSelectedIds([]);
    toast({ title: 'Templates cloned' });
  };

  /* card actions */
  const cardAction = (action: string, id: string | number) => {
    const idStr = String(id);
    switch (action) {
      case 'rename':
        setRenameTarget(idStr);
        setRenameVal(templates.find((t) => String(t.id) === idStr)?.name ?? '');
        setIsRenameOpen(true);
        break;
      case 'clone':
        setSelectedIds([idStr]);
        bulkClone();
        break;
      case 'delete':
        setDeleteTarget(idStr);
        setIsDeleteOpen(true);
        break;
      default:
        break;
    }
  };

  const handleCardSelect = (templateId: number | string) => {
    onSelectTemplate(templateId);
  };

  const confirmRename = () => {
    if (!renameTarget) return;
    setTemplates((prev) =>
      prev.map((t) => (String(t.id) === renameTarget ? { ...t, name: renameVal } : t))
    );
    toast({ title: 'Template renamed' });
    setIsRenameOpen(false);
    setRenameTarget(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await onDelete(deleteTarget);
    setTemplates((prev) => prev.filter((t) => String(t.id) !== deleteTarget));
    toast({ title: 'Template deleted' });
    setIsDeleteOpen(false);
    setDeleteTarget(null);
  };

  /* UI */
  return (
    <DndProvider backend={HTML5Backend}>
      <div className="flex flex-col h-full">
        {/* top bar */}
        <div className="p-4 border-b border-border">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {/* sort & filter */}
            <div className="flex gap-2">
              <Select value={sortBy} onValueChange={setSortBy as any}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name-asc">Name A → Z</SelectItem>
                  <SelectItem value="name-desc">Name Z → A</SelectItem>
                  <SelectItem value="newest">Newest Created</SelectItem>
                  <SelectItem value="oldest">Oldest Created</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filterStatus}
                onValueChange={setFilterStatus as any}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* bulk bar */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-3 mt-3 p-2 bg-muted/50 rounded-md">
              <span className="text-sm">
                {selectedIds.length} selected ({activeList})
              </span>
              <Button size="sm" variant="outline" onClick={bulkDelete}>
                <Trash className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
              <Button size="sm" variant="outline" onClick={bulkClone}>
                <Copy className="h-3.5 w-3.5 mr-1" />
                Clone
              </Button>
            </div>
          )}
        </div>

        {/* list area */}
        <div className="flex-1 overflow-auto p-4">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* published */}
              <Section
                title="Published Templates"
                open={showPublished}
                toggle={() => setShowPublished(!showPublished)}
                templates={published}
                listType="published"
                startIndex={0}
                selectedIds={selectedIds}
                currentTemplateId={currentTemplateId}
                moveTemplate={moveTemplate}
                onCheckboxChange={handleCheckboxChange}
                onCardSelect={handleCardSelect}
                onAction={cardAction}
                onSelectAll={handleSelectAll}
              />

              {/* drafts */}
              <Section
                title="Draft Templates"
                open={showDrafts}
                toggle={() => setShowDrafts(!showDrafts)}
                templates={drafts}
                listType="draft"
                startIndex={published.length}
                selectedIds={selectedIds}
                currentTemplateId={currentTemplateId}
                moveTemplate={moveTemplate}
                onCheckboxChange={handleCheckboxChange}
                onCardSelect={handleCardSelect}
                onAction={cardAction}
                onSelectAll={handleSelectAll}
              />
            </div>
          )}
        </div>

        {/* rename dialog */}
        <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="rn">New name</Label>
              <Input
                id="rn"
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRenameOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!renameVal.trim()} onClick={confirmRename}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* delete dialog */}
        <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Template</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. Continue?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={confirmDelete}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DndProvider>
  );
};

/* ---------- Section component with Select‑All ---------- */

const Section = ({
  title,
  open,
  toggle,
  templates,
  listType,
  startIndex,
  selectedIds,
  currentTemplateId,
  moveTemplate,
  onCheckboxChange,
  onCardSelect,
  onAction,
  onSelectAll,
}: any) => {
  const allIds = templates.map((t: Template) => String(t.id));
  const isAllSelected =
    allIds.length > 0 && allIds.every((id: string) => selectedIds.includes(id));

  return (
    <div>
      <button
        onClick={toggle}
        className="flex items-center gap-1 text-xl font-semibold select-none"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {title}
        {/* select‑all checkbox */}
        {open && (
          <Checkbox
            checked={isAllSelected}
            onCheckedChange={() => onSelectAll(listType)}
            className="ml-2"
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {templates.length === 0 ? (
            <Card className="bg-muted/30">
              <CardContent className="p-4 text-center text-muted-foreground">
                No templates in this section
              </CardContent>
            </Card>
          ) : (
            templates.map((t: Template, idx: number) => (
              <TemplateItem
                key={t.id}
                template={t}
                index={idx + startIndex}
                moveTemplate={moveTemplate}
                selected={selectedIds.includes(String(t.id))}
                isActive={currentTemplateId !== null && t.id === currentTemplateId}
                onCardSelect={onCardSelect}
                onCheckboxChange={onCheckboxChange}
                onAction={onAction}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default TemplatesLibrary;
