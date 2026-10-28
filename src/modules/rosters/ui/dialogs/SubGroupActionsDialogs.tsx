import React, { useEffect, useState } from 'react';
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
import { Input } from '@/modules/core/ui/primitives/input';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, Edit3, Copy, Check, ArrowLeft } from 'lucide-react';
import { sameSubgroupName } from '@/modules/rosters/domain/subgroupRules';
import { ImpactConfirmDialog, ImpactSummaryView, canConfirmSummary } from './ImpactConfirmDialog';
import type { ChangeSummary } from './rosterChangeCopy';

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(50, "Name must be 50 characters or less"),
});

type FormValues = z.infer<typeof formSchema>;

// ── Name → review, used by Rename ─────────────────────────────────────────────
//
// Both change a sub-group on every day in view from today on, so neither goes
// straight from typing a name to writing. The first step takes the name; the
// second shows the database's dry run of exactly that change (days, shifts,
// name clashes, what is left alone) and only then offers the button.

interface NameThenReviewDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  inputLabel: string;
  placeholder: string;
  initialName: string;
  /** Refuse a name before asking the database (e.g. unchanged). */
  validateName?: (name: string) => string | null;
  preview: (name: string) => Promise<ChangeSummary>;
  commit: (name: string) => Promise<void>;
  busyLabel: string;
}

const NameThenReviewDialog: React.FC<NameThenReviewDialogProps> = ({
  isOpen,
  onOpenChange,
  icon,
  title,
  description,
  inputLabel,
  placeholder,
  initialName,
  validateName,
  preview,
  commit,
  busyLabel,
}) => {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: initialName },
  });
  const [review, setReview] = useState<{ name: string; summary: ChangeSummary } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [committing, setCommitting] = useState(false);
  const idPrefix = React.useId();

  useEffect(() => {
    if (isOpen) {
      form.reset({ name: initialName });
      setReview(null);
      setAcknowledged(false);
    }
  }, [isOpen, initialName, form]);

  const { isSubmitting } = form.formState;
  const nameValue = form.watch("name") || "";
  const inputId = `${idPrefix}-name`;

  const handleNext = async (values: FormValues) => {
    const name = values.name.trim();
    const refusal = validateName?.(name);
    if (refusal) {
      form.setError('name', { message: refusal });
      return;
    }
    try {
      setReview({ name, summary: await preview(name) });
      setAcknowledged(false);
    } catch (err) {
      form.setError('name', { message: err instanceof Error ? err.message : 'Could not check this change.' });
    }
  };

  const handleCommit = async () => {
    if (!review || !canConfirmSummary(review.summary, acknowledged)) return;
    setCommitting(true);
    try {
      await commit(review.name);
      onOpenChange(false);
    } catch {
      // The mutation reports the failure; stay on the review step.
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={next => { if (!committing) onOpenChange(next); }}>
      <DialogContent
        className="w-[calc(100vw-2rem)] p-0 overflow-hidden text-foreground ring-1 ring-border/50 max-h-[calc(100dvh-3rem)] flex flex-col"
        size="md"
      >
        <div className="relative p-6 sm:p-7 pb-5 border-b border-border bg-muted/30 dark:bg-muted/10">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
                {icon}
              </div>
              <div>
                <DialogTitle>
                  {review ? `Check before you ${title.toLowerCase()}` : title}
                </DialogTitle>
                <DialogDescription className="mt-0.5">
                  {description}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {review ? (
          <>
            <div className="p-6 sm:p-7 flex-1 overflow-y-auto" aria-live="polite">
              <ImpactSummaryView
                summary={review.summary}
                acknowledged={acknowledged}
                onAcknowledgedChange={setAcknowledged}
                idPrefix={idPrefix}
              />
            </div>
            <DialogFooter className="p-6 sm:p-7 pt-4 bg-muted/20 dark:bg-muted/5 border-t border-border flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setReview(null)}
                disabled={committing}
                className="w-full sm:w-auto h-11 px-5 rounded-xl border border-border text-foreground hover:bg-muted font-semibold text-[13px]"
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Back
              </Button>
              {!review.summary.blocked && (
                <Button
                  type="button"
                  onClick={handleCommit}
                  disabled={committing || !canConfirmSummary(review.summary, acknowledged)}
                  aria-busy={committing}
                  className="w-full sm:w-auto h-11 px-6 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-[13px] flex items-center justify-center gap-2"
                >
                  {committing
                    ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /><span>{busyLabel}</span></>
                    : <><Check className="h-4 w-4" aria-hidden="true" /><span>{review.summary.confirmLabel}</span></>}
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleNext)} className="flex flex-col flex-1 overflow-y-auto" noValidate>
              <div className="p-6 sm:p-7 space-y-5 flex-1">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel
                        htmlFor={inputId}
                        className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between"
                      >
                        <span>
                          {inputLabel} <span className="text-destructive" aria-hidden="true">*</span>
                        </span>
                        <span className="text-[11px] font-normal tracking-normal text-muted-foreground">
                          {nameValue.length}/50
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          id={inputId}
                          className="h-12 px-4 rounded-xl border border-input bg-background dark:bg-muted/20 text-foreground placeholder:text-muted-foreground/60 text-[14px] sm:text-[13px] shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary disabled:opacity-50"
                          placeholder={placeholder}
                          maxLength={50}
                          {...field}
                          disabled={isSubmitting}
                          autoFocus
                          aria-required="true"
                        />
                      </FormControl>
                      <FormMessage role="alert" className="text-[11px] font-medium text-destructive" />
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
                  className="w-full sm:w-auto h-11 px-5 rounded-xl border border-border text-foreground hover:bg-muted font-semibold text-[13px] transition-all active:scale-[0.98]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || !nameValue.trim()}
                  aria-busy={isSubmitting}
                  className="w-full sm:w-auto h-11 px-6 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-[13px] shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  {isSubmitting
                    ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /><span>Checking…</span></>
                    : <span>Review</span>}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ── Rename ────────────────────────────────────────────────────────────────────

interface RenameSubGroupDialogProps {
  currentName: string;
  /** Group and dates the change covers, e.g. "Theatre · Mon 3 Nov – Sun 9 Nov". */
  scopeLabel: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: (newName: string) => Promise<ChangeSummary>;
  onRename: (newName: string) => Promise<void>;
}

export const RenameSubGroupDialog: React.FC<RenameSubGroupDialogProps> = ({
  currentName,
  scopeLabel,
  isOpen,
  onOpenChange,
  onPreview,
  onRename,
}) => (
  <NameThenReviewDialog
    isOpen={isOpen}
    onOpenChange={onOpenChange}
    icon={<Edit3 className="h-5 w-5" aria-hidden="true" />}
    title="Rename Subgroup"
    description={<>“{currentName}” in {scopeLabel}. Days before today keep their name.</>}
    inputLabel="New Name"
    placeholder="e.g., Morning Shift"
    initialName={currentName}
    validateName={name => (name === currentName.trim() ? 'That is the current name.' : null)}
    preview={onPreview}
    commit={onRename}
    busyLabel="Renaming…"
  />
);

// ── Delete ────────────────────────────────────────────────────────────────────

interface DeleteSubGroupDialogProps {
  subGroupName: string;
  scopeLabel: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: () => Promise<ChangeSummary>;
  onConfirm: () => Promise<void>;
}

export const DeleteSubGroupDialog: React.FC<DeleteSubGroupDialogProps> = ({
  subGroupName,
  scopeLabel,
  isOpen,
  onOpenChange,
  onPreview,
  onConfirm,
}) => (
  <ImpactConfirmDialog
    open={isOpen}
    onOpenChange={onOpenChange}
    title={`Delete “${subGroupName}”?`}
    description={<>{scopeLabel}. This cannot be undone.</>}
    load={onPreview}
    onConfirm={onConfirm}
    acknowledgementLabel="I understand these shifts are deleted for good, including ones staff are assigned to."
  />
);
