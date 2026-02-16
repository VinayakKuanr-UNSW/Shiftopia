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
import { Loader2 } from 'lucide-react';

export type DepartmentName = string;
export type DepartmentColor = string;

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
        description: error.message || "Failed to add department",
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
      <DialogContent className="sm:max-w-[425px] bg-gray-900/95 backdrop-blur-xl border-gray-800">
        <DialogHeader>
          <DialogTitle>Add New Department</DialogTitle>
          <DialogDescription>
            Create a new department for the roster.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Department Name</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-white/5 border-white/10">
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800">
                      <SelectItem value="Convention Centre">Convention Centre</SelectItem>
                      <SelectItem value="Exhibition Centre">Exhibition Centre</SelectItem>
                      <SelectItem value="Theatre">Theatre</SelectItem>
                      <SelectItem value="IT">IT</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Department Color</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-white/5 border-white/10">
                        <SelectValue placeholder="Select color" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800">
                      <SelectItem value="blue">Blue</SelectItem>
                      <SelectItem value="green">Green</SelectItem>
                      <SelectItem value="red">Red</SelectItem>
                      <SelectItem value="purple">Purple</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen?.(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Department
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AddGroupDialog;
