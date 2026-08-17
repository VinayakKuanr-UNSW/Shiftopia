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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from '@/modules/core/hooks/use-toast';
import { Loader2, Building2, FolderPlus } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

export type DepartmentName = string;
export type DepartmentColor = string;

const DEPARTMENT_OPTIONS = [
  { value: "Convention Centre", label: "Convention Centre" },
  { value: "Exhibition Centre", label: "Exhibition Centre" },
  { value: "Theatre", label: "Theatre" },
  { value: "IT", label: "IT" },
];

const COLOR_OPTIONS = [
  { value: 'blue', label: 'Blue', colorClass: 'bg-blue-500' },
  { value: 'green', label: 'Green', colorClass: 'bg-emerald-500' },
  { value: 'red', label: 'Red', colorClass: 'bg-rose-500' },
  { value: 'purple', label: 'Purple', colorClass: 'bg-purple-500' },
  { value: 'sky', label: 'Sky Blue', colorClass: 'bg-sky-500' },
] as const;

const formSchema = z.object({
  name: z.string().min(1, "Department name is required"),
  color: z.string().min(1, "Color is required"),
});

type FormValues = z.infer<typeof formSchema>;

interface AddGroupDialogProps {
  onAddGroup: (group: { name: DepartmentName; color: DepartmentColor }) => Promise<void> | void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const AddGroupDialog: React.FC<AddGroupDialogProps> = ({
  onAddGroup,
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
      name: "Convention Centre",
      color: "blue",
    },
  });

  // Reset form on open
  React.useEffect(() => {
    if (open) {
      form.reset({
        name: "Convention Centre",
        color: "blue",
      });
    }
  }, [open, form]);

  const { isSubmitting } = form.formState;

  const handleSubmit = async (values: FormValues) => {
    try {
      await Promise.resolve(onAddGroup({
        name: values.name as DepartmentName,
        color: values.color as DepartmentColor,
      }));

      toast({
        title: "Department Added",
        description: `Department "${values.name}" has been added successfully.`,
      });

      setOpen?.(false);
      form.reset();
    } catch (error: any) {
      console.error('Failed to add department:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to add department",
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
      <DialogContent 
        className="w-[calc(100vw-2rem)] sm:max-w-[460px] p-0 overflow-hidden rounded-2xl sm:rounded-3xl border border-border bg-background text-foreground shadow-2xl backdrop-blur-xl ring-1 ring-border/50 max-h-[calc(100dvh-3rem)] flex flex-col"
        aria-describedby="add-group-description"
      >
        {/* Header */}
        <div className="relative p-6 sm:p-7 pb-5 border-b border-border bg-muted/30 dark:bg-muted/10">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
                <Building2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                  Add New Department
                </DialogTitle>
                <DialogDescription id="add-group-description" className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-relaxed">
                  Create a new department for the roster.
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
                      htmlFor="department-name-select"
                      className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                    >
                      Department Name <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger 
                          id="department-name-select"
                          className="h-12 px-4 rounded-xl border border-input bg-background dark:bg-muted/20 text-foreground shadow-sm transition-all focus:ring-2 focus:ring-primary"
                          aria-label="Select department name"
                        >
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl rounded-xl">
                        {DEPARTMENT_OPTIONS.map((dept) => (
                          <SelectItem key={dept.value} value={dept.value} className="cursor-pointer py-2.5">
                            {dept.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                      htmlFor="department-color-select"
                      className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                    >
                      Accent Color Theme <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger 
                          id="department-color-select"
                          className="h-12 px-4 rounded-xl border border-input bg-background dark:bg-muted/20 text-foreground shadow-sm transition-all focus:ring-2 focus:ring-primary"
                          aria-label="Select accent color theme"
                        >
                          <SelectValue placeholder="Select color" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl rounded-xl">
                        {COLOR_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="cursor-pointer py-2.5">
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
                disabled={isSubmitting}
                className="w-full sm:w-auto h-11 px-6 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-sm shadow-lg shadow-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                aria-label={isSubmitting ? "Adding department..." : "Add Department"}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Adding...</span>
                    <span className="sr-only">Adding department, please wait...</span>
                  </>
                ) : (
                  <>
                    <FolderPlus className="h-4 w-4" aria-hidden="true" />
                    <span>Add Department</span>
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

export default AddGroupDialog;
