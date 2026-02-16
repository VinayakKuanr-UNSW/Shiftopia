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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from '@/modules/core/hooks/use-toast';
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
    name: z.string().min(1, "Subgroup name is required"),
});

type FormValues = z.infer<typeof formSchema>;

interface EditSubGroupDialogProps {
    subGroupName: string;
    onEditSubGroup: (newName: string) => Promise<void> | void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const EditSubGroupDialog: React.FC<EditSubGroupDialogProps> = ({
    subGroupName,
    onEditSubGroup,
    open,
    onOpenChange,
}) => {
    const { toast } = useToast();

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: subGroupName,
        },
    });

    // Reset form when subGroupName changes or dialog opens
    React.useEffect(() => {
        if (open) {
            form.reset({ name: subGroupName });
        }
    }, [open, subGroupName, form]);

    const { isSubmitting } = form.formState;

    const handleSubmit = async (values: FormValues) => {
        try {
            await Promise.resolve(onEditSubGroup(values.name));

            toast({
                title: "Subgroup Updated",
                description: `Subgroup updated successfully.`,
            });

            onOpenChange(false);
        } catch (error: any) {
            console.error('Failed to update subgroup:', error);
            toast({
                title: "Error",
                description: error.message || "Failed to update subgroup",
                variant: "destructive",
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] bg-gray-900/95 backdrop-blur-xl border-gray-800">
                <DialogHeader>
                    <DialogTitle>Edit Subgroup</DialogTitle>
                    <DialogDescription>
                        Update the name of the subgroup.
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
                                            placeholder="e.g. Morning Shift"
                                            className="bg-white/5 border-white/10"
                                            disabled={isSubmitting}
                                            {...field}
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
                                Save Changes
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};
