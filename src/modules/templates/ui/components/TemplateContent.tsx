import React, { useState, useEffect } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from 'react-beautiful-dnd';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { RosterGroup } from '@/modules/rosters';
import { Template, Group } from '@/types';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';

interface Props {
  template: Template;
  onUpdateGroup: (groupId: number, updates: Partial<Group>) => void;
  onDeleteGroup: (groupId: number) => void;
  onCloneGroup: (groupId: number) => void;
  onAddSubGroup: (groupId: number, name: string) => void;
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
  const glassClass =
    theme === 'glass'
      ? 'backdrop-blur-xl bg-black/30 border border-white/20'
      : '';

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

  // inside TemplateContent.tsx, just below the other useEffect
  useEffect(() => {
    // keeps the "Collapse All / Expand All" button label accurate
    const everyCollapsed = template.groups.every((g) => collapsed[g.id]);
    setAllCollapsed(everyCollapsed);
  }, [collapsed, template.groups]);

  const toggleGroup = (id: number) =>
    setCollapsed((p) => ({ ...p, [id]: !p[id] }));

  const toggleAll = () => {
    const next = !allCollapsed;
    const map = Object.fromEntries(template.groups.map((g) => [g.id, next]));
    setCollapsed(map);
    setAllCollapsed(next);
  };

  /* ───────────────── DnD ───────────────── */
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;
    onReorderGroups(result.source.index, result.destination.index);
  };

  return (
    <Card className={cn(glassClass, 'mb-6 transition-shadow hover:shadow-md')}>
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
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="groups-droppable">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="space-y-6"
                >
                  {template.groups.map((group, index) => (
                    <Draggable
                      key={group.id}
                      draggableId={String(group.id)}
                      index={index}
                    >
                      {(drag) => (
                        <div
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          className="transition-shadow hover:shadow"
                        >
                          <RosterGroup
                            group={group}
                            templateId={template.id}
                            onUpdateGroup={onUpdateGroup}
                            onDeleteGroup={onDeleteGroup}
                            onCloneGroup={onCloneGroup}
                            onAddSubGroup={onAddSubGroup}
                            dragHandleProps={drag.dragHandleProps}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </CardContent>
    </Card>
  );
}
