// src/components/templates/TemplateHeader.tsx
// Template Editor Header - Minimal per spec

import React from 'react';
import { Lock, Unlock, ArrowLeft, AlertCircle } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';

/* ============================================================
   TYPES
   ============================================================ */
interface TemplateHeaderProps {
  templateName: string;
  templateVersion: number;
  status: 'draft' | 'published' | 'archived';
  description?: string | null;
  updatedAt: string;
  groupCount: number;
  subgroupCount: number;
  shiftCount: number;
  onBack?: () => void;
}

/* ============================================================
   COMPONENT
   ============================================================ */
export const TemplateHeader: React.FC<TemplateHeaderProps> = ({
  templateName,
  templateVersion,
  status,
  description,
  updatedAt,
  groupCount,
  subgroupCount,
  shiftCount,
  onBack,
}) => {
  const isPublished = status === 'published';

  return (
    <div className="border-b border-border bg-card">
      {/* Top Bar */}
      <div className="px-6 py-4 flex items-center justify-between">
        {/* Left: Back + Name + Lock + Version */}
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}

          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{templateName}</h1>

            {/* Lock/Unlock Icon with Tooltip */}
            <Tooltip>
              <TooltipTrigger>
                {isPublished ? (
                  <Lock className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Unlock className="h-4 w-4 text-amber-500" />
                )}
              </TooltipTrigger>
              <TooltipContent>
                {isPublished
                  ? 'Published - This template is locked and cannot be edited'
                  : 'Draft - This template can be edited'}
              </TooltipContent>
            </Tooltip>

            {/* Version Badge */}
            <Badge variant="outline" className="text-xs">
              v{templateVersion}
            </Badge>
          </div>
        </div>

        {/* Right: Status indicator */}
        <div className="flex items-center gap-2">
          {isPublished && (
            <div className="flex items-center gap-2 text-sm text-emerald-500 bg-emerald-500/10 px-3 py-1.5 rounded-md">
              <Lock className="h-3.5 w-3.5" />
              Published (Read-only)
            </div>
          )}
        </div>
      </div>

      {/* Metadata Section */}
      <div className="px-6 py-3 bg-muted/30 border-t border-border/50">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {/* Description */}
          {description && (
            <p className="text-foreground max-w-md line-clamp-1">
              {description}
            </p>
          )}

          {/* Last Updated */}
          <span>
            Last Updated: {format(new Date(updatedAt), 'dd MMM yyyy, HH:mm')}
          </span>

          {/* Stats */}
          <span>
            Groups: {groupCount} | Subgroups: {subgroupCount} | Shifts:{' '}
            {shiftCount}
          </span>
        </div>

        {/* Read-only warning for published */}
        {isPublished && (
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5" />
            This template is published and locked. To make changes, duplicate it
            first.
          </div>
        )}
      </div>
    </div>
  );
};

export default TemplateHeader;
