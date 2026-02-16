// src/components/templates/PublishTemplateDialog.tsx
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Alert, AlertDescription } from '@/modules/core/ui/primitives/alert';
import {
  Calendar as CalendarIcon,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { format, parse } from 'date-fns';

interface PublishTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPublish: () => Promise<boolean>;
  templateName: string;
  templateVersion: number;
  publishedMonth?: string; // YYYY-MM
  isPublishing?: boolean;
}

export const PublishTemplateDialog: React.FC<PublishTemplateDialogProps> = ({
  isOpen,
  onClose,
  onPublish,
  templateName,
  templateVersion,
  publishedMonth,
  isPublishing = false,
}) => {
  const displayMonth = React.useMemo(() => {
    if (!publishedMonth) return 'Unknown Month';
    try {
      const date = parse(publishedMonth + '-01', 'yyyy-MM-dd', new Date());
      return format(date, 'MMMM yyyy');
    } catch {
      return publishedMonth;
    }
  }, [publishedMonth]);

  const handleApply = async () => {
    const success = await onPublish();
    if (success) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#0d1829] border-white/10 sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400">
              <CalendarIcon className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl text-white">
                Apply Template to Roster
              </DialogTitle>
              <DialogDescription className="text-white/50 text-sm">
                Apply current template to the generated roster.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4 space-y-6">
          {/* Template Info */}
          <div className="bg-[#1a2744] rounded-xl p-4 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-sm">Target Month</span>
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 font-semibold px-3 py-1">
                {displayMonth}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/40">Template Name</span>
              <span className="text-white font-medium">{templateName}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/40">Version</span>
              <span className="text-white font-medium">v{templateVersion}</span>
            </div>
          </div>

          {/* Logic Explanation */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-1 w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              </div>
              <p className="text-sm text-white/70">
                <span className="text-emerald-400 font-medium">Append New:</span> Only new shifts and sub-groups defined in this template will be added.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-1 w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                <Info className="h-3 w-3 text-amber-400" />
              </div>
              <p className="text-sm text-white/70">
                <span className="text-amber-400 font-medium">Preserve Manual:</span> Shifts created manually in the roster will not be overwritten.
              </p>
            </div>
          </div>

          <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-300">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Applying a template will set its status to "Published" and it will be locked for further editing until modified.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter className="gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPublishing}
            className="bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={isPublishing}
            className="bg-blue-600 hover:bg-blue-700 text-white min-w-[140px]"
          >
            {isPublishing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <CalendarIcon className="h-4 w-4 mr-2" />
                Apply to Roster
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PublishTemplateDialog;
