import React from 'react';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
} from '@/modules/core/ui/primitives/form';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { StepProps } from '../types';

export const NotesStep: React.FC<StepProps> = ({ form }) => {
    return (
        <div className="space-y-6">
            <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel className="text-white/70">Notes</FormLabel>
                        <FormControl>
                            <Textarea
                                placeholder="Add notes for this shift..."
                                rows={8}
                                className="bg-[#1e293b] border-white/10 text-white resize-none"
                                {...field}
                            />
                        </FormControl>
                    </FormItem>
                )}
            />
        </div>
    );
};
