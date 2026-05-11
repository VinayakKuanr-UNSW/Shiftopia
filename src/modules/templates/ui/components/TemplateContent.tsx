import React, { useState, useEffect, useRef } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { RosterGroup } from '@/modules/rosters';
import { Template, Group } from '@/modules/core/types';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';

const ITEM_TYPE = 'TEMPLATE_GROUP';

interface SortableGroupProps {
  group: Group;
  index: number;
  templateId: string | number;
  moveGroup: (dragIndex: number, hoverIndex: number) => void;
  onUpdateGroup: (groupId: string | number, updates: Partial<Group>) => void;
  onDeleteGroup: (groupId: string | number) => void;
  onCloneGroup: (groupId: string | number) => void;
  onAddSubGroup: (groupId: string | number, name: string) => void;
}

const SortableGroup: React.FC<SortableGroupProps> = ({
  group,
  index,
  templateId,
  moveGroup,
  onUpdateGroup,
  onDeleteGroup,
  onCloneGroup,
  onAddSubGroup,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: ITEM_TYPE,
    item: { id: group.id, index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: ITEM_TYPE,
    hover(item: { id: number; index: number }, monitor) {
      if (!ref.current) return;
      const dragIndex = item.index;
      const hoverIndex = index;

      if (dragIndex === hoverIndex) return;

      // Determine rectangle on screen
      const hoverBoundingRect = ref.current?.getBoundingClientRect();
      // Get vertical middle
      const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      // Determine mouse position
      const clientOffset = monitor.getClientOffset();
      // Get pixels to the top
      const hoverClientY = clientOffset!.y - hoverBoundingRect.top;

      // Only perform the move when the mouse has crossed half of the items height
      // When dragging downwards, only move when the cursor is below 50%
      // When dragging upwards, only move when the cursor is above 50%
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;

      moveGroup(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  drag(drop(ref));

  return (
    <div
      ref={ref}
      className={cn('transition-shadow hover:shadow', isDragging && 'opacity-0')}
    >
      <RosterGroup
        group={group}
        templateId={templateId}
        onUpdateGroup={onUpdateGroup}
        onDeleteGroup={onDeleteGroup}
        onCloneGroup={onCloneGroup}
        onAddSubGroup={onAddSubGroup}
        dragHandleProps={{}} // react-dnd handles the whole card or specific handle
      />
    </div>
  );
};

interface Props {
  template: Template;
  onUpdateGroup: (groupId: string | number, updates: Partial<Group>) => void;
  onDeleteGroup: (groupId: string | number) => void;
  onCloneGroup: (groupId: string | number) => void;
  onAddSubGroup: (groupId: string | number, name: string) => void;
  onReorderGroups: (sourceIndex: number, destIndex: number) => void;
}

export default function TemplateContent({
  template,
  onUpdateGroup,
  onDeleteGroup,
  onCloneGroup,
  onAddSubGroup,
  onReorderGroups,
}: Props) {
  const { theme } = useTheme();

  /* ───────────────── Collapse state ───────────────── */
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [allCollapsed, setAllCollapsed] = useState(false);

  /* keep state in sync if groups change */
  useEffect(() => {
    const init: Record<number, boolean> = {};
    template.groups.forEach((g) => {
      init[g.id] = collapsed[g.id] ?? false;
    });
    setCollapsed(init);
  }, [template.groups]); // eslint-disable-line

  useEffect(() => {
    const everyCollapsed = template.groups.every((g) => collapsed[g.id]);
    setAllCollapsed(everyCollapsed);
  }, [collapsed, template.groups]);

  const toggleAll = () => {
    const next = !allCollapsed;
    const map = Object.fromEntries(template.groups.map((g) => [g.id, next]));
    setCollapsed(map);
    setAllCollapsed(next);
  };

  return (
    <Card className="mb-6 transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="truncate">{template.name}</CardTitle>

        {/* Collapse / Expand All */}
        {template.groups.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={toggleAll}
            className="text-muted-foreground"
          >
            {allCollapsed ? (
              <>
                <ChevronRight className="mr-1 h-4 w-4" />
                Expand All
              </>
            ) : (
              <>
                <ChevronDown className="mr-1 h-4 w-4" />
                Collapse All
              </>
            )}
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {template.groups.length === 0 ? (
          <div className="border-2 border-dashed rounded-md p-6 text-center text-muted-foreground">
            No groups yet. Click "Add Group" to get started.
          </div>
        ) : (
          <div className="space-y-6">
            {template.groups.map((group, index) => (
              <SortableGroup
                key={group.id}
                group={group}
                index={index}
                templateId={template.id}
                moveGroup={onReorderGroups}
                onUpdateGroup={onUpdateGroup}
                onDeleteGroup={onDeleteGroup}
                onCloneGroup={onCloneGroup}
                onAddSubGroup={onAddSubGroup}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

