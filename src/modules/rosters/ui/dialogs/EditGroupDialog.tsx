import React from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from '@/modules/core/hooks/use-toast';
import { Loader2, Palette, Check } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

const COLOR_OPTIONS = [
  { value: 'blue', label: 'Blue', colorClass: 'bg-blue-500' },
  { value: 'green', label: 'Green', colorClass: 'bg-emerald-500' },
  { value: 'red', label: 'Red', colorClass: 'bg-rose-500' },
  { value: 'purple', label: 'Purple', colorClass: 'bg-purple-500' },
  { value: 'sky', label: 'Sky Blue', colorClass: 'bg-sky-500' },
] as const;

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Group name is required")
    .max(50, "Group name must be 50 characters or less"),
  color: z.enum(['blue', 'green', 'red', 'purple', 'sky']),
});

type FormValues = z.infer<typeof formSchema>;

export type DepartmentColor = 'blue' | 'green' | 'red' | 'purple' | 'sky';

interface EditGroupDialogProps {
  groupName: string;
  groupColor: string;
  onEditGroup: (name: string, color: DepartmentColor) => Promise<void> | void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const EditGroupDialog: React.FC<EditGroupDialogProps> = ({
  groupName,
  groupColor,
  onEditGroup,
  open,
  onOpenChange,
}) => {
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: groupName,
      color: (groupColor as DepartmentColor) || 'blue',
    },
  });

  // Reset form when props change or dialog opens
  React.useEffect(() => {
    if (open) {
      form.reset({
        name: groupName,
        color: (['blue', 'green', 'red', 'purple', 'sky'].includes(groupColor) 
          ? groupColor 
          : 'blue') as DepartmentColor,
      });
    }
  }, [open, groupName, groupColor, form]);

  const { isSubmitting } = form.formState;
  const nameValue = form.watch("name") || "";

  const handleSubmit = async (values: FormValues) => {
    try {
      await Promise.resolve(onEditGroup(values.name.trim(), values.color as DepartmentColor));

      toast({
        title: "Group Updated",
        description: `Group "${values.name.trim()}" details updated successfully.`,
      });

      onOpenChange(false);
    } catch (error: any) {
      console.error('Failed to update group:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to update group",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="w-[calc(100vw-2rem)] sm:max-w-[460px] p-0 overflow-hidden rounded-2xl sm:rounded-3xl border border-border bg-background text-foreground shadow-2xl backdrop-blur-xl ring-1 ring-border/50 max-h-[calc(100dvh-3rem)] flex flex-col"
        aria-describedby="edit-group-description"
      >
        {/* Header */}
        <div className="relative p-6 sm:p-7 pb-5 border-b border-border bg-muted/30 dark:bg-muted/10">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
                <Palette className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                  Edit Department Group
                </DialogTitle>
                <DialogDescription id="edit-group-description" className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-relaxed">
                  Update the name and visual theme of this roster group.
                </DialogDescription>
              </div>
            </div>
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
                      htmlFor="edit-group-name-input"
                      className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between"
                    >
                      <span>
                        Group Name <span className="text-destructive" aria-hidden="true">*</span>
                      </span>
                      <span className="text-[11px] font-normal tracking-normal text-muted-foreground">
                        {nameValue.length}/50
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="edit-group-name-input"
                        className="h-12 px-4 rounded-xl border border-input bg-background dark:bg-muted/20 text-foreground placeholder:text-muted-foreground/60 text-base sm:text-sm shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary disabled:opacity-50"
                        placeholder="e.g., Convention Centre"
                        maxLength={50}
                        autoFocus
                        disabled={isSubmitting}
                        aria-required="true"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage role="alert" className="text-xs font-medium text-destructive" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel 
                      htmlFor="group-color-select"
                      className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                    >
                      Accent Color Theme
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger 
                          id="group-color-select"
                          className="h-12 px-4 rounded-xl border border-input bg-background dark:bg-muted/20 text-foreground shadow-sm transition-all focus:ring-2 focus:ring-primary"
                          aria-label="Select accent color theme"
                        >
                          <SelectValue placeholder="Select a color" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl rounded-xl">
                        {COLOR_OPTIONS.map((opt) => (
                          <SelectItem 
                            key={opt.value} 
                            value={opt.value}
                            className="cursor-pointer py-2.5"
                          >
                            <div className="flex items-center gap-2.5">
                              <span 
                                className={cn("h-3.5 w-3.5 rounded-full ring-1 ring-border shrink-0", opt.colorClass)} 
                                aria-hidden="true" 
                              />
                              <span className="font-medium text-sm">{opt.label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                aria-label={isSubmitting ? "Saving changes..." : "Save Changes"}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Saving...</span>
                    <span className="sr-only">Saving changes, please wait...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" aria-hidden="true" />
                    <span>Save Changes</span>
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

export default EditGroupDialog;
