import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import {
  Plus,
  Check,
  Loader2,
  MoreHorizontal,
  Edit2,
  Trash2,
  Gavel,
  Send,
  Ban,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { format, addDays, startOfWeek, isToday, isBefore, startOfDay, parseISO, differenceInHours, differenceInMinutes } from 'date-fns';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import {
  EnhancedAddShiftModal,
  ShiftContext,
} from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import { BulkActionsToolbar } from '@/modules/rosters/ui/components/BulkActionsToolbar';
import { AddSubGroupDialog } from '@/modules/rosters/ui/dialogs/AddSubGroupDialog';
import { SmartShiftCard, type ComplianceInfo } from '@/modules/rosters/ui/components/SmartShiftCard';
import { GroupStatsSummary } from '@/modules/rosters/ui/components/GroupStatsSummary';
import { ShiftCardLegend } from '@/modules/rosters/ui/components/ShiftCardLegend';
import {
  Shift,
  TemplateGroupType,
  isValidUuid,
} from '@/modules/rosters/api/shifts.api';
import { useRosterStructure } from '@/modules/rosters/state/useRosterStructure';
import { RosterStructure, RosterGroupStructure, RosterSubGroupStructure } from '@/modules/rosters/model/roster.types';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
  useDeleteShift,
  useUpdateShift,
  useBulkDeleteShifts,
  useBulkPublishShifts,
  usePublishShift,
  useEmployees,
} from '@/modules/rosters/state/useRosterShifts';
import { useAddSubGroup, useAddSubGroupRange } from '@/modules/rosters/state/useRosterMutations';
import {
  getAllowedActions
} from '../../domain/bulk-validation';
import { startOfMonth, endOfMonth } from 'date-fns';
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
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { determineShiftState } from '@/modules/rosters/domain/shift-state.utils';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import { groupShiftsIntoBuckets, type ShiftBucket as ShiftBucketType } from '@/modules/rosters/utils/bucket.utils';
import { ShiftBucket, type BucketShiftData } from '@/modules/rosters/ui/components/ShiftBucket';

// ============================================================================
// DRAG & DROP TYPE
// ============================================================================

const DND_SHIFT_TYPE = 'SHIFT_CARD';

interface DragItem {
  shiftId: string;
  sourceGroupType: TemplateGroupType | 'unassigned';
  sourceSubGroup: string;
  shiftDate: string;
}

// ============================================================================
// DRAGGABLE SHIFT CARD WRAPPER
// ============================================================================

interface DraggableShiftCardProps {
  shift: ShiftDisplay;
  groupType: TemplateGroupType | 'unassigned';
  subGroupName: string;
  children: React.ReactNode;
}

const DraggableShiftCard: React.FC<DraggableShiftCardProps> = ({
  shift,
  groupType,
  subGroupName,
  children,
}) => {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: DND_SHIFT_TYPE,
    item: {
      shiftId: shift.id,
      sourceGroupType: groupType,
      sourceSubGroup: subGroupName,
      shiftDate: shift.rawShift.shift_date,
    } as DragItem,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [shift.id, groupType, subGroupName]);

  return (
    <div ref={drag} className={cn(isDragging && 'opacity-50 cursor-grabbing')}>
      {children}
    </div>
  );
};

// ============================================================================
// DROPPABLE CELL WRAPPER
// ============================================================================

interface DroppableCellProps {
  groupType: TemplateGroupType | 'unassigned';
  subGroupName: string;
  date: string;
  onDrop: (item: DragItem, targetGroupType: TemplateGroupType | 'unassigned', targetSubGroup: string) => void;
  children: React.ReactNode;
  className?: string;
}

const DroppableCell: React.FC<DroppableCellProps> = ({
  groupType,
  subGroupName,
  date,
  onDrop,
  children,
  className,
}) => {
  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: DND_SHIFT_TYPE,
    drop: (item: DragItem) => {
      // Only trigger drop if moving to a different group/subgroup
      if (item.sourceGroupType !== groupType || item.sourceSubGroup !== subGroupName) {
        onDrop(item, groupType, subGroupName);
      }
    },
    canDrop: (item: DragItem) => {
      // Can drop if same date (for now) or allow cross-date in future
      return item.shiftDate === date;
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [groupType, subGroupName, date, onDrop]);

  return (
    <div
      ref={drop}
      className={cn(
        className,
        isOver && canDrop && 'ring-2 ring-emerald-400 ring-inset bg-emerald-500/10',
        isOver && !canDrop && 'ring-2 ring-red-400 ring-inset bg-red-500/10'
      )}
    >
      {children}
    </div>
  );
};

// ============================================================================
// COLLAPSIBLE STATE HOOK (localStorage-persisted)
// ============================================================================

function useCollapsedGroups(): [Set<string>, (groupId: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem('roster_collapsed_groups');
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set();
  });

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      localStorage.setItem('roster_collapsed_groups', JSON.stringify([...next]));
      return next;
    });
  }, []);

  return [collapsed, toggleGroup];
}

/* ============================================================
   INTERFACES
   ============================================================ */
interface GroupModeViewProps {
  selectedDate: Date;
  viewType: 'day' | '3day' | 'week' | 'month';
  canEdit: boolean;
  organizationId?: string;
  organizationName?: string;
  rosterId?: string;
  departmentId?: string;
  departmentName?: string;
  subDepartmentId?: string;
  subDepartmentName?: string;
  // Ghost Cell Navigation - template date bounds
  templateStartDate?: Date;
  templateEndDate?: Date;
  onNavigateToMonth?: (date: Date) => void;
  onAddShift?: (
    groupName: string,
    subGroupName: string,
    groupColor: string,
    date?: Date,
    rosterId?: string
  ) => void;
  // Bulk Mode
  isBulkMode: boolean;
  onBulkModeToggle: (enabled: boolean) => void;
  /** Shifts data from parent useRosterShifts hook. Required for presentational mode. */
  shifts: Shift[];
  /** Loading state from parent */
  isShiftsLoading?: boolean;
  /** Compliance data map for SmartShiftCard rendering */
  complianceMap?: Record<string, ComplianceInfo>;
  /** Show the shift card legend panel */
  showLegend?: boolean;
}

interface VisualGroup {
  id: string;
  name: string;
  type: TemplateGroupType;
  color: string;
  subGroups: VisualSubGroup[];
}

interface VisualSubGroup {
  id: string;
  name: string;
  shifts: Record<string, ShiftDisplay[]>;
}

interface ShiftDisplay {
  id: string;
  role: string;
  startTime: string;
  endTime: string;
  employeeName?: string;
  status: 'Open' | 'Assigned' | 'Completed' | 'Draft' | 'Published';
  isPublished: boolean;
  isDraft: boolean;
  isOnBidding: boolean;
  isTrading: boolean;
  isCancelled: boolean;
  groupColor: string; // For shift card coloring
  subGroup?: string; // Added for card display
  assignedEmployeeId?: string | null;
  rawShift: Shift;
  isUrgent: boolean;
  isLocked?: boolean;
  assignmentOutcome?: string;
}

/* ============================================================
   GROUP COLOR CONFIG - Used for shift cards
   ============================================================ */
const GROUP_COLORS: Record<TemplateGroupType, {
  card: string;
  cardBorder: string;
  badge: string;
  accent: string;
}> = {
  convention_centre: {
    card: 'bg-blue-500/10 hover:bg-blue-500/15',
    cardBorder: 'border-l-blue-500',
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
    accent: 'blue',
  },
  exhibition_centre: {
    card: 'bg-emerald-500/10 hover:bg-emerald-500/15',
    cardBorder: 'border-l-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    accent: 'emerald',
  },
  theatre: {
    card: 'bg-red-500/10 hover:bg-red-500/15',
    cardBorder: 'border-l-red-500',
    badge: 'bg-red-100 text-red-700 border-red-200',
    accent: 'red',
  },
};

/* ============================================================
   GLASSMORPHISM STYLES
   ============================================================ */
const GLASS_STYLES: Record<TemplateGroupType, {
  container: string;
  header: string;
  headerText: string;
  accent: string;
}> = {
  convention_centre: {
    container: 'bg-blue-500/5 backdrop-blur-xl border border-blue-500/20 shadow-[0_8px_32px_rgba(59,130,246,0.15)]',
    header: 'bg-gradient-to-r from-blue-600/90 to-blue-500/80 backdrop-blur-md border-b border-blue-400/30',
    headerText: 'text-white drop-shadow-lg',
    accent: 'blue',
  },
  exhibition_centre: {
    container: 'bg-emerald-500/5 backdrop-blur-xl border border-emerald-500/20 shadow-[0_8px_32px_rgba(16,185,129,0.15)]',
    header: 'bg-gradient-to-r from-emerald-600/90 to-emerald-500/80 backdrop-blur-md border-b border-emerald-400/30',
    headerText: 'text-white drop-shadow-lg',
    accent: 'emerald',
  },
  theatre: {
    container: 'bg-red-500/5 backdrop-blur-xl border border-red-500/20 shadow-[0_8px_32px_rgba(239,68,68,0.15)]',
    header: 'bg-gradient-to-r from-red-600/90 to-red-500/80 backdrop-blur-md border-b border-red-400/30',
    headerText: 'text-white drop-shadow-lg',
    accent: 'red',
  },
};

// Unassigned group style (separate to avoid type conflicts)
const UNASSIGNED_GLASS_STYLE = {
  container: 'bg-gray-500/5 backdrop-blur-xl border border-gray-500/30 border-dashed shadow-[0_8px_32px_rgba(107,114,128,0.15)]',
  header: 'bg-gradient-to-r from-gray-600/90 to-gray-500/80 backdrop-blur-md border-b border-gray-400/30',
  headerText: 'text-white drop-shadow-lg',
  accent: 'gray',
};

// Default sub-groups per group type - Empty by default, populated by templates
const DEFAULT_SUB_GROUPS_MAP: Record<TemplateGroupType, string[]> = {
  convention_centre: [],
  exhibition_centre: [],
  theatre: [],
};

// Human-readable group names
const GROUP_DISPLAY_NAMES: Record<TemplateGroupType | 'unassigned', string> = {
  convention_centre: 'Convention Centre',
  exhibition_centre: 'Exhibition Centre',
  theatre: 'Theatre',
  unassigned: 'Unassigned',
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export const GroupModeView: React.FC<GroupModeViewProps> = ({
  selectedDate,
  viewType,
  canEdit,
  organizationId,
  organizationName,
  rosterId,
  departmentId,
  departmentName,
  subDepartmentId,
  subDepartmentName,
  // Ghost Cell Navigation props
  templateStartDate,
  templateEndDate,
  onNavigateToMonth,
  onAddShift,
  isBulkMode,
  onBulkModeToggle,
  // Data props from parent (required)
  shifts: externalShifts,
  isShiftsLoading = false,
  complianceMap,
  showLegend = false,
}) => {
  const { toast } = useToast();
  const { isDark } = useTheme();
  // Get enhanced filters from context
  const { advancedFilters, hasActiveFilters, isBucketView } = useRosterUI();

  // Collapsible group state (persisted to localStorage)
  const [collapsedGroups, toggleGroupCollapse] = useCollapsedGroups();

  // TanStack Query mutation hooks (auto-invalidate caches on success)
  const deleteShiftMutation = useDeleteShift();
  const updateShiftMutation = useUpdateShift(); // For DnD group changes
  const bulkDeleteMutation = useBulkDeleteShifts();
  const bulkPublishMutation = useBulkPublishShifts();
  const publishShiftMutation = usePublishShift();
  const addSubGroupMutation = useAddSubGroup();
  const addSubGroupRangeMutation = useAddSubGroupRange();

  // ==================== DND DROP HANDLER ====================
  const handleShiftDrop = useCallback(
    (item: DragItem, targetGroupType: TemplateGroupType | 'unassigned', targetSubGroup: string) => {
      // Find the shift in our data
      const shift = externalShifts.find(s => s.id === item.shiftId);
      if (!shift) {
        toast({
          title: 'Error',
          description: 'Could not find the shift to move',
          variant: 'destructive',
        });
        return;
      }

      // Update the shift with new group/subgroup
      updateShiftMutation.mutate(
        {
          shiftId: item.shiftId,
          updates: {
            group_type: targetGroupType === 'unassigned' ? null : targetGroupType,
            sub_group_name: targetSubGroup === 'Unassigned' ? null : targetSubGroup,
          },
        },
        {
          onSuccess: () => {
            toast({
              title: 'Shift Moved',
              description: `Shifted moved to ${targetGroupType === 'unassigned' ? 'Unassigned' : GROUP_DISPLAY_NAMES[targetGroupType]} / ${targetSubGroup}`,
            });
          },
          onError: (error) => {
            toast({
              title: 'Failed to move shift',
              description: error instanceof Error ? error.message : 'Unknown error',
              variant: 'destructive',
            });
          },
        }
      );
    },
    [externalShifts, updateShiftMutation, toast]
  );

  // ==================== REFS FOR CLOSURE STABILITY ====================
  const departmentIdRef = useRef<string | undefined>(departmentId);
  const departmentNameRef = useRef<string | undefined>(departmentName);
  const subDepartmentIdRef = useRef<string | undefined>(subDepartmentId);
  const subDepartmentNameRef = useRef<string | undefined>(subDepartmentName);
  const queryClient = useQueryClient();
  const organizationIdRef = useRef<string | undefined>(organizationId);
  const organizationNameRef = useRef<string | undefined>(organizationName);
  const rosterIdRef = useRef<string | undefined>(rosterId);

  useEffect(() => { departmentIdRef.current = departmentId; }, [departmentId]);
  useEffect(() => { departmentNameRef.current = departmentName; }, [departmentName]);
  useEffect(() => { subDepartmentIdRef.current = subDepartmentId; }, [subDepartmentId]);
  useEffect(() => { subDepartmentNameRef.current = subDepartmentName; }, [subDepartmentName]);
  useEffect(() => { organizationIdRef.current = organizationId; }, [organizationId]);
  useEffect(() => { organizationNameRef.current = organizationName; }, [organizationName]);
  useEffect(() => { rosterIdRef.current = rosterId; }, [rosterId]);

  // ==================== GHOST CELL HELPER ====================
  // Check if a date is within the active template's bounds (normalized to start of day)
  const isDateInTemplate = useMemo(() => {
    return (cellDate: Date): boolean => {
      if (!templateStartDate || !templateEndDate) {
        return true; // No bounds defined, consider all dates valid
      }
      const normalizedCell = startOfDay(cellDate);
      const normalizedStart = startOfDay(templateStartDate);
      const normalizedEnd = startOfDay(templateEndDate);
      // Check: normalizedStart <= normalizedCell <= normalizedEnd
      return normalizedCell >= normalizedStart && normalizedCell <= normalizedEnd;
    };
  }, [templateStartDate, templateEndDate]);


  // ==================== MODAL STATE ====================
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [shiftContext, setShiftContext] = useState<ShiftContext | null>(null);

  // ==================== DELETE CONFIRMATION ====================
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shiftToDelete, setShiftToDelete] = useState<ShiftDisplay | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ==================== PUBLISH/UNPUBLISH CONFIRMATION ====================
  const [confirmActionOpen, setConfirmActionOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'publish'; shift: ShiftDisplay } | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // ==================== BULK MODE STATE ====================
  const [selectedShiftIds, setSelectedShiftIds] = useState<Set<string>>(new Set());

  // Reset selection when view or date changes
  useEffect(() => {
    setSelectedShiftIds(new Set());
    if (isBulkMode && onBulkModeToggle) {
      onBulkModeToggle(false);
    }
  }, [viewType, selectedDate]);

  // ==================== SUB-GROUP DIALOG STATE ====================
  const [isAddSubGroupOpen, setIsAddSubGroupOpen] = useState(false);
  const [selectedGroupForSubGroup, setSelectedGroupForSubGroup] = useState<VisualGroup | null>(null);
  const [pendingShiftCreation, setPendingShiftCreation] = useState<{ date: Date, group: VisualGroup } | null>(null);

  // ==================== EMERGENCY ALERT STATE ====================
  const [isEmergencyAlertOpen, setIsEmergencyAlertOpen] = useState(false);
  const [emergencyAlertMessage, setEmergencyAlertMessage] = useState('');

  // ==================== PROFILE DATA (via React Query) ====================
  const { data: employeeProfiles = [] } = useEmployees(organizationId);

  // Build profile map from React Query data (replaces direct Supabase call)
  const profileMap = useMemo(() => {
    const map: Record<string, { first_name: string; last_name: string }> = {};
    employeeProfiles.forEach((p: any) => {
      map[p.id] = { first_name: p.first_name || '', last_name: p.last_name || '' };
      if (p.legacy_employee_id) {
        map[p.legacy_employee_id] = { first_name: p.first_name || '', last_name: p.last_name || '' };
      }
    });
    return map;
  }, [employeeProfiles]);

  // ==================== DATE CALCULATION ====================
  const dates = useMemo((): Date[] => {
    const result: Date[] = [];
    switch (viewType) {
      case 'day':
        result.push(selectedDate);
        break;
      case '3day':
        for (let i = 0; i < 3; i++) result.push(addDays(selectedDate, i));
        break;
      case 'week':
        const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
        for (let i = 0; i < 7; i++) result.push(addDays(weekStart, i));
        break;
      case 'month': {
        // Use templateEndDate if available, otherwise calculate end of month
        const monthEnd = templateEndDate
          ? startOfDay(templateEndDate)
          : new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);

        // Generate all dates from selectedDate to monthEnd
        let current = startOfDay(selectedDate);
        while (current <= monthEnd) {
          result.push(current);
          current = addDays(current, 1);
        }
        break;
      }
    }
    return result;
  }, [selectedDate, viewType, templateEndDate]);

  // Profiles are now fetched via useEmployees React Query hook above

  // Note: visualGroups useMemo is defined after buildVisualGroupsFromShifts and getDefaultGroups

  // ==================== DYNAMIC STRUCTURE FETCHING ====================
  // Calculate date range strings for hook
  const { dateRangeStart, dateRangeEnd } = useMemo(() => {
    if (dates.length === 0) return { dateRangeStart: null, dateRangeEnd: null };
    const start = format(dates[0], 'yyyy-MM-dd');
    const end = format(dates[dates.length - 1], 'yyyy-MM-dd');
    return { dateRangeStart: start, dateRangeEnd: end };
  }, [dates]);

  const {
    selectedDepartmentIds,
    selectedSubDepartmentIds,
  } = useRosterUI();

  const { data: rosterStructures = [] } = useRosterStructure(
    organizationId,
    dateRangeStart,
    dateRangeEnd,
    {
      departmentIds: selectedDepartmentIds,
      subDepartmentIds: selectedSubDepartmentIds,
    }
  );

  // Helper to get formatted group name
  const getGroupName = (externalId: string | null, name: string) => {
    if (externalId && GROUP_DISPLAY_NAMES[externalId as TemplateGroupType]) {
      return GROUP_DISPLAY_NAMES[externalId as TemplateGroupType];
    }
    return name;
  };

  // ==================== BUILD VISUAL GROUPS (DYNAMIC) ====================
  const buildVisualGroupsFromShifts = (shifts: Shift[]): VisualGroup[] => {

    // 1. Build a unified structure map from the fetched roster structures
    //    We merge groups/subgroups from all days in the view to handle potential inconsistencies or spanning rosters
    const groupsMap = new Map<string, {
      name: string;
      externalId: string | null;
      type: TemplateGroupType;
      sortOrder: number;
      subGroups: Map<string, { id: string; name: string; sortOrder: number }>;
    }>();

    // Helper to ensure group exists in map
    const ensureGroup = (name: string, externalId: string | null, sortOrder: number) => {
      // Key by externalId if available (stable across renames), else name
      const key = externalId || name;
      if (!groupsMap.has(key)) {
        let type: TemplateGroupType = 'convention_centre'; // Default fallback
        if (externalId && ['convention_centre', 'exhibition_centre', 'theatre'].includes(externalId)) {
          type = externalId as TemplateGroupType;
        } else if (!externalId) {
          // Try to infer from name for legacy compatibility
          const lowerName = name.toLowerCase().replace(/ /g, '_');
          if (['convention_centre', 'exhibition_centre', 'theatre'].includes(lowerName)) {
            type = lowerName as TemplateGroupType;
          }
        }

        groupsMap.set(key, {
          name,
          externalId,
          type,
          sortOrder,
          subGroups: new Map()
        });
      }
      return groupsMap.get(key)!;
    };

    // Populate structure from API data
    rosterStructures.forEach(roster => {
      roster.groups.forEach(group => {
        const groupEntry = ensureGroup(group.name, group.externalId, group.sortOrder);
        group.subGroups.forEach(sg => {
          // Use Name as key for subgroup merging to avoid ID conflicts across rosters if not synced
          // Ideally we use ID, but for display merging name is often safer for "same logical group"
          if (!groupEntry.subGroups.has(sg.name)) {
            groupEntry.subGroups.set(sg.name, {
              id: sg.id, // Keep the first ID we find (or maybe null if we want to be strict)
              name: sg.name,
              sortOrder: sg.sortOrder
            });
          }
        });
      });
    });

    // If no structure found (e.g. empty roster), fall back to defaults or legacy inference
    if (groupsMap.size === 0) {
      // Fallback to legacy behavior if no DB structure exists
      (['convention_centre', 'exhibition_centre', 'theatre'] as TemplateGroupType[]).forEach((type, idx) => {
        ensureGroup(GROUP_DISPLAY_NAMES[type], type, idx);
      });
    }

    // 2. Distribute Shifts into Groups
    const visualGroups: VisualGroup[] = [];

    // Sort groups
    const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);

    sortedGroups.forEach(groupDef => {
      const subGroups: VisualSubGroup[] = [];

      // Prepare subgroups (including those from structure + any ad-hoc ones found in shifts)
      const subGroupMap = new Map<string, { id: string, name: string, shifts: Record<string, ShiftDisplay[]> }>();

      // Initialize with known structure subgroups
      groupDef.subGroups.forEach(sg => {
        subGroupMap.set(sg.name, { id: sg.id, name: sg.name, shifts: {} });
      });

      // Ensure "General" exists if map is empty?
      // if (subGroupMap.size === 0) subGroupMap.set('General', { id: `generated-${groupDef.type}-general`, name: 'General', shifts: {} });


      // Filter shifts for this group
      const groupShifts = shifts.filter(shift => {

        // Match by SubGroup ID (Strong Link)
        if ((shift as any).roster_subgroup_id) {
          // Find if this subgroup belongs to current group
          // This is tricky because we flattened structure. 
          // We need to check if the shift's roster_subgroup_id matches any ID in this group's structure.
          // This is O(N*M), but N (groups) is small.

          // However, we merged based on Name/ExternalID. 
          // So we should check if the shift's subgroup *logic* maps here.
          // For now, let's rely on the LEAGACY COLUMNS which are Dual-Written.
          // This is safer until we have full ID-based lookup map.
          // WAIT - Plan says "Group shifts by roster_subgroup_id".

          // Let's stick to legacy columns for grouping logic in this transitional step, 
          // BUT use the STRUCTURE for defining the containers.
          // This ensures shifts show up even if structure is missing, provided `group_type` is set.

          const sType = (shift.group_type as TemplateGroupType) || 'convention_centre';
          return sType === groupDef.type;
        }

        // Fallback to legacy grouping
        const sType = (shift.group_type as TemplateGroupType) || 'convention_centre';
        return sType === groupDef.type;
      });

      groupShifts.forEach(shift => {
        const subGroupName = shift.sub_group_name || 'General';

        if (!subGroupMap.has(subGroupName)) {
          // Ad-hoc subgroup (legacy data not in structure?)
          subGroupMap.set(subGroupName, {
            id: `adhoc-${groupDef.type}-${subGroupName}`,
            name: subGroupName,
            shifts: {}
          });
        }

        const sgEntry = subGroupMap.get(subGroupName)!;
        const dateKey = shift.shift_date;
        if (!sgEntry.shifts[dateKey]) sgEntry.shifts[dateKey] = [];

        // ... Shift Display Logic ...
        const assignedProfile = (shift as any).assigned_profiles || (shift as any).profiles;

        let employeeName = assignedProfile
          ? `${assignedProfile.first_name || ''} ${assignedProfile.last_name || ''}`.trim()
          : undefined;

        if (!employeeName && shift.assigned_employee_id && profileMap[shift.assigned_employee_id]) {
          const p = profileMap[shift.assigned_employee_id];
          employeeName = `${p.first_name} ${p.last_name}`.trim();
        }

        if (!employeeName && shift.assigned_employee_id) employeeName = 'Assigned';

        let assignmentOutcome = (shift as any).assignment_outcome;
        if (shift.assigned_employee_id && !assignmentOutcome) {
          assignmentOutcome = 'pending';
        }

        const isPublished = shift.lifecycle_status === 'Published';
        const isDraft = shift.lifecycle_status === 'Draft';
        const finalIsDraft = isPublished ? false : isDraft;

        const patchedRawShift = { ...shift };
        if (isPublished) {
          patchedRawShift.lifecycle_status = 'Published';
          patchedRawShift.is_draft = false;
          patchedRawShift.is_published = true;
          if (patchedRawShift.assigned_employee_id) {
            if (!(patchedRawShift as any).assignment_outcome || (patchedRawShift as any).assignment_outcome === 'pending') {
              (patchedRawShift as any).assignment_outcome = 'offered';
            }
          }
        }

        sgEntry.shifts[dateKey].push({
          id: shift.id,
          role: (shift as any).roles?.name || 'Shift',
          startTime: shift.start_time,
          endTime: shift.end_time,
          employeeName: employeeName,
          status: getShiftStatus(shift),
          isPublished: false, // will be overridden by patched logic if needed, but logic above handles it
          isDraft: finalIsDraft,
          isOnBidding: shift.bidding_status !== 'not_on_bidding',
          isUrgent: shift.bidding_status === 'on_bidding_urgent',
          isTrading: !!shift.trade_requested_at,
          isCancelled: shift.is_cancelled,
          groupColor: groupDef.type, // Use the group type color
          subGroup: subGroupName,
          assignmentOutcome: assignmentOutcome,
          assignedEmployeeId: shift.assigned_employee_id,
          rawShift: patchedRawShift,
          isLocked: isShiftLocked(shift.shift_date, shift.start_time, 'roster_management'),
        });

        // Patch isPublished in the object we just pushed
        sgEntry.shifts[dateKey][sgEntry.shifts[dateKey].length - 1].isPublished = isPublished;
      });

      // Convert map to array
      subGroupMap.forEach((sg) => {
        subGroups.push(sg);
      });

      // Sort subgroups? (Based on structure sortOrder if available, else alpha)
      // For now, basic sort
      subGroups.sort((a, b) => a.name.localeCompare(b.name));

      visualGroups.push({
        id: groupDef.externalId || groupDef.name, // Stable ID preferably
        name: getGroupName(groupDef.externalId, groupDef.name),
        type: groupDef.type,
        color: GLASS_STYLES[groupDef.type]?.accent || 'gray',
        subGroups
      });
    });

    return visualGroups;
  };

  const getShiftStatus = (shift: Shift): ShiftDisplay['status'] => {
    if (shift.is_published) return 'Published';
    if (shift.is_draft) return 'Draft';
    if (shift.assigned_employee_id) return 'Assigned';
    return 'Open';
  };

  const getDefaultGroups = (): VisualGroup[] => {
    return (['convention_centre', 'exhibition_centre', 'theatre'] as TemplateGroupType[]).map((type) => ({
      id: type,
      name: GROUP_DISPLAY_NAMES[type],
      type,
      color: GLASS_STYLES[type].accent,
      subGroups: DEFAULT_SUB_GROUPS_MAP[type].map((name) => ({
        id: `${type}-${name}`,
        name,
        shifts: {},
      })),
    }));
  };

  // ==================== DERIVE VISUAL GROUPS VIA MEMO ====================
  // Now placed AFTER helper functions to avoid hoisting issues
  const visualGroups = useMemo(() => {
    if (!externalShifts || externalShifts.length === 0) {
      return getDefaultGroups();
    }

    let filteredShifts = externalShifts;
    if (hasActiveFilters) {
      filteredShifts = externalShifts.filter(shift => {
        // 1. State ID
        if (advancedFilters.stateId && advancedFilters.stateId !== 'all') {
          const sId = determineShiftState(shift);
          if (sId !== advancedFilters.stateId) return false;
        }

        // 2. Lifecycle
        if (advancedFilters.lifecycleStatus !== 'all') {
          // Determine effective lifecycle (normalized)
          const lc = shift.lifecycle_status?.toLowerCase();
          const filterLc = advancedFilters.lifecycleStatus.toLowerCase();
          if (lc !== filterLc) return false;
        }

        // 3. Assignment Status
        if (advancedFilters.assignmentStatus !== 'all') {
          const as = shift.assignment_status || 'unassigned';
          if (as !== advancedFilters.assignmentStatus) return false;
        }

        // 4. Assignment Outcome
        if (advancedFilters.assignmentOutcome !== 'all') {
          // Normalize outcome
          let outcome = shift.assignment_outcome || 'none';
          if (shift.assigned_employee_id && !shift.assignment_outcome) {
            outcome = 'pending'; // Inferred pending
          }
          if (outcome === 'none' && !shift.assigned_employee_id) {
            outcome = 'none';
          }

          if (advancedFilters.assignmentOutcome === 'none') {
            if (outcome !== 'none' && outcome !== null) return false;
          } else {
            if (outcome !== advancedFilters.assignmentOutcome) return false;
          }
        }

        // 5. Bidding Status
        if (advancedFilters.biddingStatus !== 'all') {
          const bs = shift.bidding_status || 'not_on_bidding';
          if (bs !== advancedFilters.biddingStatus) return false;
        }

        // 6. Trading Status
        if (advancedFilters.tradingStatus !== 'all') {
          const isTrading = !!shift.trade_requested_at;
          if (advancedFilters.tradingStatus === 'requested' && !isTrading) return false;
          if (advancedFilters.tradingStatus === 'none' && isTrading) return false;
        }

        return true;
      });
    }

    const groups = buildVisualGroupsFromShifts(filteredShifts);
    return groups; // Removed getDefaultGroups fallback as we handle it inside buildVisualGroups
  }, [externalShifts, subDepartmentId, profileMap, advancedFilters, hasActiveFilters, rosterStructures]); // Added rosterStructures dependency

  // ==================== CONTEXT BUILDER ====================
  const buildShiftContext = (
    group: VisualGroup,
    subGroup: VisualSubGroup,
    date: Date,
    launchSource: 'grid' | 'global' | 'edit' = 'grid',
    specificRosterId?: string
  ): ShiftContext => {
    return {
      mode: 'group',
      launchSource,
      date: format(date, 'yyyy-MM-dd'),
      organizationId: organizationIdRef.current,
      organizationName: organizationNameRef.current,
      rosterId: specificRosterId || rosterIdRef.current,
      departmentId: departmentIdRef.current,
      departmentName: departmentNameRef.current,
      subDepartmentId: subDepartmentIdRef.current,
      subDepartmentName: subDepartmentNameRef.current,
      groupId: group.id,
      groupName: group.name,
      groupColor: group.color,
      subGroupId: subGroup.id,
      subGroupName: subGroup.name,
    };
  };

  // ==================== HANDLERS ====================

  const handleAddShift = async (group: VisualGroup, subGroup: VisualSubGroup, date: Date) => {
    if (!canEdit) return;



    // Check if date is in the past
    // Logic:
    // 1. If date < today, warn user (unless overridden or admin)
    // 2. If date is today, allow
    // 3. If date > today, allow

    const today = startOfDay(new Date());
    const targetDate = startOfDay(date);

    if (isBefore(targetDate, today)) {
      toast({
        title: 'Past Date',
        description: 'Cannot add shifts on past dates.',
        variant: 'destructive',
      });
      return;
    }
    // a. Check if `rosterStructures` has a roster for this specific date
    // b. If not, Lazy Create it (or reuse existing draft)
    // c. Pass the ID to the modal context

    const dateKey = format(date, 'yyyy-MM-dd');
    const specificRoster = rosterStructures.find(r => r.date === dateKey); // rosterStructures has 'date' as YYYY-MM-DD
    let specificRosterId = specificRoster?.rosterId; // Use .rosterId (mapped from id)

    // Lazy Initialization: If roster doesn't exist for this date, create it.
    if (!specificRosterId && organizationIdRef.current) {
      try {
        console.log('[GroupModeView] No roster found for date:', dateKey, '. Attempting lazy creation...');
        toast({
          title: 'Initializing Roster...',
          description: `Creating a daily roster for ${format(date, 'd MMM')}.`,
          duration: 2000,
        });

        // 1. Check if it exists in DB (maybe not in our current fetch window?)
        const { data: existingRoster, error: fetchError } = await supabase
          .from('rosters')
          .select('id')
          .eq('organization_id', organizationIdRef.current)
          .eq('date', dateKey)
          .maybeSingle();

        if (fetchError) throw fetchError;

        if (existingRoster) {
          specificRosterId = existingRoster.id;
        } else {
          // 2. Create it
          console.log('[GroupModeView] Creating new roster for:', dateKey);
          const { data: newRoster, error: createError } = await supabase
            .from('rosters')
            .insert({
              organization_id: organizationIdRef.current,
              name: `Daily Roster - ${format(date, 'dd MMM yyyy')}`,
              date: dateKey,
              start_date: dateKey,
              end_date: dateKey,
              status: 'draft',
              created_by: (await supabase.auth.getUser()).data.user?.id
            })
            .select('id')
            .single();

          if (createError) throw createError;
          if (newRoster) {
            specificRosterId = newRoster.id;
            // Invalidate queries to refresh the view AND the modal's lookup
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['rosterStructure'] }),
              queryClient.invalidateQueries({ queryKey: ['rosters'] })
            ]);
          }
        }
      } catch (error: any) {
        console.error('Failed to lazy create roster:', error);
        toast({
          title: 'Error',
          description: 'Could not initialize roster. Please try again.',
          variant: 'destructive',
        });
        return; // Stop if we failed to ensure a roster
      }
    }

    if (onAddShift) {
      onAddShift(group.name, subGroup.name, group.color, date, specificRosterId);
      return;
    }

    const context = buildShiftContext(group, subGroup, date, 'grid', specificRosterId);
    console.log('[GroupModeView] Opening Add Shift Modal with context:', {
      date: context.date,
      rosterId: context.rosterId,
      derivedFromSpecificId: specificRosterId,
      fallbackRosterId: rosterIdRef.current
    });
    setShiftContext(context);
    setIsEditMode(false);
    setEditingShift(null);
    setAddShiftModalOpen(true);
  };

  const handleEditShift = (
    shift: ShiftDisplay,
    group: VisualGroup,
    subGroup: VisualSubGroup,
    date: Date
  ) => {
    console.log('[handleEditShift] Opening edit modal for shift:', shift.id);

    const context = buildShiftContext(group, subGroup, date, 'edit');
    setShiftContext(context);
    setIsEditMode(true);
    setEditingShift(shift.rawShift); // Pass the raw shift for ID reference
    setIsAddShiftOpen(true);
  };

  const handleDeleteShift = (shift: ShiftDisplay) => {
    setShiftToDelete(shift);
    setDeleteDialogOpen(true);
  };



  const confirmDeleteShift = async () => {
    if (!shiftToDelete) return;

    setIsDeleting(true);
    try {
      await deleteShiftMutation.mutateAsync(shiftToDelete.id);
      toast({ title: 'Shift Deleted', description: 'The shift has been removed.' });
    } catch (error: any) {
      console.error('[confirmDeleteShift] Error:', error);
      toast({ title: 'Error', description: error.message || 'Failed to delete shift.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setShiftToDelete(null);
    }
  };

  // Push to Bidding - marks shift as available for bidding
  // Bidding window auto-closes 4 hours before shift start
  const handleRequestPublish = (shift: ShiftDisplay) => {
    setPendingAction({ type: 'publish', shift });
    setConfirmActionOpen(true);
  };

  const executePendingAction = async () => {
    if (!pendingAction) return;

    setIsProcessingAction(true);
    try {
      if (pendingAction.type === 'publish') {
        const result = await publishShiftMutation.mutateAsync(pendingAction.shift.id);
        if (!(result as any).success) throw new Error('Publish failed');
        toast({ title: 'Shift Published', description: 'Action completed successfully.' });
      }
      // setRefreshKey not needed as mutation invalidates queries
      // setRefreshKey((k) => k + 1);
    } catch (error: any) {
      console.error(`[${pendingAction.type}] Error:`, error);
      toast({ title: 'Error', description: error.message || 'Action failed.', variant: 'destructive' });
    } finally {
      setIsProcessingAction(false);
      setConfirmActionOpen(false);
      setPendingAction(null);
    }
  };

  const toggleShiftSelection = (shiftId: string) => {
    // Check if shift is locked before toggling
    const shift = externalShifts.find(s => s.id === shiftId);
    if (shift) {
      if (isShiftLocked(shift.shift_date, shift.end_time || shift.start_time, 'roster_management')) {
        return;
      }
    }

    setSelectedShiftIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(shiftId)) newSet.delete(shiftId);
      else newSet.add(shiftId);
      return newSet;
    });
  };

  const currentVisibleShiftIds = useMemo(() => {
    const ids: string[] = [];
    visualGroups.forEach(g => {
      g.subGroups.forEach(sg => {
        Object.values(sg.shifts).forEach(dayShifts => {
          dayShifts.forEach(s => {
            // Only include unlock shifts in bulk selection
            if (!s.isLocked) {
              ids.push(s.id);
            }
          });
        });
      });
    });
    return ids;
  }, [visualGroups]);

  const handleSelectAll = () => {
    if (selectedShiftIds.size === currentVisibleShiftIds.length) {
      setSelectedShiftIds(new Set());
    } else {
      setSelectedShiftIds(new Set(currentVisibleShiftIds));
    }
  };



  const handleBulkDelete = async () => {
    if (selectedShiftIds.size === 0) return;

    const shiftIdsArray = Array.from(selectedShiftIds);

    try {
      await bulkDeleteMutation.mutateAsync(shiftIdsArray);

      toast({
        title: "Shifts Deleted",
        description: `Successfully deleted ${shiftIdsArray.length} shift${shiftIdsArray.length !== 1 ? 's' : ''}.`,
      });

      setSelectedShiftIds(new Set());
    } catch (error) {
      console.error('[GroupModeView] Bulk delete failed:', error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete shifts. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleAddSubGroup = (group: VisualGroup, dateContext?: Date) => {
    const targetDate = dateContext || selectedDate;

    // We don't need to check for roster existence here anymore because the RPC handles it!
    // We just need the group definition to set the context for the dialog.

    setSelectedGroupForSubGroup(group);

    if (dateContext) {
      setPendingShiftCreation({ date: dateContext, group });
    } else {
      setPendingShiftCreation(null);
    }
    setIsAddSubGroupOpen(true);
  };


  const onSubGroupAdded = async (groupId: string | number, name: string) => {
    // Calculate full month range for the target date
    // If pendingShiftCreation exists, use that date. Otherwise use selectedDate.
    const targetBaseDate = pendingShiftCreation?.date || selectedDate;
    const startDate = format(startOfMonth(targetBaseDate), 'yyyy-MM-dd');
    const endDate = format(endOfMonth(targetBaseDate), 'yyyy-MM-dd');

    // Call the range mutation
    // We pass the external_id (group.type) to the RPC
    if (!selectedGroupForSubGroup) return;

    try {
      await addSubGroupRangeMutation.mutateAsync({
        organizationId: organizationId || '',
        groupExternalId: selectedGroupForSubGroup.type,
        name: name,
        startDate,
        endDate
      });

      setIsAddSubGroupOpen(false);

      // Handle pending shift creation
      if (pendingShiftCreation) {
        setIsAddShiftOpen(true);
      }

      // Clear pending
      setPendingShiftCreation(null);

    } catch (error) {
      // Error handled by mutation
    }
  };

  const handleShiftCreated = () => {
    // Mutation hooks auto-invalidate the cache; no manual refresh needed
  };

  // ==================== RENDER SHIFT CARD ====================
  const renderShiftCard = (
    shift: ShiftDisplay,
    group: VisualGroup,
    subGroup: VisualSubGroup,
    date: Date
  ) => {
    // Check if this is a past shift (Date-wise)
    const isPastDate = isBefore(startOfDay(date), startOfDay(new Date()));

    // Strict Locking Check (Includes past TIME on current day + 4h rule)
    const isLocked = shift.isLocked;

    const shiftStart = new Date(date);
    const [h, m] = shift.startTime.split(':').map(Number);
    shiftStart.setHours(h, m, 0, 0);

    const now = new Date();
    const hoursToStart = differenceInHours(shiftStart, now);
    const minutesToStart = differenceInMinutes(shiftStart, now);
    const isEmergency = hoursToStart < 4;

    // DEBUG: Log calculation for shifts starting soon
    // if (hoursToStart < 6) {
    //   console.log(`[ShiftCard] ${shift.id} Start:${shift.startTime} Now:${format(now, 'HH:mm')} Diff:${hoursToStart}h${minutesToStart % 60}m Emergency:${isEmergency} OnBidding:${shift.isOnBidding}`);
    // }

    const groupConfig = GROUP_COLORS[shift.groupColor as TemplateGroupType] || GROUP_COLORS.convention_centre;
    const accentColor = groupConfig.accent === 'emerald' ? 'green' : groupConfig.accent;

    const lifecycleStatus = shift.isPublished ? 'published' : shift.isDraft ? 'draft' : 'draft';

    const menu = (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="h-4 w-4 flex items-center justify-center hover:bg-white/20 rounded transition-colors"
            onClick={(e) => e.stopPropagation()}
            // Explicitly disable trigger if locked (though likely hidden by parent logic if desired)
            disabled={isLocked}
          >
            <MoreHorizontal className={cn("h-3 w-3", isLocked ? "text-white/30" : "text-white")} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-[#1a2744] border-white/10 min-w-[160px] z-50">
          {isLocked ? (
            <DropdownMenuItem
              onClick={() => handleDeleteShift(shift)}
              className="text-red-400 hover:bg-red-500/10 cursor-pointer"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Shift (Locked)
            </DropdownMenuItem>
          ) : (
            <>
              {shift.isDraft && (
                <DropdownMenuItem
                  onClick={() => handleEditShift(shift, group, subGroup, date)}
                  className="text-white hover:bg-white/10 cursor-pointer"
                >
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit Shift
                </DropdownMenuItem>
              )}

              {shift.isDraft && !shift.isPublished && (
                <DropdownMenuItem
                  onClick={() => handleRequestPublish(shift)}
                  className="text-white hover:bg-white/10 cursor-pointer"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Publish Shift
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator className="bg-white/10" />

              <DropdownMenuItem
                onClick={() => handleDeleteShift(shift)}
                className="text-red-400 hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Shift
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );

    return (
      <div
        key={shift.id}
        className="h-full relative group/card"
        onDoubleClick={() => !isLocked && handleEditShift(shift, group, subGroup, date)}
      >
        <SmartShiftCard
          shift={shift.rawShift}
          variant="compact"
          groupColor={accentColor}
          compliance={complianceMap?.[shift.id]}
          headerAction={canEdit && !isBulkMode ? menu : undefined}
          className={cn(isPastDate && "opacity-60")}
          isSelected={isBulkMode && selectedShiftIds.has(shift.id)}
          onClick={() => isBulkMode && toggleShiftSelection(shift.id)}
          isLocked={isLocked}
        />
      </div>
    );
  };

  // ==================== LOADING STATE ====================
  if (isShiftsLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-[#0a0f1e]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400 mx-auto mb-2" />
          <p className="text-white/60">Loading shifts...</p>
        </div>
      </div>
    );
  }

  // ==================== MAIN RENDER ====================
  return (
    <DndProvider backend={HTML5Backend}>
      <div className={cn(
        "flex flex-col h-full transition-colors",
        isDark ? 'bg-[#0a0f1e]' : 'bg-gray-50'
      )}>

        {/* Main Content */}
        <ScrollArea className="flex-1">
          {/* Shift Card Legend (collapsible) */}
          {showLegend && (
            <div className="px-4 pt-4">
              <ShiftCardLegend />
            </div>
          )}

          <div className="p-4 space-y-6">
            {visualGroups.map((group) => {
              const glassStyle = GLASS_STYLES[group.type];
              const totalShifts = group.subGroups.reduce(
                (acc, sg) => acc + Object.values(sg.shifts).reduce((a, s) => a + s.length, 0),
                0
              );

              return (
                <div
                  key={group.id}
                  className={cn('rounded-2xl overflow-hidden', glassStyle.container)}
                >
                  {/* Group Header with Collapse Toggle + Stats */}
                  <div className={cn('px-5 py-4', glassStyle.header)}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Collapse Toggle Button */}
                        <button
                          onClick={() => toggleGroupCollapse(group.id)}
                          className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/20 transition-colors"
                          aria-label={collapsedGroups.has(group.id) ? 'Expand group' : 'Collapse group'}
                        >
                          {collapsedGroups.has(group.id) ? (
                            <ChevronRight className="h-4 w-4 text-white" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-white" />
                          )}
                        </button>
                        <div className="w-3 h-3 rounded-full bg-white/80 shadow-lg" />
                        <h3 className={cn('text-lg font-bold tracking-wide', glassStyle.headerText)}>
                          {group.name}
                        </h3>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Inline Group Stats */}
                        <GroupStatsSummary
                          shifts={externalShifts.filter(s => s.group_type === group.type)}
                          compact
                          className="text-white/70"
                        />
                        <Badge className="bg-white/20 border-white/30 text-white backdrop-blur-sm">
                          {totalShifts} shift{totalShifts !== 1 ? 's' : ''}
                        </Badge>
                        {/* Add Subgroup Button (Header) */}
                        {canEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddSubGroup(group);
                            }}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all border shadow-sm",
                              glassStyle.accent === 'emerald'
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/30"
                                : glassStyle.accent === 'blue'
                                  ? "bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20 hover:border-blue-500/30"
                                  : "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/30"
                            )}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add Subgroup
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Collapsible Content */}
                  {!collapsedGroups.has(group.id) && (
                    <div className="overflow-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-black/20 sticky top-0 z-20">
                            <th className={cn(
                              "sticky left-0 z-10 backdrop-blur-sm border-r px-4 py-3 text-left font-medium text-sm min-w-[160px]",
                              isDark ? "bg-[#0d1424]/90 border-white/5 text-white/70" : "bg-white/95 border-gray-200 text-gray-500"
                            )}>
                              Sub-Group
                            </th>
                            {dates.map((date, idx) => {
                              const dateIsToday = isToday(date);
                              const dateIsPast = isBefore(startOfDay(date), startOfDay(new Date()));
                              const isGhost = !isDateInTemplate(date);

                              return (
                                <th
                                  key={idx}
                                  className={cn(
                                    'px-3 py-3 text-center font-medium text-sm min-w-[280px]',
                                    idx < dates.length - 1 && (isDark ? 'border-r border-white/5' : 'border-r border-gray-200'),
                                    // Ghost cell styling
                                    isGhost && 'bg-gray-800/40 border-dashed border-white/10 opacity-50',
                                    // Today highlighting (only if not ghost)
                                    !isGhost && dateIsToday && (isDark ? 'bg-purple-600/20 border-purple-500/30' : 'bg-purple-100 border-purple-200'),
                                    // Past date styling (only if not ghost and not today)
                                    !isGhost && dateIsPast && !dateIsToday && (isDark ? 'opacity-50' : 'opacity-40 bg-gray-50')
                                  )}
                                >
                                  <div className={cn(
                                    "font-semibold",
                                    isGhost
                                      ? 'text-gray-500'
                                      : dateIsToday
                                        ? (isDark ? 'text-purple-300' : 'text-purple-700')
                                        : (isDark ? 'text-white' : 'text-gray-900')
                                  )}>
                                    {format(date, 'EEE')}
                                  </div>
                                  <div className={cn(
                                    "text-xs font-normal",
                                    isGhost
                                      ? 'text-gray-600'
                                      : dateIsToday
                                        ? (isDark ? 'text-purple-400' : 'text-purple-600')
                                        : (isDark ? 'text-white/50' : 'text-gray-500')
                                  )}>
                                    {format(date, 'dd MMM')}
                                  </div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {group.subGroups.map((subGroup, subIdx) => (
                            <tr
                              key={subGroup.id}
                              className={cn(
                                'transition-colors',
                                isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50',
                                subIdx < group.subGroups.length - 1 && (isDark ? 'border-b border-white/5' : 'border-b border-gray-200')
                              )}
                            >
                              <td className={cn(
                                "sticky left-0 z-10 backdrop-blur-sm border-r px-4 py-3 align-top",
                                isDark ? "bg-[#0d1424]/90 border-white/5" : "bg-white/95 border-gray-200"
                              )}>
                                <span className={cn("text-sm font-medium", isDark ? "text-white/90" : "text-gray-900")}>
                                  {subGroup.name}
                                </span>
                              </td>

                              {dates.map((date, dateIdx) => {
                                const dateKey = format(date, 'yyyy-MM-dd');
                                const cellShifts = subGroup.shifts[dateKey] || [];
                                const cellIsToday = isToday(date);
                                const cellIsPast = isBefore(startOfDay(date), startOfDay(new Date()));
                                const isGhost = !isDateInTemplate(date);

                                return (
                                  <td
                                    key={dateIdx}
                                    className={cn(
                                      'px-2 py-3 align-top min-h-[100px] relative',
                                      dateIdx < dates.length - 1 && (isDark ? 'border-r border-white/5' : 'border-r border-gray-200'),
                                      // Ghost cell styling
                                      isGhost && 'bg-gray-800/40 border-dashed border-white/10 cursor-pointer hover:bg-gray-700/40',
                                      // Today highlighting (only if not ghost)
                                      !isGhost && cellIsToday && (isDark ? 'bg-purple-600/10' : 'bg-purple-50'),
                                      // Past date styling (only if not ghost and not today)
                                      !isGhost && cellIsPast && !cellIsToday && (isDark ? 'opacity-50 bg-black/20' : 'opacity-40 bg-gray-50')
                                    )}
                                    onClick={isGhost && onNavigateToMonth ? () => onNavigateToMonth(date) : undefined}
                                  >
                                    {isGhost ? (
                                      // Ghost Cell Content - "Go to [Month]" link
                                      <div className="absolute inset-0 flex items-center justify-center">
                                        <span className="text-gray-500 text-sm font-medium hover:text-gray-300 transition-colors">
                                          Go to {format(date, 'MMMM')} →
                                        </span>
                                      </div>
                                    ) : (
                                      // Active Cell Content - Shifts and Add button
                                      <div className="grid grid-cols-1 gap-1.5 min-h-[60px]">
                                        {isBucketView ? (() => {
                                          // Bucket View: group cellShifts into buckets and render ShiftBucket components
                                          const bucketInputShifts = cellShifts.map(s => ({
                                            id: s.id,
                                            startTime: s.startTime,
                                            endTime: s.endTime,
                                            isPublished: s.isPublished,
                                            isDraft: s.isDraft,
                                            assignedEmployeeId: s.assignedEmployeeId,
                                            isLocked: s.isLocked ?? isShiftLocked(s.rawShift.shift_date, s.rawShift.start_time, 'roster_management'),
                                          }));
                                          const buckets = groupShiftsIntoBuckets(bucketInputShifts, subGroup.name, dateKey);

                                          return buckets.map(bucket => {
                                            const bucketShiftData: BucketShiftData[] = bucket.shiftIds.map(sid => {
                                              const sd = cellShifts.find(cs => cs.id === sid)!;
                                              return {
                                                id: sd.id,
                                                role: sd.role,
                                                startTime: sd.startTime,
                                                endTime: sd.endTime,
                                                employeeName: sd.employeeName,
                                                isAssigned: !!sd.assignedEmployeeId,
                                                isPublished: sd.isPublished,
                                                isDraft: sd.isDraft,
                                                isLocked: sd.isLocked ?? isShiftLocked(sd.rawShift.shift_date, sd.rawShift.start_time, 'roster_management'),
                                                assignedEmployeeId: sd.assignedEmployeeId,
                                              };
                                            });

                                            return (
                                              <ShiftBucket
                                                key={bucket.key}
                                                bucket={bucket}
                                                shifts={bucketShiftData}
                                                canEdit={canEdit}
                                                onEditShift={(shiftId) => {
                                                  const sd = cellShifts.find(cs => cs.id === shiftId);
                                                  if (sd) handleEditShift(sd, group, subGroup, date);
                                                }}
                                                onDeleteShift={(shiftId) => {
                                                  const sd = cellShifts.find(cs => cs.id === shiftId);
                                                  if (sd) handleDeleteShift(sd);
                                                }}
                                                onPublishShift={(shiftId) => {
                                                  const sd = cellShifts.find(cs => cs.id === shiftId);
                                                  if (sd) handleRequestPublish(sd);
                                                }}
                                                onBulkPublish={(shiftIds) => {
                                                  bulkPublishMutation.mutate(shiftIds);
                                                }}
                                                onBulkDelete={(shiftIds) => {
                                                  bulkDeleteMutation.mutate(shiftIds);
                                                }}
                                              />
                                            );
                                          });
                                        })() : (
                                          cellShifts.map((shift) =>
                                            renderShiftCard(shift, group, subGroup, date)
                                          )
                                        )}

                                        {/* Add Shift Button - Hidden for past dates and ghost cells */}
                                        {!isBulkMode && canEdit && !cellIsPast && (
                                          <button
                                            onClick={() => handleAddShift(group, subGroup, date)}
                                            className="w-full h-8 flex items-center justify-center rounded-lg border border-dashed border-white/10 hover:border-white/30 hover:bg-white/5 transition-all text-white/30 hover:text-white group/add"
                                            title="Add Shift"
                                          >
                                            <Plus className="h-4 w-4 opacity-50 group-hover/add:opacity-100 transition-opacity" />
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}

                        </tbody>
                      </table>
                    </div>
                  )
                  }
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Delete Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent className="bg-[#1a2744] border-white/10">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">Delete Shift?</AlertDialogTitle>
              <AlertDialogDescription className="text-white/60">
                This action cannot be undone. The shift "{shiftToDelete?.role}" will be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                className="bg-white/5 border-white/10 text-white hover:bg-white/10"
                disabled={isDeleting}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteShift}
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Add/Edit Shift Modal */}
        <EnhancedAddShiftModal
          isOpen={isAddShiftOpen}
          onClose={() => {
            setIsAddShiftOpen(false);
            setShiftContext(null);
            setIsEditMode(false);
            setEditingShift(null);
          }}
          onSuccess={handleShiftCreated}
          context={shiftContext}
          editMode={isEditMode}
          existingShift={editingShift}
        />

        {/* Bulk Actions */}
        {
          isBulkMode && selectedShiftIds.size > 0 && (
            <BulkActionsToolbar
              selectedCount={selectedShiftIds.size}
              selectedShiftIds={Array.from(selectedShiftIds)}
              onClearSelection={() => setSelectedShiftIds(new Set())}
              onSelectAll={handleSelectAll}
              onDelete={handleBulkDelete}
              onPublish={async (shiftIds) => {
                try {
                  await bulkPublishMutation.mutateAsync(shiftIds);
                  toast({
                    title: "Shifts Published",
                    description: `Successfully published ${shiftIds.length} shift${shiftIds.length !== 1 ? 's' : ''}.`
                  });
                  setSelectedShiftIds(new Set());
                } catch (error: any) {
                  console.error('[GroupModeView] Publish failed:', error);
                  toast({
                    title: "Publish Failed",
                    description: error.message || "An unexpected error occurred.",
                    variant: "destructive"
                  });
                }
              }}
              allowedActions={(() => {
                const selected = externalShifts.filter(s => selectedShiftIds.has(s.id));
                const actions = getAllowedActions(selected);
                if (selectedShiftIds.size > 0 && process.env.NODE_ENV === 'development') {
                  console.log('[GroupModeView] Selected Shifts:', selected.map(s => ({
                    id: s.id,
                    assigned_id: s.assigned_employee_id,
                    bidding: s.bidding_status !== 'not_on_bidding',
                    cancelled: s.is_cancelled
                  })));
                  console.log('[GroupModeView] Allowed Actions:', actions);
                }
                return actions;
              })()}
            />
          )
        }
      </div >

      {/* Confirmation Dialog */}
      < AlertDialog open={confirmActionOpen} onOpenChange={setConfirmActionOpen} >
        <AlertDialogContent className="bg-[#1a2744] border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <Send className="h-5 w-5 text-emerald-400" />
              Publish Shift
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/70">
              {pendingAction?.shift.rawShift.assigned_employee_id ? (
                "This shift is assigned. Publishing will send a job offer to the employee. They must accept it to confirm."
              ) : (
                "This shift is unassigned. Publishing will open it for bidding to eligible employees."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-white/5 border-white/10 text-white hover:bg-white/10"
              disabled={isProcessingAction}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                executePendingAction();
              }}
              className={cn(
                "text-white",
                pendingAction?.type === 'publish'
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-indigo-600 hover:bg-indigo-700"
              )}
              disabled={isProcessingAction}
            >
              {isProcessingAction ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog >

      {/* Emergency Cover Alert */}
      < AlertDialog open={isEmergencyAlertOpen} onOpenChange={setIsEmergencyAlertOpen} >
        <AlertDialogContent className="bg-red-950 border-red-500/50 backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-400 flex items-center gap-2">
              <Ban className="h-5 w-5" />
              Emergency Cover Required
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/90 text-base">
              {emergencyAlertMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/10 text-white hover:bg-white/20 border-white/10">Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog >

      {/* Add SubGroup Dialog */}
      {selectedGroupForSubGroup && (
        <AddSubGroupDialog
          groupId={(selectedGroupForSubGroup as any).dbId || ''}
          groupName={selectedGroupForSubGroup.name}
          onAddSubGroup={onSubGroupAdded}
          open={isAddSubGroupOpen}
          onOpenChange={setIsAddSubGroupOpen}
        />
      )}

    </DndProvider >
  );
};

export default GroupModeView;
