import React from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useToast } from '@/modules/core/hooks/use-toast';
import { Loader2, FolderPlus, Building2 } from 'lucide-react';

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Subgroup name is required")
    .max(50, "Subgroup name must be 50 characters or less"),
});

type FormValues = z.infer<typeof formSchema>;

interface AddSubGroupDialogProps {
  groupId: number | string;
  groupName: string;
  onAddSubGroup: (groupId: number | string, subGroupName: string) => Promise<void> | void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const AddSubGroupDialog: React.FC<AddSubGroupDialogProps> = ({
  groupId,
  groupName,
  onAddSubGroup,
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? setControlledOpen : setInternalOpen;

  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
    },
  });

  // Reset form whenever the dialog opens
  React.useEffect(() => {
    if (open) {
      form.reset({ name: "" });
    }
  }, [open, form]);

  const { isSubmitting } = form.formState;
  const nameValue = form.watch("name") || "";

  const handleSubmit = async (values: FormValues) => {
    try {
      await Promise.resolve(onAddSubGroup(groupId, values.name.trim()));

      toast({
        title: "Subgroup Added",
        description: `Subgroup "${values.name.trim()}" has been added to ${groupName}.`,
      });

      setOpen?.(false);
      form.reset();
    } catch (error: any) {
      console.error('Failed to add subgroup:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to add subgroup",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && (
        <DialogTrigger asChild>
          {trigger}
        </DialogTrigger>
      )}
      {/* No manual aria-describedby / id pair: Radix mints its own id, points
          aria-describedby at it AND stamps it onto <DialogDescription>. Overriding
          both left Radix's id resolving to nothing, which is precisely the
          "Missing `Description` or `aria-describedby={undefined}`" console warning
          this dialog was logging on every open. */}
      <DialogContent
        className="w-[calc(100vw-2rem)] sm:max-w-[460px] p-0 overflow-hidden rounded-2xl sm:rounded-3xl border border-border bg-background text-foreground shadow-2xl backdrop-blur-xl ring-1 ring-border/50 max-h-[calc(100dvh-3rem)] flex flex-col"
      >
        {/* Header */}
        <div className="relative p-6 sm:p-7 pb-5 border-b border-border bg-muted/30 dark:bg-muted/10">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
                <FolderPlus className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                  Add New Subgroup
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-relaxed">
                  Create a new subgroup for organizing shifts.
                </DialogDescription>
              </div>
            </div>

            {/* Department Context Badge */}
            {groupName && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/60 dark:bg-muted/40 border border-border text-xs font-medium text-foreground w-fit max-w-full">
                <Building2 className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
                <span className="text-muted-foreground text-[11px] uppercase tracking-wider font-bold shrink-0">Department:</span>
                <span className="font-semibold text-foreground truncate">{groupName}</span>
              </div>
            )}
          </DialogHeader>
        </div>

        {/* Body & Form */}
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
                      htmlFor="subgroup-name-input"
                      className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between"
                    >
                      <span>
                        Subgroup Name <span className="text-destructive" aria-hidden="true">*</span>
                      </span>
                      <span className="text-[11px] font-normal tracking-normal text-muted-foreground">
                        {nameValue.length}/50
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="subgroup-name-input"
                        className="h-12 px-4 rounded-xl border border-input bg-background dark:bg-muted/20 text-foreground placeholder:text-muted-foreground/60 text-base sm:text-sm shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary disabled:opacity-50"
                        placeholder="e.g., Morning Shift, Logistics Team"
                        maxLength={50}
                        autoFocus
                        disabled={isSubmitting}
                        aria-required="true"
                        aria-describedby="subgroup-name-hint"
                        {...field}
                      />
                    </FormControl>
                    <p id="subgroup-name-hint" className="text-xs text-muted-foreground leading-normal">
                      Subgroups help segment rosters into distinct teams or shift categories.
                    </p>
                    <FormMessage role="alert" className="text-xs font-medium text-destructive" />
                  </FormItem>
                )}
              />
            </div>

            {/* Footer */}
            <DialogFooter className="p-6 sm:p-7 pt-4 bg-muted/20 dark:bg-muted/5 border-t border-border flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setOpen?.(false)} 
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
                aria-label={isSubmitting ? "Adding subgroup..." : "Add Subgroup"}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Adding...</span>
                    <span className="sr-only">Adding subgroup, please wait...</span>
                  </>
                ) : (
                  <>
                    <FolderPlus className="h-4 w-4" aria-hidden="true" />
                    <span>Add Subgroup</span>
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

export default AddSubGroupDialog;
