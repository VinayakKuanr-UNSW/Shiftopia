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
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
  name: z.string().min(1, "Subgroup name is required"),
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

  const { isSubmitting } = form.formState;

  const handleSubmit = async (values: FormValues) => {
    try {
      await Promise.resolve(onAddSubGroup(groupId, values.name));

      toast({
        title: "Subgroup Added",
        description: `Subgroup "${values.name}" has been added to ${groupName}.`,
      });

      setOpen?.(false);
      form.reset();
    } catch (error: any) {
      console.error('Failed to add subgroup:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to add subgroup",
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
          <DialogTitle>Add New Subgroup</DialogTitle>
          <DialogDescription>
            Create a new subgroup in the {groupName} department.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subgroup Name</FormLabel>
                  <FormControl>
                    <Input
                      className="bg-white/5 border-white/10"
                      placeholder="e.g., Morning Shift, Evening Team"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
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
                Add Subgroup
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AddSubGroupDialog;
