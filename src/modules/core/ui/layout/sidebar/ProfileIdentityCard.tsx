import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { cn } from '@/modules/core/lib/utils';
import { ACCESS_LEVEL_CONFIG } from '@/platform/auth/constants';
import {
    Shield,
    User,
    ChevronDown,
    Briefcase,
    Building2,
    CheckCircle2,
    AlertCircle,
    LogOut,
    HelpCircle,
    MoreVertical
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Separator } from '@/modules/core/ui/primitives/separator';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';

export const ProfileIdentityCard: React.FC = () => {
    const { user, activeContract, activeCertificateId, setActiveCertificateId, activeCertificate, logout } = useAuth();
    const [isExpanded, setIsExpanded] = useState(false);

    if (!user) return null;

    // Resolve current visual theme based on active certificate level
    const currentAccessLevel = activeCertificate?.accessLevel || 'alpha';
    const accessConfig = ACCESS_LEVEL_CONFIG[currentAccessLevel];
    const AccessIcon = accessConfig.icon;

    // Group Contracts
    const activeContracts = user.contracts.filter(c => c.status === 'Active');

    return (
        <div className="flex flex-col gap-3 p-3 mx-2 rounded-2xl bg-gradient-to-b from-card/50 to-background border border-border/40 shadow-sm transition-all duration-300 hover:shadow-md group/card">

            {/* --- HEADER: Identity Summary --- */}
            <div className="flex items-center gap-3">
                <div className={cn(
                    "relative h-12 w-12 rounded-xl flex items-center justify-center transition-all duration-300",
                    "bg-gradient-to-br from-background to-muted border border-border/50 shadow-inner",
                    // Glow effect based on level
                    accessConfig.color.replace('text-', 'shadow-').replace('500', '500/20')
                )}>
                    {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.fullName} className="h-full w-full rounded-xl object-cover" />
                    ) : (
                        <User className={cn("h-6 w-6", accessConfig.color)} />
                    )}

                    {/* Access Level Badge Indicator */}
                    <div className={cn(
                        "absolute -bottom-1 -right-1 h-5 w-5 rounded-full flex items-center justify-center border-2 border-card",
                        "bg-background shadow-sm"
                    )}>
                        <AccessIcon className={cn("h-3 w-3", accessConfig.color)} />
                    </div>
                </div>

                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm text-foreground truncate leading-tight">
                        {user.fullName}
                    </h3>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/70 mt-0.5 flex items-center gap-1">
                        <Briefcase className="h-3 w-3" />
                        {activeContract?.roleName || 'No Active Role'}
                    </p>
                </div>

                {/* Dropdown Options */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover/card:opacity-100 transition-opacity">
                            <MoreVertical className="h-4 w-4 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>Account</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => { }}>
                            <User className="mr-2 h-4 w-4" /> Profile Settings
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { }}>
                            <HelpCircle className="mr-2 h-4 w-4" /> Help & Support
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => logout()}>
                            <LogOut className="mr-2 h-4 w-4" /> Log Out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <Separator className="bg-border/40" />

            {/* --- IDENTITY SECTION: Position Contracts --- */}
            <div className="space-y-2">
                <div
                    className="flex items-center justify-between cursor-pointer group/identity"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1.5">
                        <User className="h-3 w-3" /> Identity (Positions)
                    </h4>
                    <ChevronDown className={cn(
                        "h-3 w-3 text-muted-foreground/50 transition-transform duration-200",
                        isExpanded ? "rotate-90" : "rotate-0"
                    )} />
                </div>

                <div className={cn(
                    "space-y-1 overflow-hidden transition-all duration-300 ease-in-out",
                    isExpanded ? "max-h-[200px] opacity-100" : "max-h-[38px] opacity-100" // Show at least one by default or collapse logic? Let's show all if expanded, list only active otherwise.
                )}>
                    {/* Always show the Active Contract first/highlighted */}
                    {activeContracts.map(contract => (
                        <div
                            key={contract.id}
                            className={cn(
                                "flex items-center justify-between p-2 rounded-lg text-xs border transition-all",
                                contract.id === activeContract?.id
                                    ? "bg-primary/5 border-primary/20 shadow-sm"
                                    : "bg-muted/20 border-transparent hover:bg-muted/40"
                            )}
                        >
                            <div className="flex flex-col min-w-0">
                                <span className={cn(
                                    "font-semibold truncate",
                                    contract.id === activeContract?.id ? "text-primary placeholder:" : "text-muted-foreground"
                                )}>
                                    {contract.roleName}
                                </span>
                                <div className="flex items-center gap-1 text-[9px] text-muted-foreground/70">
                                    <Building2 className="h-2.5 w-2.5" />
                                    <span className="truncate">{contract.departmentName}</span>
                                </div>
                            </div>
                            {contract.id === activeContract?.id && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger>
                                            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                        </TooltipTrigger>
                                        <TooltipContent><p>Active Position</p></TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                    ))}

                    {activeContracts.length === 0 && (
                        <div className="p-2 text-xs text-muted-foreground italic text-center bg-muted/20 rounded-lg">
                            No active contracts
                        </div>
                    )}
                </div>
            </div>

            {/* --- AUTHORITY SECTION: Access Switcher --- */}
            <div className="space-y-2 pt-1">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1.5">
                    <Shield className="h-3 w-3" /> Authority (Context)
                </h4>

                <div className="relative">
                    <select
                        value={activeCertificateId || ''}
                        onChange={(e) => setActiveCertificateId(e.target.value)}
                        className={cn(
                            "w-full appearance-none bg-background border border-input rounded-lg py-2 pl-9 pr-8 text-xs font-semibold shadow-sm transition-colors",
                            "hover:border-primary/50 focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none",
                            "cursor-pointer text-foreground"
                        )}
                    >
                        {user.certificates.map((cert) => (
                            <option key={cert.id} value={cert.id} className="text-foreground bg-background">
                                {cert.accessLevel.toUpperCase()} — {cert.organizationName}
                            </option>
                        ))}
                    </select>

                    {/* Custom Icon Overlay */}
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <CheckCircle2 className={cn("h-3.5 w-3.5", accessConfig.color)} />
                    </div>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/70" />
                    </div>
                </div>
                <p className="text-[9px] text-muted-foreground/60 text-center px-1">
                    Switching context will refresh your permissions.
                </p>
            </div>

        </div>
    );
};
