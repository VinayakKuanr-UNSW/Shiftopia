// src/modules/templates/state/useTemplateEditor.ts
// Local editor state management for Templates
// This hook manages in-memory editing state, separate from server state

import { useState, useCallback, useRef, useMemo } from 'react';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
    Template,
    Group,
    SubGroup,
    TemplateShift,
} from '../model/templates.types';
import { generateTempId } from '../utils/id-generator';
import {
    hasFixedSubgroup,
    OFFICE_SUBGROUP_NAME,
    sameSubgroupName,
    uniqueCopyName,
} from '@/modules/rosters/domain/subgroupRules';
import { sanitizeString, sanitizeTemplateName } from '../utils/template-sanitizer';

/* ============================================================
   TYPES
   ============================================================ */

export interface UseTemplateEditorReturn {
    // State
    localTemplate: Template | null;
    hasUnsavedChanges: boolean;

    // Initialization
    initializeEditor: (template: Template) => void;
    resetEditor: () => void;

    // Template-level updates
    updateLocalTemplate: (updates: Partial<Template>) => void;

    // Group updates
    updateLocalGroup: (groupId: string | number, updates: Partial<Group>) => void;

    // Subgroup CRUD
    addLocalSubgroup: (groupId: string | number, name: string) => void;
    updateLocalSubgroup: (
        groupId: string | number,
        subgroupId: string | number,
        updates: Partial<SubGroup>
    ) => void;
    deleteLocalSubgroup: (groupId: string | number, subgroupId: string | number) => void;
    cloneLocalSubgroup: (groupId: string | number, subgroupId: string | number) => void;

    // Shift CRUD
    addLocalShift: (
        groupId: string | number,
        subgroupId: string | number,
        shift: Partial<TemplateShift>
    ) => void;
    updateLocalShift: (
        groupId: string | number,
        subgroupId: string | number,
        shiftId: string | number,
        updates: Partial<TemplateShift>
    ) => void;
    deleteLocalShift: (
        groupId: string | number,
        subgroupId: string | number,
        shiftId: string | number
    ) => void;

    // Undo/Redo
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;

    // Discard
    discardChanges: () => void;
}

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */

function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

/* ============================================================
   HOOK IMPLEMENTATION
   ============================================================ */

export function useTemplateEditor(): UseTemplateEditorReturn {
    const { toast } = useToast();

    // Core state
    const [localTemplate, setLocalTemplate] = useState<Template | null>(null);

    // History for undo/redo
    const [history, setHistory] = useState<Template[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // Reference to the original template (for discard and change detection)
    const originalTemplateRef = useRef<Template | null>(null);

    // Computed: has unsaved changes
    const hasUnsavedChanges = useMemo(() => {
        if (!localTemplate || !originalTemplateRef.current) return false;
        return JSON.stringify(localTemplate) !== JSON.stringify(originalTemplateRef.current);
    }, [localTemplate]);

    // Computed: can undo/redo
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    /* ============================================================
       INITIALIZATION
       ============================================================ */

    const initializeEditor = useCallback((template: Template) => {
        const cloned = deepClone(template);
        setLocalTemplate(cloned);
        originalTemplateRef.current = deepClone(template);
        setHistory([cloned]);
        setHistoryIndex(0);
    }, []);

    const resetEditor = useCallback(() => {
        setLocalTemplate(null);
        originalTemplateRef.current = null;
        setHistory([]);
        setHistoryIndex(-1);
    }, []);

    /* ============================================================
       HISTORY MANAGEMENT
       ============================================================ */

    const pushHistory = useCallback((newState: Template) => {
        setHistory(prev => {
            // Remove any future states (if we undo'd and then made a change)
            const newHistory = prev.slice(0, historyIndex + 1);
            // Add new state
            newHistory.push(deepClone(newState));
            // Limit history size
            if (newHistory.length > 50) newHistory.shift();
            return newHistory;
        });
        setHistoryIndex(prev => Math.min(prev + 1, 49));
    }, [historyIndex]);

    const undo = useCallback(() => {
        if (!canUndo) return;
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setLocalTemplate(deepClone(history[newIndex]));
    }, [canUndo, historyIndex, history]);

    const redo = useCallback(() => {
        if (!canRedo) return;
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setLocalTemplate(deepClone(history[newIndex]));
    }, [canRedo, historyIndex, history]);

    /* ============================================================
       TEMPLATE-LEVEL UPDATES
       ============================================================ */

    const updateLocalTemplate = useCallback((updates: Partial<Template>) => {
        setLocalTemplate(prev => {
            if (!prev) return null;

            const sanitized: Partial<Template> = { ...updates };
            if (sanitized.name) sanitized.name = sanitizeTemplateName(sanitized.name);
            if (sanitized.description) sanitized.description = sanitizeString(sanitized.description);

            const updated = { ...prev, ...sanitized };
            pushHistory(updated);
            return updated;
        });
    }, [pushHistory]);

    /* ============================================================
       GROUP UPDATES
       ============================================================ */

    const updateLocalGroup = useCallback((
        groupId: string | number,
        updates: Partial<Group>
    ) => {
        setLocalTemplate(prev => {
            if (!prev) return null;
            const updated = {
                ...prev,
                groups: prev.groups.map(g =>
                    g.id === groupId ? { ...g, ...updates } : g
                ),
            };
            pushHistory(updated);
            return updated;
        });
    }, [pushHistory]);

    /* ============================================================
       SUBGROUP CRUD
       ============================================================ */

    const addLocalSubgroup = useCallback((
        groupId: string | number,
        name: string
    ) => {
        const sanitizedName = sanitizeString(name);
        if (!sanitizedName) {
            toast({
                title: 'Invalid name',
                description: 'Subgroup name cannot be empty',
                variant: 'destructive',
            });
            return;
        }

        setLocalTemplate(prev => {
            if (!prev) return null;

            const updated = {
                ...prev,
                groups: prev.groups.map(g => {
                    if (g.id !== groupId) return g;

                    if (hasFixedSubgroup(g.name)) {
                        toast({
                            title: 'Office has one sub-group',
                            description: `Office always has exactly one sub-group, ${OFFICE_SUBGROUP_NAME}.`,
                            variant: 'destructive',
                        });
                        return g;
                    }

                    // Check for duplicate name
                    if (g.subGroups.some(sg =>
                        sg.name.toLowerCase() === sanitizedName.toLowerCase()
                    )) {
                        toast({
                            title: 'Duplicate name',
                            description: `A subgroup named "${sanitizedName}" already exists`,
                            variant: 'destructive',
                        });
                        return g;
                    }

                    return {
                        ...g,
                        subGroups: [
                            ...g.subGroups,
                            {
                                id: generateTempId('subgroup'),
                                name: sanitizedName,
                                shifts: [],
                                sortOrder: g.subGroups.length,
                            },
                        ],
                    };
                }),
            };

            pushHistory(updated);
            return updated;
        });
    }, [pushHistory, toast]);

    const updateLocalSubgroup = useCallback((
        groupId: string | number,
        subgroupId: string | number,
        updates: Partial<SubGroup>
    ) => {
        if (updates.name) updates.name = sanitizeString(updates.name);

        setLocalTemplate(prev => {
            if (!prev) return null;
            const group = prev.groups.find(g => g.id === groupId);
            if (updates.name !== undefined && group) {
                // The name is how a template sub-group finds its roster sub-group, so
                // it is unique within the group (case-insensitively) and Office's is fixed.
                const refusal = hasFixedSubgroup(group.name)
                    ? `Office's sub-group is always ${OFFICE_SUBGROUP_NAME}.`
                    : group.subGroups.some(sg => sg.id !== subgroupId && sameSubgroupName(sg.name, updates.name))
                        ? `A subgroup named "${updates.name}" already exists`
                        : null;
                if (refusal) {
                    toast({ title: 'Cannot rename', description: refusal, variant: 'destructive' });
                    return prev;
                }
            }
            const updated = {
                ...prev,
                groups: prev.groups.map(g => {
                    if (g.id !== groupId) return g;
                    return {
                        ...g,
                        subGroups: g.subGroups.map(sg =>
                            sg.id === subgroupId ? { ...sg, ...updates } : sg
                        ),
                    };
                }),
            };
            pushHistory(updated);
            return updated;
        });
    }, [pushHistory, toast]);

    const deleteLocalSubgroup = useCallback((
        groupId: string | number,
        subgroupId: string | number
    ) => {
        setLocalTemplate(prev => {
            if (!prev) return null;
            const updated = {
                ...prev,
                groups: prev.groups.map(g => {
                    // Office's Administration is fixed; the database keeps it anyway.
                    if (g.id !== groupId || hasFixedSubgroup(g.name)) return g;
                    return {
                        ...g,
                        subGroups: g.subGroups.filter(sg => sg.id !== subgroupId),
                    };
                }),
            };
            pushHistory(updated);
            return updated;
        });
    }, [pushHistory]);

    const cloneLocalSubgroup = useCallback((
        groupId: string | number,
        subgroupId: string | number
    ) => {
        setLocalTemplate(prev => {
            if (!prev) return null;

            const updated = {
                ...prev,
                groups: prev.groups.map(g => {
                    if (g.id !== groupId || hasFixedSubgroup(g.name)) return g;

                    const original = g.subGroups.find(sg => sg.id === subgroupId);
                    if (!original) return g;

                    const cloned: SubGroup = {
                        ...deepClone(original),
                        id: generateTempId('subgroup'),
                        // "(Copy)", then "(Copy 2)": names are unique within a group.
                        name: uniqueCopyName(original.name, g.subGroups.map(sg => sg.name)),
                        description: original.description,
                        sortOrder: g.subGroups.length,
                        shifts: original.shifts.map((s, idx) => ({
                            ...s,
                            id: generateTempId('shift'),
                            sortOrder: idx,
                            skills: [...(s.skills || [])],
                            licenses: [...(s.licenses || [])],
                            siteTags: [...(s.siteTags || [])],
                            eventTags: [...(s.eventTags || [])],
                            dayOfWeek: s.dayOfWeek !== undefined ? s.dayOfWeek : null,
                            targetEmploymentType: s.targetEmploymentType ?? null,
                            targetRequiresFlexible: s.targetRequiresFlexible ?? false,
                            assignedEmployeeId: s.assignedEmployeeId ?? null,
                            assignedEmployeeName: s.assignedEmployeeName ?? null,
                        })),
                    };

                    return {
                        ...g,
                        subGroups: [...g.subGroups, cloned],
                    };
                }),
            };

            pushHistory(updated);
            return updated;
        });
    }, [pushHistory]);

    /* ============================================================
       SHIFT CRUD
       ============================================================ */

    const addLocalShift = useCallback((
        groupId: string | number,
        subgroupId: string | number,
        shift: Partial<TemplateShift>
    ) => {
        setLocalTemplate(prev => {
            if (!prev) return null;

            const updated = {
                ...prev,
                groups: prev.groups.map(g => {
                    if (g.id !== groupId) return g;
                    return {
                        ...g,
                        subGroups: g.subGroups.map(sg => {
                            if (sg.id !== subgroupId) return sg;
                            return {
                                ...sg,
                                shifts: [
                                    ...sg.shifts,
                                    {
                                        ...shift,
                                        id: generateTempId('shift'),
                                        name: shift.name ? sanitizeString(shift.name) : (shift.roleName || 'New Shift'),
                                        startTime: shift.startTime || '09:00',
                                        endTime: shift.endTime || '17:00',
                                        paidBreakDuration: shift.paidBreakDuration ?? 0,
                                        unpaidBreakDuration: shift.unpaidBreakDuration ?? 0,
                                        skills: [...(shift.skills || [])],
                                        licenses: [...(shift.licenses || [])],
                                        siteTags: [...(shift.siteTags || [])],
                                        eventTags: [...(shift.eventTags || [])],
                                        sortOrder: sg.shifts.length,
                                        dayOfWeek: shift.dayOfWeek !== undefined ? shift.dayOfWeek : null,
                                        targetEmploymentType: shift.targetEmploymentType ?? null,
                                        targetRequiresFlexible: shift.targetRequiresFlexible ?? false,
                                        assignedEmployeeId: shift.assignedEmployeeId ?? null,
                                        assignedEmployeeName: shift.assignedEmployeeName ?? null,
                                    } as TemplateShift,
                                ],
                            };
                        }),
                    };
                }),
            };

            pushHistory(updated);
            return updated;
        });
    }, [pushHistory]);

    const updateLocalShift = useCallback((
        groupId: string | number,
        subgroupId: string | number,
        shiftId: string | number,
        updates: Partial<TemplateShift>
    ) => {
        setLocalTemplate(prev => {
            if (!prev) return null;

            const updated = {
                ...prev,
                groups: prev.groups.map(g => {
                    if (g.id !== groupId) return g;
                    return {
                        ...g,
                        subGroups: g.subGroups.map(sg => {
                            if (sg.id !== subgroupId) return sg;
                            return {
                                ...sg,
                                shifts: sg.shifts.map(s =>
                                    s.id === shiftId ? { ...s, ...updates } : s
                                ),
                            };
                        }),
                    };
                }),
            };

            pushHistory(updated);
            return updated;
        });
    }, [pushHistory]);

    const deleteLocalShift = useCallback((
        groupId: string | number,
        subgroupId: string | number,
        shiftId: string | number
    ) => {
        setLocalTemplate(prev => {
            if (!prev) return null;

            const updated = {
                ...prev,
                groups: prev.groups.map(g => {
                    if (g.id !== groupId) return g;
                    return {
                        ...g,
                        subGroups: g.subGroups.map(sg => {
                            if (sg.id !== subgroupId) return sg;
                            return {
                                ...sg,
                                shifts: sg.shifts.filter(s => s.id !== shiftId),
                            };
                        }),
                    };
                }),
            };

            pushHistory(updated);
            return updated;
        });
    }, [pushHistory]);

    /* ============================================================
       DISCARD CHANGES
       ============================================================ */

    const discardChanges = useCallback(() => {
        if (originalTemplateRef.current) {
            const restored = deepClone(originalTemplateRef.current);
            setLocalTemplate(restored);
            setHistory([restored]);
            setHistoryIndex(0);
            toast({
                title: 'Changes discarded',
                description: 'Reverted to last saved version',
            });
        }
    }, [toast]);

    /* ============================================================
       RETURN
       ============================================================ */

    return {
        localTemplate,
        hasUnsavedChanges,
        initializeEditor,
        resetEditor,
        updateLocalTemplate,
        updateLocalGroup,
        addLocalSubgroup,
        updateLocalSubgroup,
        deleteLocalSubgroup,
        cloneLocalSubgroup,
        addLocalShift,
        updateLocalShift,
        deleteLocalShift,
        canUndo,
        canRedo,
        undo,
        redo,
        discardChanges,
    };
}
