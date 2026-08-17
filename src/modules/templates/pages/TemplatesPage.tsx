// src/pages/TemplatesPage.tsx
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTemplates } from '../state/useTemplates';
import { TemplateConflict } from '../model/templates.types';

// Components
import TemplateExplorer, { ExplorerTemplate } from '../ui/components/TemplateExplorer';
import TemplateEditor from '../ui/components/TemplateEditor';
import CreateTemplateDialog from '../ui/dialogs/CreateTemplateDialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Loader2, AlertTriangle, FileText } from 'lucide-react';
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
import { useToast } from '@/modules/core/hooks/use-toast';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { TemplateFunctionBar } from '../ui/components/TemplateFunctionBar';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

const TemplatesPage: React.FC = () => {
  const { toast } = useToast();
  const { scope, setScope, isGammaLocked, isLoading: isScopeLoading } = useScopeFilter('managerial');

  const {
    templates,
    currentTemplate,
    localTemplate,
    isLoading,
    isSaving,
    error,
    hasUnsavedChanges,
    fetchTemplates,
    fetchTemplate,
    createTemplate,
    saveTemplate,
    deleteTemplate,
    duplicateTemplate,
    updateTemplateStatus,
    renameTemplate,
    setCurrentTemplate,
    updateLocalGroup,
    addLocalSubgroup,
    updateLocalSubgroup,
    deleteLocalSubgroup,
    cloneLocalSubgroup,
    addLocalShift,
    updateLocalShift,
    deleteLocalShift,
    discardChanges,
    validateName,
    checkVersion,
  } = useTemplates();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const [unsavedChangesDialog, setUnsavedChangesDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const [versionConflictDialog, setVersionConflictDialog] = useState(false);
  const [versionConflictInfo, setVersionConflictInfo] = useState<{
    currentVersion: number;
    serverVersion: number;
  } | null>(null);

  const [statusFilter, setStatusFilter] = useState<'published' | 'draft' | 'archived'>('published');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<string>('updated-desc');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const { isDark } = useTheme();

  const organizationId = scope.org_ids[0] ?? '';
  const departmentId = scope.dept_ids[0] || '';
  const subDepartmentId = scope.subdept_ids[0] || '';

  useEffect(() => {
    if (organizationId) {
      fetchTemplates({
        organizationId,
        departmentId: departmentId || undefined,
        subDepartmentId: subDepartmentId || undefined,
      });
    }
  }, [fetchTemplates, organizationId, departmentId, subDepartmentId]);

  // Handle scope change mid-editing: Clear selection if it no longer matches the filter
  useEffect(() => {
    if (currentTemplate) {
      const isCorrectOrg = currentTemplate.organizationId === organizationId;
      const isCorrectDept = !departmentId || currentTemplate.departmentId === departmentId;
      const isCorrectSubDept = !subDepartmentId || currentTemplate.subDepartmentId === subDepartmentId;

      if (!isCorrectOrg || !isCorrectDept || !isCorrectSubDept) {
        console.log('[TemplatesPage] Scope mismatch detected, clearing selected template');
        setCurrentTemplate(null);
      }
    }
  }, [organizationId, departmentId, subDepartmentId, currentTemplate, setCurrentTemplate]);

  // Auto-switch to Draft filter if there are no published templates available
  useEffect(() => {
    if (templates.length > 0) {
      const hasPublished = templates.some((t) => t.status === 'published');
      const hasDraft = templates.some((t) => t.status === 'draft');
      if (!hasPublished && hasDraft && statusFilter === 'published' && !currentTemplate) {
        setStatusFilter('draft');
      }
    }
  }, [templates, statusFilter, currentTemplate]);

  const confirmAction = useCallback(
    (action: () => void) => {
      if (hasUnsavedChanges) {
        setPendingAction(() => action);
        setUnsavedChangesDialog(true);
      } else {
        action();
      }
    },
    [hasUnsavedChanges]
  );

  const executePendingAction = useCallback(() => {
    pendingAction?.();
    setPendingAction(null);
    setUnsavedChangesDialog(false);
  }, [pendingAction]);

  // Single click row selection in the explorer
  const handleSelectTemplate = useCallback((id: string) => {
    setSelectedTemplateId(id);
  }, []);

  // Double click / Enter / Open button: Loads template and opens full-width editor
  const handleOpenTemplate = useCallback(
    async (id: number | string) => {
      const action = async () => {
        setSelectedTemplateId(String(id));
        const template = await fetchTemplate(String(id));
        if (template) {
          setCurrentTemplate(template);
        }
      };
      confirmAction(action);
    },
    [fetchTemplate, setCurrentTemplate, confirmAction]
  );

  const handleCreateTemplate = useCallback(
    async (input: {
      name: string;
      description: string;
      organizationId: string;
      departmentId: string;
      subDepartmentId: string;
    }) => {
      const result = await createTemplate({
        name: input.name,
        description: input.description,
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        subDepartmentId: input.subDepartmentId,
      });

      if (result) {
        setCreateDialogOpen(false);
        setSelectedTemplateId(String(result.id));
      }
    },
    [createTemplate]
  );

  const handleSaveChanges = useCallback(async (): Promise<boolean> => {
    const versionCheck = await checkVersion();

    if (versionCheck && !versionCheck.version_match) {
      setVersionConflictInfo({
        currentVersion: currentTemplate?.version || 0,
        serverVersion: versionCheck.current_version ?? 0,
      });
      setVersionConflictDialog(true);
      return false;
    }

    const result = await saveTemplate();
    return Boolean(result);
  }, [saveTemplate, checkVersion, currentTemplate?.version]);

  const handleVersionConflictRefresh = useCallback(async () => {
    if (!currentTemplate) return;

    const refreshed = await fetchTemplate(String(currentTemplate.id));
    if (refreshed) setCurrentTemplate(refreshed);

    setVersionConflictDialog(false);
    setVersionConflictInfo(null);
  }, [currentTemplate, fetchTemplate, setCurrentTemplate]);

  // Back button in the editor: returns to the file explorer
  const handleBack = useCallback(() => {
    confirmAction(() => {
      setCurrentTemplate(null);
    });
  }, [setCurrentTemplate, confirmAction]);

  const handleArchiveTemplate = useCallback(
    async (id: string) => {
      await updateTemplateStatus(id, 'archived');
      if (currentTemplate?.id && String(currentTemplate.id) === id) {
        setCurrentTemplate(null);
      }
    },
    [updateTemplateStatus, currentTemplate?.id, setCurrentTemplate]
  );

  const handleRestoreTemplate = useCallback(
    async (id: string) => {
      await updateTemplateStatus(id, 'draft');
    },
    [updateTemplateStatus]
  );

  const handleUpdateStatus = useCallback(
    async (id: string, status: string) => {
      return await updateTemplateStatus(id, status);
    },
    [updateTemplateStatus]
  );

  const explorerTemplates: ExplorerTemplate[] = useMemo(
    () =>
      templates.map((t) => ({
        id: String(t.id),
        name: t.name,
        description: t.description,
        status: t.status,
        version: t.version,
        startDate: t.startDate ?? null,
        endDate: t.endDate ?? null,
        updatedAt: t.updatedAt,
        createdAt: (t as any).createdAt,
        publishedAt: t.publishedAt ?? null,
        organizationName: t.organizationName,
        departmentName: t.departmentName,
        subDepartmentName: t.subDepartmentName,
        groupCount: t.groups?.length ?? 0,
        subgroupCount:
          t.groups?.reduce((a, g) => a + (g.subGroups?.length ?? 0), 0) ?? 0,
        shiftCount:
          t.groups?.reduce(
            (a, g) =>
              a +
              (g.subGroups?.reduce((sa, sg) => sa + (sg.shifts?.length ?? 0), 0) ??
                0),
            0
          ) ?? 0,
      })),
    [templates]
  );

  const counts = useMemo(
    () => ({
      draft: templates.filter((t) => t.status === 'draft').length,
      published: templates.filter((t) => t.status === 'published').length,
      archived: templates.filter((t) => t.status === 'archived').length,
    }),
    [templates]
  );

  return (
    <div className="h-full flex flex-col overflow-hidden px-4 md:px-8 pb-24 md:pb-0 space-y-4">
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 pt-4 pb-2 lg:pb-4">
        <div className={cn(
          "rounded-[32px] p-4 lg:p-6 transition-all border",
          isDark 
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {/* Row 1: Identity & Clock + Row 2: Scope Filter */}
          <PersonalPageHeader
            title="My Templates"
            Icon={FileText}
            scope={scope}
            setScope={setScope}
            isGammaLocked={isGammaLocked}
            mode="managerial"
          />

          {/* Row 3: Function Bar */}
          {!localTemplate && (
            <div className="mt-4 lg:mt-6">
              <TemplateFunctionBar
                transparent
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                onCreateTemplate={() => setCreateDialogOpen(true)}
                counts={counts}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Main Content Area (Full-Width Explorer or Editor) ─────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={cn(
          "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col",
          isDark 
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {error && !isLoading && templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full w-full px-6 text-center" role="alert">
              <AlertTriangle className="h-10 w-10 text-red-500 mb-4" aria-hidden="true" />
              <p className="text-foreground">{error}</p>
              <Button onClick={() => fetchTemplates({
                organizationId,
                departmentId: departmentId || undefined,
                subDepartmentId: subDepartmentId || undefined,
              })} className="mt-4 h-11 min-h-[44px] px-5 font-bold">Retry</Button>
            </div>
          ) : (isLoading || isScopeLoading) && templates.length === 0 ? (
            <div className="flex items-center justify-center h-full w-full" role="status">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading templates…</span>
            </div>
          ) : localTemplate ? (
            /* ── Full-Width Template Editor ───────────────────────────── */
            <div className="flex-1 overflow-hidden flex flex-col h-full animate-in fade-in-50 duration-200">
              <TemplateEditor
                template={localTemplate}
                isSaving={isSaving}
                hasUnsavedChanges={hasUnsavedChanges}
                onBack={handleBack}
                onUpdateGroup={updateLocalGroup}
                onAddSubgroup={addLocalSubgroup}
                onUpdateSubgroup={updateLocalSubgroup}
                onDeleteSubgroup={deleteLocalSubgroup}
                onCloneSubgroup={cloneLocalSubgroup}
                onAddShift={addLocalShift}
                onUpdateShift={updateLocalShift}
                onDeleteShift={deleteLocalShift}
                onSaveChanges={handleSaveChanges}
                onUpdateStatus={handleUpdateStatus}
                onDiscardChanges={discardChanges}
              />
            </div>
          ) : (
            /* ── File Explorer Template List ──────────────────────────── */
            <div className="flex-1 overflow-hidden flex flex-col h-full animate-in fade-in-50 duration-200">
              <TemplateExplorer
                templates={explorerTemplates}
                selectedTemplateId={selectedTemplateId}
                onSelectTemplate={handleSelectTemplate}
                onOpenTemplate={handleOpenTemplate}
                onCreateTemplate={() => setCreateDialogOpen(true)}
                onDuplicateTemplate={duplicateTemplate}
                onDeleteTemplate={deleteTemplate}
                onRenameTemplate={renameTemplate}
                onArchiveTemplate={handleArchiveTemplate}
                onRestoreTemplate={handleRestoreTemplate}
                isLoading={isLoading}
                statusFilter={statusFilter}
                searchQuery={searchQuery}
                sortBy={sortBy}
                onSortChange={setSortBy}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onSwitchToDraft={() => setStatusFilter('draft')}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────── */}
      <CreateTemplateDialog
        isOpen={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateTemplate={handleCreateTemplate}
        initialScope={{ organizationId, departmentId, subDepartmentId }}
      />

      <AlertDialog open={unsavedChangesDialog} onOpenChange={setUnsavedChangesDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes in this template. Are you sure you want to discard them and return to the templates list?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executePendingAction}>
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={versionConflictDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Version conflict</AlertDialogTitle>
            <AlertDialogDescription>
              Another user or process has updated this template (Server v{versionConflictInfo?.serverVersion}, Local v{versionConflictInfo?.currentVersion}). Please refresh to load the latest version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleVersionConflictRefresh}>
              Refresh &amp; Load Latest
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TemplatesPage;
