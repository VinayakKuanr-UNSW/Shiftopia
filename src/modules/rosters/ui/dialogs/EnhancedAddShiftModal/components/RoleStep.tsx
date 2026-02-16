import React from 'react';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/modules/core/ui/primitives/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { Lock, Gavel, AlertTriangle } from 'lucide-react';
import { RoleStepProps } from '../types';

export const RoleStep: React.FC<RoleStepProps> = ({
    form,
    isReadOnly,
    isLoadingData,
    isTemplateMode,
    roles,
    remunerationLevels,
    employees,
    existingShift,
    netLength,
    selectedRemLevel,
    safeContext,
    isRoleLocked
}) => {
    const watchRoleId = form.watch('role_id');
    const estimatedCost = netLength * (selectedRemLevel?.hourly_rate_min || 0);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <FormField
                    control={form.control}
                    name="role_id"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white/70">Role *</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''} disabled={isReadOnly || isRoleLocked}>
                                <FormControl>
                                    <SelectTrigger className="bg-[#1e293b] border-white/10 text-white h-11">
                                        <SelectValue placeholder={isLoadingData ? 'Loading...' : 'Select role'} />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-[#1e293b] border-white/10">
                                    {roles.map((role) => (
                                        <SelectItem key={role.id} value={role.id} className="text-white">
                                            {role.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="remuneration_level_id"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white/70 flex items-center gap-2">
                                Pay Level
                                <Lock className="h-3 w-3 text-amber-400" />
                                <span className="text-xs text-white/40 font-normal">(from role)</span>
                            </FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''} disabled>
                                <FormControl>
                                    <SelectTrigger className="bg-[#1e293b] border-white/10 text-white h-11 opacity-70 cursor-not-allowed">
                                        <SelectValue placeholder={watchRoleId ? 'Loading...' : 'Select a role first'} />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-[#1e293b] border-white/10">
                                    {remunerationLevels.map((level) => (
                                        <SelectItem key={level.id} value={level.id} className="text-white">
                                            {level.level_name} - ${level.hourly_rate_min}/hr
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )}
                />
            </div>

            <Separator className="bg-white/10" />

            {/* Bidding Warning */}
            {existingShift?.is_on_bidding && (
                <div className="p-3 mb-4 rounded-lg bg-indigo-500/10 border border-indigo-500/30">
                    <div className="flex items-start gap-3">
                        <Gavel className="h-5 w-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-indigo-300">Shift is on Bidding</p>
                            <p className="text-xs text-white/60 mt-1">
                                This shift is currently accepting bids. Assigning an employee here will close bidding and assign the shift directly.
                                <br />
                                <span className="opacity-70 mt-1 block">
                                    You can also selecting a winner from the Open Bids page.
                                </span>
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {isTemplateMode ? (
                <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-amber-300">Employee Assignment Disabled</p>
                            <p className="text-xs text-white/50 mt-1">
                                Templates define shift structures only. Assign employees when applying
                                the template to a roster.
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <FormField
                    control={form.control}
                    name="assigned_employee_id"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-white/70">Assigned Employee</FormLabel>
                            <Select
                                onValueChange={(v) => field.onChange(v === '__none__' ? null : v)}
                                value={field.value || '__none__'}
                                disabled={isReadOnly || !!safeContext?.employeeId}
                            >
                                <FormControl>
                                    <SelectTrigger className="bg-[#1e293b] border-white/10 text-white h-11">
                                        <SelectValue placeholder="Unassigned" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent className="bg-[#1e293b] border-white/10">
                                    <SelectItem value="__none__" className="text-white/50">Unassigned</SelectItem>
                                    {employees.map((emp) => (
                                        <SelectItem key={emp.id} value={emp.id} className="text-white">
                                            {emp.first_name} {emp.last_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )}
                />
            )}

            {selectedRemLevel && netLength > 0 && (
                <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <div className="flex justify-between items-center">
                        <span className="text-blue-300/70">Estimated Cost</span>
                        <span className="text-2xl font-bold text-blue-300">${estimatedCost.toFixed(2)}</span>
                    </div>
                </div>
            )}
        </div>
    );
};
