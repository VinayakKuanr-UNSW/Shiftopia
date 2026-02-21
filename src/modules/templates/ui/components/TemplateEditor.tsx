// src/components/templates/TemplateEditor.tsx
import React, { useState, useMemo } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Plus,
  Edit2,
  Copy,
  Trash2,
  Clock,
  Users,
  Lock,
  Upload,
  Building2,
  LayoutGrid,
  Theater,
  Save,
  Loader2,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Shield,
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
import { EditSubGroupDialog } from '@/modules/rosters/ui/dialogs/EditSubGroupDialog';
import ShiftCard from './ShiftCard';
import { EnhancedAddShiftModal } from '@/modules/rosters';
import { TemplateGroupCard } from './editor/TemplateGroupCard';
import { TemplateSubgroupCard } from './editor/TemplateSubgroupCard';

interface TemplateEditorProps {
  template: Template;
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
}) => {
  const isPublished = template.status === 'published';
  const isArchived = template.status === 'archived';
  const isDraft = template.status === 'draft';
  const isReadOnly = isPublished || isArchived;

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
      remunerationLevelId: shiftData.remuneration_level_id || shiftData.remunerationLevelId,
      remunerationLevel: shiftData.remunerationLevel,
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
      <div className="bg-[#0d1829] border-b border-white/10">
        {/* Top Bar */}
        <div className="px-6 py-3 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-white/60 hover:text-white hover:bg-white/10 gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>

            <Separator orientation="vertical" className="h-5 bg-white/10" />

            <span className="text-white/40 text-sm uppercase tracking-wider font-medium">
              Template Editor
            </span>

            {hasUnsavedChanges && (
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 animate-pulse">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Unsaved Changes
              </Badge>
            )}

            {isPublished && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                <CheckCircle className="h-3 w-3 mr-1" />
                Ready for Use
              </Badge>
            )}

            {isArchived && (
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 font-bold uppercase tracking-widest px-3">
                <Lock className="h-3.5 w-3.5 mr-2" />
                ARCHIVED
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* DRAFT MODE ACTIONS */}
            {isDraft && (
              <>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onDiscardChanges}
                        disabled={!hasUnsavedChanges || isSaving}
                        className="bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30"
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Discard
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Revert to last saved version</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        onClick={onSaveChanges}
                        disabled={!hasUnsavedChanges || isSaving}
                        className={cn(
                          'min-w-[120px]',
                          hasUnsavedChanges
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : 'bg-white/10 text-white/50 cursor-not-allowed'
                        )}
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" />
                            Save
                          </>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Save changes to library</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <Separator orientation="vertical" className="h-6 bg-white/10" />

                <Button
                  size="sm"
                  onClick={() => onUpdateStatus(String(template.id), 'published')}
                  disabled={isSaving || hasUnsavedChanges}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                >
                  <CheckCircle className="h-4 w-4" />
                  Mark as Ready
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onUpdateStatus(String(template.id), 'archived')}
                  disabled={isSaving}
                  className="text-white/40 hover:text-purple-400 hover:bg-purple-400/10 gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Archive
                </Button>
              </>
            )}

            {/* READY (PUBLISHED) MODE ACTIONS */}
            {isPublished && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUpdateStatus(String(template.id), 'draft')}
                  disabled={isSaving}
                  className="bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white gap-2"
                >
                  <Edit2 className="h-4 w-4" />
                  Unlock to Edit
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onUpdateStatus(String(template.id), 'archived')}
                  disabled={isSaving}
                  className="text-white/40 hover:text-purple-400 hover:bg-purple-400/10 gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Archive
                </Button>
              </>
            )}

            {/* ARCHIVED MODE ACTIONS */}
            {isArchived && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUpdateStatus(String(template.id), 'draft')}
                disabled={isSaving}
                className="bg-purple-500/20 border-purple-500/30 text-purple-200 hover:bg-purple-500/30 gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Restore from Archive
              </Button>
            )}
          </div>
        </div>

        {/* Template Info */}
        <div className="px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-xs text-white/40 uppercase tracking-wider">
                  Template Name
                </span>
                <Badge
                  className={cn(
                    'text-[10px] px-2 py-0 h-4 border-none flex items-center gap-1 uppercase tracking-wider',
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
                  {template.status === 'published' ? 'Ready' : template.status}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-xs text-white/50 border-white/20"
                >
                  v{template.version}
                </Badge>
              </div>
              <h1 className="text-2xl font-bold text-white">{template.name}</h1>
              {template.description && (
                <p className="text-white/50 text-sm mt-1">
                  {template.description}
                </p>
              )}
            </div>

            {/* Stats */}
            <div className="text-right">
              <div className="flex items-center gap-4 text-sm text-white/50">
                <span>{stats.groupCount} groups</span>
                <span>{stats.subgroupCount} subgroups</span>
                <span>{stats.shiftCount} shifts</span>
              </div>
            </div>
          </div>
        </div>

        <Separator className="bg-white/10" />

        {/* Metadata Row */}
        <div className="px-6 py-3 flex items-center justify-between text-sm">
          <div className="flex items-center gap-6">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 text-white/50">
                    <Clock className="h-4 w-4" />
                    <span>Saved {lastSavedAgo}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {format(
                      new Date(template.updatedAt),
                      "EEEE, MMMM d, yyyy 'at' h:mm a"
                    )}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {template.startDate && template.endDate === 'NEVER_MIND' && (
              <div className="flex items-center gap-2 text-white/50">
                <Calendar className="h-4 w-4" />
                <span>
                  {template.startDate} - {template.endDate}
                </span>
              </div>
            )}
          </div>

          {isPublished && (
            <div className="flex items-center gap-2 text-emerald-400/90 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
              <Shield className="h-4 w-4" />
              <span className="text-xs font-medium">
                GOLD STANDARD: This template is verified and ready for use. Unlock to make adjustments.
              </span>
            </div>
          )}

          {isArchived && (
            <div className="flex items-center gap-2 text-purple-400/90 bg-purple-500/10 px-3 py-1 rounded-full border border-purple-500/20">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-medium">
                ARCHIVED: This template is hidden from the library. Restore it to use or edit.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Groups Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-4">
          {template.groups.map((group) => (
            <TemplateGroupCard
              key={String(group.id)}
              group={group}
              isExpanded={expandedGroups.has(group.id)}
              onToggleExpand={() => toggleGroup(group.id)}
              onAddSubgroup={() => {
                if (isReadOnly) return;
                setAddSubGroupTarget(group.id);
                setAddSubGroupOpen(true);
              }}
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
                      onUpdateName={
                        !isReadOnly
                          ? (name) => onUpdateSubgroup(grp.id, subGroup.id, { name })
                          : undefined
                      }
                      onDelete={
                        !isReadOnly
                          ? () => onDeleteSubgroup(grp.id, subGroup.id)
                          : undefined
                      }
                      onClone={
                        !isReadOnly
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
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {sg.shifts.map((shift) => (
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
                                        // Keep original name (role name), don't add "(Copy)"
                                        name: shiftData.name || shiftData.roleName,
                                      });
                                    }
                                    : undefined
                                }
                              />
                            ))}
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
