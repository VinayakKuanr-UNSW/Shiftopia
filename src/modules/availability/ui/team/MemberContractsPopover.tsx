/**
 * "+N more" badge beside a member's name, opening the list of every contract
 * they hold. Shared by the team grid and the day timeline; `compact` drops the
 * vertical padding to fit the timeline's shorter rows.
 */
import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import type { TeamMember } from '../../model/team-availability.types';

export const MemberContractsPopover: React.FC<{ member: TeamMember; compact?: boolean }> = ({ member, compact = false }) => {
    const [open, setOpen] = React.useState(false);
    const contracts = member.contracts ?? [];
    const extraCount = contracts.length - 1;

    if (extraCount <= 0) return null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpen(!open);
                    }}
                    onMouseEnter={() => setOpen(true)}
                    onMouseLeave={() => setOpen(false)}
                    className={cn(
                        'text-[11px] font-black uppercase tracking-wider rounded bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ml-1',
                        compact ? 'px-1' : 'px-1.5 py-0.5',
                    )}
                    aria-label={`View ${extraCount} additional contracts held by ${member.fullName}`}
                >
                    +{extraCount} more
                </button>
            </PopoverTrigger>
            <PopoverContent
                side="right"
                align="start"
                className="w-64 p-3 rounded-2xl border border-primary/20 shadow-2xl bg-popover/95 backdrop-blur-xl animate-in fade-in-50 zoom-in-95 duration-100 z-50 pointer-events-auto"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
            >
                <div className="space-y-2">
                    <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                        <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                            All Contracts ({contracts.length})
                        </span>
                        <span className="text-[11px] font-bold text-foreground truncate max-w-[120px]">
                            {member.fullName}
                        </span>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {contracts.map((c, i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-muted/30 border border-border/20 text-[11px]"
                            >
                                <span className="font-bold text-foreground truncate">
                                    {c.roleName ?? 'No role'}
                                </span>
                                {c.employmentStatus && (
                                    <span className="text-[11px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-background text-muted-foreground border border-border/30 shrink-0">
                                        {c.employmentStatus}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
};
