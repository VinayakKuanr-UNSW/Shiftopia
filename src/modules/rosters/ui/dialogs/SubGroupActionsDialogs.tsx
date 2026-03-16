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
import { Loader2, AlertTriangle } from 'lucide-react';

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
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
  subgroupId,
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

  const handleSubmit = async (values: FormValues) => {
    await onRename(values.name);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-background backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle>Rename Subgroup</DialogTitle>
          <DialogDescription>
            Enter a new name for the subgroup "{currentName}".
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Name</FormLabel>
                  <FormControl>
                    <Input
                      className="bg-background dark:bg-white/5 border-input dark:border-white/10"
                      placeholder="e.g., Morning Shift"
                      {...field}
                      disabled={isSubmitting}
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Rename Subgroup
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
  subgroupId,
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

  const handleSubmit = async (values: FormValues) => {
    await onClone(values.name);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-background backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle>Clone Subgroup</DialogTitle>
          <DialogDescription>
            Duplicate "{currentName}" and all its associated shifts.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Subgroup Name</FormLabel>
                  <FormControl>
                    <Input
                      className="bg-background dark:bg-white/5 border-input dark:border-white/10"
                      placeholder="e.g., Morning Shift Copy"
                      {...field}
                      disabled={isSubmitting}
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Clone Subgroup
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
      <AlertDialogContent className="bg-background backdrop-blur-xl border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-5 w-5" />
            Delete Subgroup?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            This will permanently delete the subgroup "{subGroupName}" and <strong className="text-red-400">all shifts</strong> associated with it. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting} className="bg-transparent border-border dark:border-white/10 text-foreground hover:bg-muted dark:hover:bg-white/5">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="bg-red-600 hover:bg-red-700 text-white border-none"
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete Everything
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
