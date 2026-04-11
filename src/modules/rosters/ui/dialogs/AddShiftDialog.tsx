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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Role, RemunerationLevel } from '@/modules/core/types';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
  role: z.string().min(1, "Role is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  breakDuration: z.string(),
  remunerationLevel: z.string(),
});

type FormValues = z.infer<typeof formSchema>;

interface AddShiftDialogProps {
  groupId: number | string;
  subGroupId: number | string;
  date: string;
  onAddShift: (
    groupId: number | string,
    subGroupId: number | string,
    shift: {
      role: Role;
      startTime: string;
      endTime: string;
      breakDuration: string;
      remunerationLevel: RemunerationLevel;
    }
  ) => Promise<void> | void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const AddShiftDialog: React.FC<AddShiftDialogProps> = ({
  groupId,
  subGroupId,
  date,
  onAddShift,
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
      role: "Team Leader",
      startTime: "09:00",
      endTime: "17:00",
      breakDuration: "30",
      remunerationLevel: "GOLD",
    },
  });

  const { isSubmitting } = form.formState;

  const handleSubmit = async (values: FormValues) => {
    try {
      const shift = {
        role: values.role as unknown as Role,
        startTime: `${date}T${values.startTime}:00`,
        endTime: `${date}T${values.endTime}:00`,
        breakDuration: `${values.breakDuration} min`,
        remunerationLevel: values.remunerationLevel as unknown as RemunerationLevel,
      };

      await Promise.resolve(onAddShift(groupId, subGroupId, shift));

      toast({
        title: "Shift Added",
        description: `New ${values.role} shift added successfully.`,
      });

      setOpen?.(false);
      form.reset();
    } catch (error: any) {
      console.error('Failed to add shift:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to add shift",
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
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[425px] bg-gray-900/95 backdrop-blur-xl border-gray-800">
        <DialogHeader>
          <DialogTitle>Add New Shift</DialogTitle>
          <DialogDescription>
            Create a new shift for the selected date and department.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-white/5 border-white/10">
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800">
                      <SelectItem value="Team Leader">Team Leader</SelectItem>
                      <SelectItem value="TM3">TM3</SelectItem>
                      <SelectItem value="TM2">TM2</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl>
                      <Input
                        type="time"
                        className="bg-white/5 border-white/10"
                        disabled={isSubmitting}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Time</FormLabel>
                    <FormControl>
                      <Input
                        type="time"
                        className="bg-white/5 border-white/10"
                        disabled={isSubmitting}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="breakDuration"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Break Duration (minutes)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="5"
                      className="bg-white/5 border-white/10"
                      disabled={isSubmitting}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="remunerationLevel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remuneration Level</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-white/5 border-white/10">
                        <SelectValue placeholder="Select level" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800">
                      <SelectItem value="GOLD">GOLD</SelectItem>
                      <SelectItem value="SILVER">SILVER</SelectItem>
                      <SelectItem value="BRONZE">BRONZE</SelectItem>
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
                Add Shift
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AddShiftDialog;
