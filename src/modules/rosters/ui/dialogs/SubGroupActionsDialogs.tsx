import React, { useEffect } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/modules/core/ui/primitives/form';
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
import { Input } from '@/modules/core/ui/primitives/input';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, AlertTriangle, Edit3, Copy, Trash2, Check } from 'lucide-react';

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(50, "Name must be 50 characters or less"),
});

type FormValues = z.infer<typeof formSchema>;

// ── Rename Dialog ────────────────────────────────────────────────────────────

interface RenameSubGroupDialogProps {
  subgroupId: string;
  currentName: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (newName: string) => Promise<void>;
}

export const RenameSubGroupDialog: React.FC<RenameSubGroupDialogProps> = ({
  subgroupId: _subgroupId,
  currentName,
  isOpen,
  onOpenChange,
  onRename,
}) => {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: currentName },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({ name: currentName });
    }
  }, [isOpen, currentName, form]);

  const { isSubmitting } = form.formState;
  const nameValue = form.watch("name") || "";

  const handleSubmit = async (values: FormValues) => {
    await onRename(values.name.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent 
        className="w-[calc(100vw-2rem)] sm:max-w-[460px] p-0 overflow-hidden rounded-2xl sm:rounded-3xl border border-border bg-background text-foreground shadow-2xl backdrop-blur-xl ring-1 ring-border/50 max-h-[calc(100dvh-3rem)] flex flex-col"
        aria-describedby="rename-subgroup-description"
      >
        {/* Header */}
        <div className="relative p-6 sm:p-7 pb-5 border-b border-border bg-muted/30 dark:bg-muted/10">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
                <Edit3 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                  Rename Subgroup
                </DialogTitle>
                <DialogDescription id="rename-subgroup-description" className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-relaxed">
                  Enter a new name for the subgroup "{currentName}".
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <Form {...form}>
          <form 
            onSubmit={form.handleSubmit(handleSubmit)} 
            className="flex flex-col flex-1 overflow-y-auto"
            noValidate
          >
            <div className="p-6 sm:p-7 space-y-5 flex-1">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel 
                      htmlFor="rename-subgroup-input"
                      className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between"
                    >
                      <span>
                        New Name <span className="text-destructive" aria-hidden="true">*</span>
                      </span>
                      <span className="text-[11px] font-normal tracking-normal text-muted-foreground">
                        {nameValue.length}/50
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="rename-subgroup-input"
                        className="h-12 px-4 rounded-xl border border-input bg-background dark:bg-muted/20 text-foreground placeholder:text-muted-foreground/60 text-base sm:text-sm shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary disabled:opacity-50"
                        placeholder="e.g., Morning Shift"
                        maxLength={50}
                        {...field}
                        disabled={isSubmitting}
                        autoFocus
                        aria-required="true"
                      />
                    </FormControl>
                    <FormMessage role="alert" className="text-xs font-medium text-destructive" />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="p-6 sm:p-7 pt-4 bg-muted/20 dark:bg-muted/5 border-t border-border flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)} 
                disabled={isSubmitting}
                className="w-full sm:w-auto h-11 px-5 rounded-xl border border-border text-foreground hover:bg-muted font-semibold text-sm transition-all active:scale-[0.98]"
                aria-label="Cancel and close dialog"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSubmitting || !nameValue.trim()}
                className="w-full sm:w-auto h-11 px-6 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-sm shadow-lg shadow-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                aria-label={isSubmitting ? "Renaming subgroup..." : "Rename Subgroup"}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Renaming...</span>
                    <span className="sr-only">Renaming subgroup, please wait...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" aria-hidden="true" />
                    <span>Rename Subgroup</span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// ── Clone Dialog ─────────────────────────────────────────────────────────────

interface CloneSubGroupDialogProps {
  subgroupId: string;
  currentName: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onClone: (newName: string) => Promise<void>;
}

export const CloneSubGroupDialog: React.FC<CloneSubGroupDialogProps> = ({
  subgroupId: _subgroupId,
  currentName,
  isOpen,
  onOpenChange,
  onClone,
}) => {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: `${currentName} (Copy)` },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({ name: `${currentName} (Copy)` });
    }
  }, [isOpen, currentName, form]);

  const { isSubmitting } = form.formState;
  const nameValue = form.watch("name") || "";

  const handleSubmit = async (values: FormValues) => {
    await onClone(values.name.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent 
        className="w-[calc(100vw-2rem)] sm:max-w-[460px] p-0 overflow-hidden rounded-2xl sm:rounded-3xl border border-border bg-background text-foreground shadow-2xl backdrop-blur-xl ring-1 ring-border/50 max-h-[calc(100dvh-3rem)] flex flex-col"
        aria-describedby="clone-subgroup-description"
      >
        {/* Header */}
        <div className="relative p-6 sm:p-7 pb-5 border-b border-border bg-muted/30 dark:bg-muted/10">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
                <Copy className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                  Clone Subgroup
                </DialogTitle>
                <DialogDescription id="clone-subgroup-description" className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-relaxed">
                  Duplicate "{currentName}" and all its associated shifts.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <Form {...form}>
          <form 
            onSubmit={form.handleSubmit(handleSubmit)} 
            className="flex flex-col flex-1 overflow-y-auto"
            noValidate
          >
            <div className="p-6 sm:p-7 space-y-5 flex-1">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel 
                      htmlFor="clone-subgroup-input"
                      className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between"
                    >
                      <span>
                        New Subgroup Name <span className="text-destructive" aria-hidden="true">*</span>
                      </span>
                      <span className="text-[11px] font-normal tracking-normal text-muted-foreground">
                        {nameValue.length}/50
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="clone-subgroup-input"
                        className="h-12 px-4 rounded-xl border border-input bg-background dark:bg-muted/20 text-foreground placeholder:text-muted-foreground/60 text-base sm:text-sm shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary disabled:opacity-50"
                        placeholder="e.g., Morning Shift Copy"
                        maxLength={50}
                        {...field}
                        disabled={isSubmitting}
                        autoFocus
                        aria-required="true"
                      />
                    </FormControl>
                    <FormMessage role="alert" className="text-xs font-medium text-destructive" />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="p-6 sm:p-7 pt-4 bg-muted/20 dark:bg-muted/5 border-t border-border flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)} 
                disabled={isSubmitting}
                className="w-full sm:w-auto h-11 px-5 rounded-xl border border-border text-foreground hover:bg-muted font-semibold text-sm transition-all active:scale-[0.98]"
                aria-label="Cancel and close dialog"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSubmitting || !nameValue.trim()}
                className="w-full sm:w-auto h-11 px-6 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-sm shadow-lg shadow-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                aria-label={isSubmitting ? "Cloning subgroup..." : "Clone Subgroup"}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Cloning...</span>
                    <span className="sr-only">Cloning subgroup, please wait...</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    <span>Clone Subgroup</span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// ── Delete Confirmation Dialog ────────────────────────────────────────────────

interface DeleteSubGroupDialogProps {
  subgroupId: string;
  subGroupName: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  isDeleting?: boolean;
}

export const DeleteSubGroupDialog: React.FC<DeleteSubGroupDialogProps> = ({
  subGroupName,
  isOpen,
  onOpenChange,
  onConfirm,
  isDeleting = false,
}) => {
  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent 
        className="w-[calc(100vw-2rem)] sm:max-w-[460px] p-0 overflow-hidden rounded-2xl sm:rounded-3xl border border-border bg-background text-foreground shadow-2xl backdrop-blur-xl ring-1 ring-border/50 max-h-[calc(100dvh-3rem)] flex flex-col"
        aria-describedby="delete-subgroup-description"
      >
        <div className="relative p-6 sm:p-7 pb-5 border-b border-border bg-destructive/5">
          <AlertDialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20 shadow-inner">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <AlertDialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-destructive flex items-center gap-2">
                  Delete Subgroup?
                </AlertDialogTitle>
                <AlertDialogDescription id="delete-subgroup-description" className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-relaxed">
                  This will permanently delete the subgroup "{subGroupName}" and <strong className="text-foreground font-semibold">all shifts</strong> associated with it.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
        </div>

        <div className="p-6 sm:p-7 bg-muted/10 text-xs text-muted-foreground">
          <p className="leading-relaxed">
            This action cannot be undone. Shifts currently scheduled within this subgroup will be permanently removed.
          </p>
        </div>

        <AlertDialogFooter className="p-6 sm:p-7 pt-4 bg-muted/20 dark:bg-muted/5 border-t border-border flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
          <AlertDialogCancel 
            disabled={isDeleting} 
            className="w-full sm:w-auto h-11 px-5 rounded-xl border border-border text-foreground hover:bg-muted font-semibold text-sm transition-all active:scale-[0.98]"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="w-full sm:w-auto h-11 px-6 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold text-sm shadow-lg shadow-destructive/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            disabled={isDeleting}
            aria-busy={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Deleting...</span>
                <span className="sr-only">Deleting subgroup, please wait...</span>
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>Delete Subgroup</span>
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

