// src/components/templates/TemplateEditor.tsx
import React, { useState, useMemo } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Plus,
  Users,
  Building2,
  LayoutGrid,
  Theater,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Separator } from '@/modules/core/ui/primitives/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/modules/core/ui/primitives/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import {
  Template,
  Group,
  SubGroup,
  TemplateShift,
  getTemplateStats,
} from '../../model/templates.types';
import { AddSubGroupDialog } from '@/modules/rosters/ui/dialogs/AddSubGroupDialog';
import { hasFixedSubgroup, OFFICE_SUBGROUP_NAME } from '@/modules/rosters/domain/subgroupRules';
import { EditSubGroupDialog } from '@/modules/rosters/ui/dialogs/EditSubGroupDialog';
import ShiftCard from './ShiftCard';
import { EnhancedAddShiftModal } from '@/modules/rosters';
import { TemplateGroupCard } from './editor/TemplateGroupCard';
import { TemplateSubgroupCard } from './editor/TemplateSubgroupCard';
import { TemplateHeader } from './TemplateHeader';

interface TemplateEditorProps {
  template: Template;
  /** View-only manager (delta, epsilon): the editor shows, nothing changes. */
  readOnly?: boolean;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  onBack: () => void;
  onDiscardChanges: () => void;
  onSaveChanges: () => Promise<boolean>;
  onUpdateStatus: (id: string, status: string) => Promise<boolean>;
  onUpdateGroup: (groupId: string | number, updates: Partial<Group>) => void;
  onAddSubgroup: (groupId: string | number, name: string) => void;
  onUpdateSubgroup: (
    groupId: string | number,
    subgroupId: string | number,
    updates: Partial<SubGroup>
  ) => void;
  onDeleteSubgroup: (
    groupId: string | number,
    subgroupId: string | number
  ) => void;
  onCloneSubgroup: (
    groupId: string | number,
    subgroupId: string | number
  ) => void;
  onAddShift: (
    groupId: string | number,
    subgroupId: string | number,
    shift: Partial<TemplateShift>
  ) => void;
  onUpdateShift: (
    groupId: string | number,
    subgroupId: string | number,
    shiftId: string | number,
    updates: Partial<TemplateShift>
  ) => void;
  onDeleteShift: (
    groupId: string | number,
    subgroupId: string | number,
    shiftId: string | number
  ) => void;
}

const GROUP_CONFIG: Record<
  string,
  {
    icon: React.ReactNode;
    gradient: string;
    border: string;
    badge: string;
  }
> = {
  'Convention Centre': {
    icon: <Building2 className="h-5 w-5" />,
    gradient: 'from-blue-600/20 via-blue-500/10 to-transparent',
    border: 'border-blue-500/30',
    badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
  'Exhibition Centre': {
    icon: <LayoutGrid className="h-5 w-5" />,
    gradient: 'from-emerald-600/20 via-emerald-500/10 to-transparent',
    border: 'border-emerald-500/30',
    badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  },
  Theatre: {
    icon: <Theater className="h-5 w-5" />,
    gradient: 'from-red-600/20 via-red-500/10 to-transparent',
    border: 'border-red-500/30',
    badge: 'bg-red-500/20 text-red-400 border-red-500/30',
  },
};

const TemplateEditor: React.FC<TemplateEditorProps> = ({
  template,
  isSaving,
  hasUnsavedChanges,
  onBack,
  onDiscardChanges,
  onSaveChanges,
  onUpdateGroup,
  onAddSubgroup,
  onUpdateSubgroup,
  onDeleteSubgroup,
  onCloneSubgroup,
  onAddShift,
  onUpdateShift,
  onDeleteShift,
  onUpdateStatus,
  readOnly = false,
}) => {
  const isPublished = template.status === 'published';
  const isArchived = template.status === 'archived';
  const isDraft = template.status === 'draft';
  const isReadOnly = readOnly || isPublished || isArchived;

  // Collapse states
  const [expandedGroups, setExpandedGroups] = useState<Set<string | number>>(
    new Set(template.groups.map((g) => g.id))
  );
  const [expandedSubgroups, setExpandedSubgroups] = useState<Set<string>>(
    new Set()
  );

  // Dialog states
  const [addSubGroupOpen, setAddSubGroupOpen] = useState(false);
  const [addSubGroupTarget, setAddSubGroupTarget] = useState<
    string | number | null
  >(null);
  const [editSubGroupOpen, setEditSubGroupOpen] = useState(false);
  const [editSubGroupTarget, setEditSubGroupTarget] = useState<{
    groupId: string | number;
    subGroup: SubGroup;
  } | null>(null);

  // Helper to get group name
  const getTargetGroupName = () => {
    if (!addSubGroupTarget) return '';
    const group = template.groups.find(g => g.id === addSubGroupTarget);
    return group ? group.name : '';
  };

  // Shift modal states
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [shiftModalContext, setShiftModalContext] = useState<{
    groupId: string | number;
    groupName: string;
    groupColor: string;
    subGroupId: string | number;
    subGroupName: string;
    editShift?: TemplateShift;
  } | null>(null);

  // Template stats
  const stats = useMemo(() => getTemplateStats(template), [template]);

  // Last saved info
  const lastSavedAgo = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(template.updatedAt), {
        addSuffix: true,
      });
    } catch {
      return 'unknown';
    }
  }, [template.updatedAt]);

  const toggleGroup = (id: string | number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSubgroup = (key: string) => {
    setExpandedSubgroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getGroupColor = (groupName: string): string => {
    const colorMap: Record<string, string> = {
      'Convention Centre': 'blue',
      'Exhibition Centre': 'green',
      Theatre: 'red',
      'The Cutaway': 'amber',
      Office: 'cyan',
    };
    return colorMap[groupName] || 'blue';
  };

  const openAddShiftModal = (group: Group, subGroup: SubGroup) => {
    if (isReadOnly) return;
    setShiftModalContext({
      groupId: group.id,
      groupName: group.name,
      groupColor: getGroupColor(group.name),
      subGroupId: subGroup.id,
      subGroupName: subGroup.name,
    });
    setShiftModalOpen(true);
  };

  const openEditShiftModal = (
    group: Group,
    subGroup: SubGroup,
    shift: TemplateShift
  ) => {
    if (isReadOnly) return;
    setShiftModalContext({
      groupId: group.id,
      groupName: group.name,
      groupColor: getGroupColor(group.name),
      subGroupId: subGroup.id,
      subGroupName: subGroup.name,
      editShift: shift,
    });
    setShiftModalOpen(true);
  };

  const handleShiftModalSave = (shiftData: any) => {
    console.log('[TemplateEditor] handleShiftModalSave received:', shiftData);
    if (!shiftModalContext) return;

    const { groupId, subGroupId, editShift } = shiftModalContext;

    const shiftPayload: Partial<TemplateShift> = {
      name: shiftData.name || shiftData.roleName || 'New Shift',
      roleId: shiftData.role_id || shiftData.roleId,
      roleName: shiftData.roleName,
      remunerationLevel: shiftData.remunerationLevel || shiftData.remuneration_level || null,
      remunerationLevelName: shiftData.remunerationLevelName || shiftData.remuneration_level_name || null,
      startTime: shiftData.start_time || shiftData.startTime,
      endTime: shiftData.end_time || shiftData.endTime,
      paidBreakDuration: shiftData.paid_break_minutes || shiftData.paidBreakDuration || 0,
      unpaidBreakDuration: shiftData.unpaid_break_minutes || shiftData.unpaidBreakDuration || 0,
      skills: shiftData.skills || [],
      licenses: shiftData.licenses || [],
      siteTags: shiftData.siteTags || [],
      eventTags: shiftData.eventTags || [],
      notes: shiftData.notes,
      // Employee assignment - CRITICAL!
      assignedEmployeeId: shiftData.assigned_employee_id || shiftData.assignedEmployeeId || null,
      assignedEmployeeName: shiftData.assignedEmployeeName || null,
      // NOT NULL in the database with no default. The modal already requires it
      // (a zod enum), so dropping it here was what made every new template shift
      // fail to save with a 400 once the column became mandatory.
      targetEmploymentType:
        // No guessed fallback ('FT' or 'Casual'). Templates cannot hold FT rows
        // (`enforce_no_ft_template_shifts`), and inventing 'Casual' silently
        // re-typed shifts whose target was lost upstream. The modal's zod enum
        // guarantees a value; if it is ever missing, the NOT NULL column makes
        // the save fail loudly rather than persist a made-up target.
        shiftData.target_employment_type ?? shiftData.targetEmploymentType ?? editShift?.targetEmploymentType ?? null,
      targetRequiresFlexible:
        shiftData.target_requires_flexible ?? shiftData.targetRequiresFlexible ?? false,
      dayOfWeek:
        shiftData.day_of_week !== undefined
          ? shiftData.day_of_week
          : shiftData.dayOfWeek !== undefined
            ? shiftData.dayOfWeek
            : editShift?.dayOfWeek !== undefined
              ? editShift.dayOfWeek
              : null,
    };

    console.log('[TemplateEditor] shiftPayload to save:', shiftPayload);

    if (editShift) {
      console.log('[TemplateEditor] Updating shift:', editShift.id);
      onUpdateShift(groupId, subGroupId, editShift.id, shiftPayload);
    } else {
      console.log('[TemplateEditor] Adding new shift');
      onAddShift(groupId, subGroupId, shiftPayload);
    }

    setShiftModalOpen(false);
    setShiftModalContext(null);
  };

  const handleAddSubGroup = (name: string) => {
    if (addSubGroupTarget !== null) {
      onAddSubgroup(addSubGroupTarget, name);
    }
    setAddSubGroupTarget(null);
  };

  const handleEditSubGroup = (name: string) => {
    if (editSubGroupTarget) {
      onUpdateSubgroup(
        editSubGroupTarget.groupId,
        editSubGroupTarget.subGroup.id,
        { name }
      );
    }
    setEditSubGroupTarget(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {/* REDESIGNED HEADER */}
      <TemplateHeader
        template={template}
        stats={stats}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={isSaving}
        lastSavedAgo={lastSavedAgo}
        onBack={onBack}
        onSave={onSaveChanges}
        onDiscard={onDiscardChanges}
        onArchive={() => onUpdateStatus(String(template.id), 'archived')}
        onDownload={() => console.log('[TemplateEditor] Download requested')}
        onUpdateStatus={(status) => onUpdateStatus(String(template.id), status)}
        readOnly={readOnly}
      />

      {/* Groups Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 sm:p-6 space-y-4">
          {template.groups.map((group) => (
            <TemplateGroupCard
              key={String(group.id)}
              group={group}
              isExpanded={expandedGroups.has(group.id)}
              onToggleExpand={() => toggleGroup(group.id)}
              // Office has one fixed sub-group, as on the roster: nothing to add.
              onAddSubgroup={hasFixedSubgroup(group.name) ? undefined : () => {
                if (isReadOnly) return;
                setAddSubGroupTarget(group.id);
                setAddSubGroupOpen(true);
              }}
              note={hasFixedSubgroup(group.name) ? `Always one sub-group, ${OFFICE_SUBGROUP_NAME}, matching the roster.` : undefined}
              renderSubgroups={(grp) =>
                grp.subGroups.map((subGroup) => {
                  const subKey = `${grp.id}-${subGroup.id}`;
                  return (
                    <TemplateSubgroupCard
                      key={String(subGroup.id)}
                      subgroup={subGroup}
                      groupColor={getGroupColor(grp.name)}
                      isExpanded={expandedSubgroups.has(subKey)}
                      onToggleExpand={() => toggleSubgroup(subKey)}
                      isFixed={hasFixedSubgroup(grp.name)}
                      onUpdateName={
                        !isReadOnly && !hasFixedSubgroup(grp.name)
                          ? (name) => onUpdateSubgroup(grp.id, subGroup.id, { name })
                          : undefined
                      }
                      onDelete={
                        !isReadOnly && !hasFixedSubgroup(grp.name)
                          ? () => onDeleteSubgroup(grp.id, subGroup.id)
                          : undefined
                      }
                      onClone={
                        !isReadOnly && !hasFixedSubgroup(grp.name)
                          ? () => onCloneSubgroup(grp.id, subGroup.id)
                          : undefined
                      }
                      onAddShift={
                        !isReadOnly
                          ? () => openAddShiftModal(grp, subGroup)
                          : undefined
                      }
                      renderShifts={(sg) =>
                        sg.shifts && sg.shifts.length > 0 ? (
                          <div className="flex flex-col gap-1.5 w-full">
                            <div className="rounded-xl border border-white/10 dark:border-white/10 bg-slate-900/60 dark:bg-slate-900/60 overflow-hidden divide-y divide-white/[0.06] dark:divide-white/[0.06] shadow-sm w-full">
                              {[...sg.shifts]
                                .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
                                .map((shift) => (
                                  <ShiftCard
                                    key={String(shift.id)}
                                    shift={shift}
                                    isReadOnly={isReadOnly}
                                    groupColor={getGroupColor(grp.name)}
                                    onEdit={() =>
                                      openEditShiftModal(grp, subGroup, shift)
                                    }
                                    onDelete={() =>
                                      onDeleteShift(grp.id, subGroup.id, shift.id)
                                    }
                                    onClone={
                                      !isReadOnly
                                        ? () => {
                                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                          const { id, ...shiftData } = shift;
                                          // Cloned shifts keep the same role name - roles can have multiple employees
                                          onAddShift(grp.id, subGroup.id, {
                                            ...shiftData,
                                            skills: [...(shiftData.skills || [])],
                                            licenses: [...(shiftData.licenses || [])],
                                            siteTags: [...(shiftData.siteTags || [])],
                                            eventTags: [...(shiftData.eventTags || [])],
                                            // Keep original name (role name), don't add "(Copy)"
                                            name: shiftData.name || shiftData.roleName,
                                          });
                                        }
                                        : undefined
                                    }
                                  />
                                ))}
                            </div>
                            {!isReadOnly && (
                              <button
                                type="button"
                                onClick={() => openAddShiftModal(grp, subGroup)}
                                title="Add shift"
                                aria-label="Add shift"
                                className="w-full h-7 rounded-lg border border-dashed border-white/10 hover:border-primary/40 bg-slate-900/40 hover:bg-primary/10 flex items-center justify-center text-slate-400 hover:text-primary transition-all cursor-pointer select-none group/add-strip"
                              >
                                <Plus className="h-4 w-4 transition-transform duration-200 group-hover/add-strip:scale-110" />
                              </button>
                            )}
                          </div>
                        ) : null
                      }
                    />
                  );
                })
              }
            />
          ))}
        </div>
      </ScrollArea>

      {/* Dialogs */}
      <AddSubGroupDialog
        open={addSubGroupOpen}
        onOpenChange={setAddSubGroupOpen}
        onAddSubGroup={(_groupId, name) => handleAddSubGroup(name)}
        groupId={addSubGroupTarget || ''}
        groupName={getTargetGroupName()}
      />

      <EditSubGroupDialog
        open={editSubGroupOpen}
        onOpenChange={setEditSubGroupOpen}
        subGroupName={editSubGroupTarget?.subGroup.name || ''}
        onEditSubGroup={handleEditSubGroup}
      />

      {
        shiftModalOpen && shiftModalContext && (
          <EnhancedAddShiftModal
            isOpen={shiftModalOpen}
            onClose={() => {
              setShiftModalOpen(false);
              setShiftModalContext(null);
            }}
            onSuccess={() => { }}
            context={{
              mode: 'template',
              organizationId: template.organizationId || '',
              departmentId: template.departmentId || '',
              subDepartmentId: template.subDepartmentId || '',
              groupId: String(shiftModalContext.groupId),
              groupName: shiftModalContext.groupName,
              subGroupId: String(shiftModalContext.subGroupId),
              subGroupName: shiftModalContext.subGroupName,
              groupColor: shiftModalContext.groupColor,
            }}
            isTemplateMode={true}
            editMode={!!shiftModalContext.editShift}
            existingShift={shiftModalContext.editShift}
            onShiftCreated={handleShiftModalSave}
          />
        )
      }
    </div >
  );
};

export default TemplateEditor;
