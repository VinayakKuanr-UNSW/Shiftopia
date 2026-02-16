import React from 'react';
import { Lock, ChevronRight, Globe } from 'lucide-react';
import { ShiftContext } from '../types';
import { TIMEZONES } from '../constants';

interface ContextBarProps {
    safeContext: ShiftContext;
    timezone: string;
}

export const ContextBar: React.FC<ContextBarProps> = ({ safeContext, timezone }) => {
    const customTzLabel = TIMEZONES.find(t => t.value === timezone)?.label.split('(')[1]?.replace(')', '') || 'AEST/AEDT';

    return (
        <div className="px-6 py-3 border-b border-white/10 bg-[#1e293b]/50">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Lock className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-xs font-medium text-amber-400 uppercase tracking-wide">Inherited Context</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-white/70">
                    {safeContext.organizationName && (
                        <>
                            <span className="text-white font-medium">{safeContext.organizationName}</span>
                            <ChevronRight className="h-3 w-3 text-white/30" />
                        </>
                    )}
                    {safeContext.departmentName && (
                        <>
                            <span className="text-white font-medium">{safeContext.departmentName}</span>
                            <ChevronRight className="h-3 w-3 text-white/30" />
                        </>
                    )}
                    {safeContext.subDepartmentName && (
                        <>
                            <span className="text-white font-medium">{safeContext.subDepartmentName}</span>
                            <ChevronRight className="h-3 w-3 text-white/30" />
                        </>
                    )}
                    {safeContext.groupName && (
                        <>
                            <span className="text-emerald-400 font-medium">{safeContext.groupName}</span>
                            <ChevronRight className="h-3 w-3 text-white/30" />
                        </>
                    )}
                    {safeContext.subGroupName && (
                        <span className="text-emerald-400 font-medium">{safeContext.subGroupName}</span>
                    )}

                    {/* Timezone */}
                    <span className="mx-2 text-white/20">|</span>
                    <Globe className="h-3.5 w-3.5 text-white/40" />
                    <span className="text-white/60">Timezone:</span>
                    <span className="text-white font-medium">{customTzLabel}</span>
                </div>
            </div>
        </div>
    );
};
