// src/pages/TemplatesPage.tsx
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { useTemplates } from '../state/useTemplates';
import { TemplateConflict } from '../model/templates.types';

// Components
import TemplatesSidebar from '../ui/components/TemplatesSidebar';
import TemplateEditor from '../ui/components/TemplateEditor';
import CreateTemplateDialog from '../ui/dialogs/CreateTemplateDialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Sheet, SheetContent } from '@/modules/core/ui/primitives/sheet';
import { Loader2, AlertTriangle, FileText, Menu } from 'lucide-react';
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [unsavedChangesDialog, setUnsavedChangesDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const [versionConflictDialog, setVersionConflictDialog] = useState(false);
  const [versionConflictInfo, setVersionConflictInfo] = useState<{
    currentVersion: number;
    serverVersion: number;
  } | null>(null);

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
      // If department is selected, template must match it. If not, any template in the org is fine.
      const isCorrectDept = !departmentId || currentTemplate.departmentId === departmentId;
      // If sub-department is selected, template must match it.
      const isCorrectSubDept = !subDepartmentId || currentTemplate.subDepartmentId === subDepartmentId;

      if (!isCorrectOrg || !isCorrectDept || !isCorrectSubDept) {
        console.log('[TemplatesPage] Scope mismatch detected, clearing selected template');
        setCurrentTemplate(null);
      }
    }
  }, [organizationId, departmentId, subDepartmentId, currentTemplate, setCurrentTemplate]);

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

  const handleSelectTemplate = useCallback(
    async (id: number | string) => {
      const action = async () => {
        const template = await fetchTemplate(String(id));
        if (template) setCurrentTemplate(template);
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

      if (result) setCreateDialogOpen(false);
    },
    [createTemplate]
  );

  // ✅ FIXED: Always return boolean
  const handleSaveChanges = useCallback(async (): Promise<boolean> => {
    const versionCheck = await checkVersion();

    if (versionCheck && !versionCheck.version_match) {
      setVersionConflictInfo({
        currentVersion: currentTemplate?.version || 0,
        serverVersion: versionCheck.current_version,
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

  const handleBack = useCallback(() => {
    confirmAction(() => setCurrentTemplate(null));
  }, [setCurrentTemplate, confirmAction]);

  const handleArchiveTemplate = useCallback(
    async (id: string) => {
      await updateTemplateStatus(id, 'archived');
    },
    [updateTemplateStatus]
  );

  const handleUpdateStatus = useCallback(
    async (id: string, status: string) => {
      return await updateTemplateStatus(id, status);
    },
    [updateTemplateStatus]
  );

  const sidebarTemplates = templates.map((t) => ({
    id: String(t.id),
    name: t.name,
    description: t.description,
    status: t.status,
    version: t.version,
    startDate: t.startDate ?? null,
    endDate: t.endDate ?? null,
    updatedAt: t.updatedAt,
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
  }));

  const [statusFilter, setStatusFilter] = useState<'published' | 'draft' | 'archived'>('published');
  const [searchQuery, setSearchQuery] = useState('');
  const { isDark } = useTheme();

  const counts = useMemo(
    () => ({
      draft: templates.filter((t) => t.status === 'draft').length,
      published: templates.filter((t) => t.status === 'published').length,
      archived: templates.filter((t) => t.status === 'archived').length,
    }),
    [templates]
  );

  const sidebarProps = {
    templates: sidebarTemplates,
    selectedTemplateId: currentTemplate?.id ? String(currentTemplate.id) : null,
    isLoading: isLoading,
    onSelectTemplate: handleSelectTemplate,
    onCreateTemplate: () => setCreateDialogOpen(true),
    onDeleteTemplate: deleteTemplate,
    onDuplicateTemplate: duplicateTemplate,
    onRenameTemplate: renameTemplate,
    onArchiveTemplate: handleArchiveTemplate,
    statusFilter,
    searchQuery,
  };

  return (
    <div className="h-full flex flex-col overflow-hidden px-4 md:px-8 pb-24 md:pb-0">
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 pt-4 pb-4 lg:pb-6">
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
          <div className="mt-4 lg:mt-6">
            <TemplateFunctionBar
              transparent
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onCreateTemplate={() => setCreateDialogOpen(true)}
              counts={counts}
            />
          </div>
        </div>
      </div>

      {/* ── Main Content Area ─────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden pt-2 lg:pt-4">
        <div className={cn(
          "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col md:flex-row",
          isDark 
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {error && !isLoading && templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full w-full">
              <AlertTriangle className="h-10 w-10 text-red-500 mb-4" />
              <p>{error}</p>
              <Button onClick={() => fetchTemplates({
                organizationId,
                departmentId: departmentId || undefined,
                subDepartmentId: subDepartmentId || undefined,
              })} className="mt-4">Retry</Button>
            </div>
          ) : (isLoading || isScopeLoading) && templates.length === 0 ? (
            <div className="flex items-center justify-center h-full w-full">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
              {/* Mobile sidebar drawer */}
              <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
                <SheetContent side="left" className="p-0 w-[320px]">
                  <TemplatesSidebar {...sidebarProps} onSelectTemplate={(id) => { handleSelectTemplate(id); setMobileSidebarOpen(false); }} />
                </SheetContent>
              </Sheet>

              {/* Desktop sidebar — always visible */}
              <div className="hidden md:flex border-r border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-black/10">
                <TemplatesSidebar {...sidebarProps} />
              </div>

              <div className="flex-1 overflow-hidden flex flex-col">
                {/* Mobile hamburger to open sidebar */}
                <div className="md:hidden flex items-center px-4 pt-3">
                  <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setMobileSidebarOpen(true)}>
                    <Menu className="h-5 w-5" />
                  </Button>
                </div>
                {localTemplate ? (
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
                ) : (
                  <div className="flex flex-col flex-1 items-center justify-center h-full text-muted-foreground bg-muted/5">
                    <FileText className="h-16 w-16 mb-4 opacity-50" />
                    <p className="text-lg font-medium">Select a template to view details</p>
                    <p className="text-sm opacity-60">
                      Or create a new one from the functional bar
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

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
              Discard your changes?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executePendingAction}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={versionConflictDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Version conflict</AlertDialogTitle>
            <AlertDialogDescription>
              Server version is newer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleVersionConflictRefresh}>
              Refresh
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TemplatesPage;
