import React from 'react';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
} from '@/modules/core/ui/primitives/form';
import { MultiSelect } from './MultiSelect';
import { RequirementsStepProps } from '../types';

export const RequirementsStep: React.FC<RequirementsStepProps> = ({
    form,
    isReadOnly,
    isLoadingData,
    skills,
    licenses,
    events,
}) => {
    return (
        <div className="space-y-6">
            <FormField
                control={form.control}
                name="required_skills"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel className="text-white/70">Required Skills</FormLabel>
                        <FormControl>
                            <MultiSelect
                                options={skills.map((s) => ({ id: s.id, name: s.name }))}
                                selected={field.value || []}
                                onChange={field.onChange}
                                placeholder="Select skills..."
                                isLoading={isLoadingData}
                                disabled={isReadOnly}
                            />
                        </FormControl>
                    </FormItem>
                )}
            />

            <FormField
                control={form.control}
                name="required_licenses"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel className="text-white/70">Required Licenses</FormLabel>
                        <FormControl>
                            <MultiSelect
                                options={licenses.map((l) => ({ id: l.id, name: l.name }))}
                                selected={field.value || []}
                                onChange={field.onChange}
                                placeholder="Select licenses..."
                                isLoading={isLoadingData}
                                disabled={isReadOnly}
                            />
                        </FormControl>
                    </FormItem>
                )}
            />

            <FormField
                control={form.control}
                name="event_ids"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel className="text-white/70">Related Events</FormLabel>
                        <FormControl>
                            <MultiSelect
                                options={events.map((e) => ({ id: e.id, name: e.name }))}
                                selected={field.value || []}
                                onChange={field.onChange}
                                placeholder="Link events..."
                                isLoading={isLoadingData}
                                disabled={isReadOnly}
                            />
                        </FormControl>
                    </FormItem>
                )}
            />
        </div>
    );
};
