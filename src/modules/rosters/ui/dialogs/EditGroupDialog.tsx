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
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
    name: z.string().min(1, "Group name is required"),
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
            color: groupColor as DepartmentColor,
        },
    });

    // Reset form when props change or dialog opens
    React.useEffect(() => {
        if (open) {
            form.reset({
                name: groupName,
                color: groupColor as DepartmentColor,
            });
        }
    }, [open, groupName, groupColor, form]);

    const { isSubmitting } = form.formState;

    const handleSubmit = async (values: FormValues) => {
        try {
            await Promise.resolve(onEditGroup(values.name, values.color as DepartmentColor));

            toast({
                title: "Group Updated",
                description: `Group details updated successfully.`,
            });

            onOpenChange(false);
        } catch (error: any) {
            console.error('Failed to update group:', error);
            toast({
                title: "Error",
                description: error.message || "Failed to update group",
                variant: "destructive",
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] bg-gray-900/95 backdrop-blur-xl border-gray-800">
                <DialogHeader>
                    <DialogTitle>Edit Group</DialogTitle>
                    <DialogDescription>
                        Update the name and color of the roster group.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Group Name</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="e.g. Convention Centre"
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
                            name="color"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Group Color</FormLabel>
                                    <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value}
                                        disabled={isSubmitting}
                                    >
                                        <FormControl>
                                            <SelectTrigger className="bg-white/5 border-white/10">
                                                <SelectValue placeholder="Select a color" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800">
                                            <SelectItem value="blue">Blue</SelectItem>
                                            <SelectItem value="green">Green</SelectItem>
                                            <SelectItem value="red">Red</SelectItem>
                                            <SelectItem value="purple">Purple</SelectItem>
                                            <SelectItem value="sky">Sky Blue</SelectItem>
                                        </SelectContent>
                                    </Select>
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
                                Save Changes
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};
