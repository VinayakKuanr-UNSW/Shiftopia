// src/modules/templates/ui/components/TemplateHeader.tsx
// Template Editor Header — restructured per design spec

import React, { useMemo } from 'react';
import {
  ArrowLeft,
  Save,
  Trash2,
  Upload,
  Loader2,
  Lock,
  RotateCw,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import { Template } from '../../model/templates.types';
import { TARGET_EMPLOYMENT_TYPE_LABELS } from '@/modules/core/model/employment.types';
import type { TargetEmploymentType } from '@/modules/core/model/employment.types';

/* ============================================================
   TYPES
   ============================================================ */
interface TemplateHeaderProps {
    template: Template;
    stats: {
        groupCount: number;
        subgroupCount: number;
        shiftCount: number;
    };
    hasUnsavedChanges: boolean;
    isSaving: boolean;
    lastSavedAgo: string;
    onBack: () => void;
    onSave: () => void;
    onDiscard: () => void;
    onArchive: () => void;
    onDownload?: () => void;
    onUpdateStatus: (status: 'draft' | 'published' | 'archived') => void;
}

/* ============================================================
   HELPERS
   ============================================================ */

/**
 * Derive a display label for the predominant target employment type
 * across all shifts in the template.  Returns the label when every
 * shift agrees, "Mixed" when they disagree, and "—" when there are
 * no shifts at all.
 */
function deriveEmploymentTypeSummary(template: Template): string {
  const types = new Set<TargetEmploymentType>();
  for (const group of template.groups) {
    for (const sub of group.subGroups) {
      for (const shift of sub.shifts) {
        if (shift.targetEmploymentType) {
          types.add(shift.targetEmploymentType);
        }
      }
    }
  }
  if (types.size === 0) return '—';
  if (types.size === 1) {
    const t = [...types][0];
    return TARGET_EMPLOYMENT_TYPE_LABELS[t] ?? t;
  }
  return 'Mixed';
}

/* ============================================================
   COMPONENT
   ============================================================ */
export const TemplateHeader: React.FC<TemplateHeaderProps> = ({
    template,
    stats,
    hasUnsavedChanges,
    isSaving,
    lastSavedAgo,
    onBack,
    onSave,
    onDiscard,
    onArchive,
    onDownload,
    onUpdateStatus,
}) => {
    const isPublished = template.status === 'published';
    const isDraft = template.status === 'draft';
    const isArchived = template.status === 'archived';

    const canPublish = isDraft && !isSaving && !hasUnsavedChanges;
    const canSave = hasUnsavedChanges && !isSaving;
    const canDelete = !isSaving;

    const employmentTypeSummary = useMemo(
      () => deriveEmploymentTypeSummary(template),
      [template]
    );

    return (
        // No role="banner": that landmark is for the page-level header, and this
        // one sits inside <main> beneath the page's own. Two banners on a screen
        // make the landmark list useless for navigating.
        <header className="w-full bg-[#f8f9fa] dark:bg-black/20 p-3 sm:p-4 space-y-3">
            {/* 1. TOP NAVIGATION BAR — Back | Name Description */}
            <div className="flex items-center gap-3 px-1 sm:px-2">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    aria-label="Back to templates list"
                    className="text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white font-semibold gap-1.5 h-11 min-h-[44px] px-3 shrink-0"
                >
                    <ArrowLeft className="h-4 w-4" />
                    <span className="text-sm">Back</span>
                </Button>

                <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800 shrink-0" />

                <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-slate-900 dark:text-white text-sm font-bold tracking-tight truncate">
                        {template.name}
                    </span>
                    {template.description && (
                        <span className="text-slate-500 dark:text-slate-400 text-xs font-medium truncate hidden sm:inline">
                            {template.description}
                        </span>
                    )}
                </div>
            </div>

            {/* 2. METADATA CARD — Status | Version | Saved | Employment Type | Groups | Subgroups | Shifts  +  Save | Delete | Publish */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {/* Left Side: Metadata row */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider min-w-0 flex-1">
                    <span className={cn(
                        "px-2 py-0.5 rounded-md font-extrabold text-[11px]",
                        isPublished && "text-emerald-700 bg-emerald-500/15 dark:text-emerald-300 dark:bg-emerald-500/20",
                        isDraft && "text-blue-700 bg-blue-500/15 dark:text-blue-300 dark:bg-blue-500/20",
                        isArchived && "text-purple-700 bg-purple-500/15 dark:text-purple-300 dark:bg-purple-500/20"
                    )}>
                        {template.status === 'published' ? 'READY' : template.status}
                    </span>

                    <span className="opacity-40" aria-hidden="true">•</span>

                    <span>V{template.version}</span>

                    <span className="opacity-40" aria-hidden="true">•</span>

                    <div className="inline-flex items-center gap-1.5 lowercase normal-case whitespace-nowrap">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] shrink-0" />
                        <span className="capitalize text-slate-700 dark:text-slate-300 font-semibold text-xs">Saved {lastSavedAgo.replace(/ ago$/i, '')} ago</span>
                    </div>

                    <span className="opacity-40" aria-hidden="true">•</span>

                    <span className="text-slate-700 dark:text-slate-300 font-semibold normal-case whitespace-nowrap">{employmentTypeSummary}</span>

                    <span className="opacity-40" aria-hidden="true">•</span>

                    <span className="text-slate-700 dark:text-slate-300 font-semibold normal-case whitespace-nowrap">{stats.groupCount} Groups</span>

                    <span className="opacity-40" aria-hidden="true">•</span>

                    <span className="text-slate-700 dark:text-slate-300 font-semibold normal-case whitespace-nowrap">{stats.subgroupCount} Subgroups</span>

                    <span className="opacity-40" aria-hidden="true">•</span>

                    <span className="text-slate-700 dark:text-slate-300 font-semibold normal-case whitespace-nowrap">{stats.shiftCount} Shifts</span>

                    {hasUnsavedChanges && (
                        <div
                            role="status"
                            aria-live="polite"
                            className="inline-flex items-center gap-1.5 text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/30 ml-1"
                        >
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Unsaved
                        </div>
                    )}
                </div>

                {/* Right Side: Save | Delete | Publish */}
                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    {/* Save */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onSave}
                                    disabled={!canSave}
                                    aria-label="Save template changes"
                                    className={cn(
                                        "h-10 w-10 min-h-[44px] min-w-[44px] rounded-lg transition-all",
                                        canSave
                                            ? "text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/20"
                                            : "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                                    )}
                                >
                                    {isSaving ? (
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                        <Save className="h-5 w-5" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{canSave ? 'Save changes' : 'No unsaved changes'}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    {/* Delete */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onArchive}
                                    disabled={!canDelete}
                                    aria-label="Delete template"
                                    className={cn(
                                        "h-10 w-10 min-h-[44px] min-w-[44px] rounded-lg transition-all",
                                        canDelete
                                            ? "text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/20"
                                            : "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                                    )}
                                >
                                    <Trash2 className="h-5 w-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete template</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    {/* Publish / Unlock / Restore */}
                    {isDraft ? (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => onUpdateStatus('published')}
                                        disabled={!canPublish}
                                        aria-label="Publish template"
                                        aria-describedby={hasUnsavedChanges && !isSaving ? 'publish-block-reason' : undefined}
                                        className={cn(
                                            "h-10 w-10 min-h-[44px] min-w-[44px] rounded-lg transition-all",
                                            canPublish
                                                ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
                                                : "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                                        )}
                                    >
                                        {isSaving ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Upload className="h-5 w-5" />
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {canPublish
                                        ? 'Publish'
                                        : hasUnsavedChanges
                                            ? 'Save changes before publishing'
                                            : 'Publish'}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : isPublished ? (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => onUpdateStatus('draft')}
                                        disabled={isSaving}
                                        aria-label="Unlock template for editing"
                                        className="h-10 w-10 min-h-[44px] min-w-[44px] text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
                                    >
                                        <Lock className="h-5 w-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Unlock for editing</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => onUpdateStatus('draft')}
                                        disabled={isSaving}
                                        aria-label="Restore template to draft"
                                        className="h-10 w-10 min-h-[44px] min-w-[44px] text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-500/20 hover:bg-purple-50 rounded-lg transition-all"
                                    >
                                        <RotateCw className="h-5 w-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Restore to draft</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}

                    {/* Accessible hint for why Publish is disabled */}
                    {isDraft && hasUnsavedChanges && !isSaving && (
                        <p
                            id="publish-block-reason"
                            className="sr-only"
                        >
                            Save your changes before publishing
                        </p>
                    )}
                </div>
            </div>
        </header>
    );
};

export default TemplateHeader;
