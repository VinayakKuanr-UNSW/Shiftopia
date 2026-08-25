import React from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { Briefcase, LogOut, User, UserRound } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { usePersona } from '@/platform/auth/PersonaProvider';

export const SidebarUser: React.FC = () => {
    const { user, logout, activeCertificate } = useAuth();
    const { persona, togglePersona, canSwitch, displayLevel } = usePersona();

    if (!user) return null;

    // Premium gradient for the avatar fallbak
    const avatarGradient = "bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500";

    return (
        <div className="flex flex-col gap-3 p-4 mx-2 mb-2 rounded-2xl bg-white/5 border border-white/10 shadow-lg backdrop-blur-md transition-all duration-300 hover:bg-white/10 hover:border-white/20 group/user-card">

            {/* User Name - Prominent */}
            <div className="px-1">
                <h3 className="font-bold text-sm text-foreground truncate tracking-tight">
                    {user.fullName}
                </h3>
                {/* The badge follows the PERSONA, not the highest certificate:
                    employee shows the Type X level (alpha/beta), employer the
                    Type Y one (gamma..zeta). `activeCertificate` is the old
                    behaviour and remains the fallback for a user with neither. */}
                <p className="text-[10px] font-medium text-slate-600 dark:text-slate-300 uppercase tracking-widest mt-0.5">
                    {displayLevel
                        ? `<${displayLevel}>`
                        : activeCertificate
                          ? `<${activeCertificate.accessLevel}>`
                          : (user.systemRole || 'Team Member')}
                </p>
            </div>

            {/* Controls Row: Avatar & Logout */}
            <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-3">
                    {/* Avatar with premium ring */}
                    <div className={cn(
                        "relative h-10 w-10 rounded-full flex items-center justify-center p-[2px]",
                        "bg-gradient-to-tr from-indigo-500/50 via-purple-500/50 to-pink-500/50"
                    )}>
                        <div className={cn(
                            "h-full w-full rounded-full flex items-center justify-center overflow-hidden border-2 border-background",
                            !user.avatar && avatarGradient
                        )}>
                            {user.avatar ? (
                                <img src={user.avatar} alt={user.fullName} className="h-full w-full object-cover" />
                            ) : (
                                <User className="h-5 w-5 text-white" />
                            )}
                        </div>

                        {/* Online/Active Indicator */}
                        <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background shadow-sm" />
                    </div>

                    {/* Persona toggle. Hidden entirely for a pure employee —
                        there is no second hat, and an inert control that never
                        does anything is worse than no control. */}
                    {canSwitch && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={togglePersona}
                            aria-label={
                                persona === 'employee'
                                    ? 'Switch to employer view'
                                    : 'Switch to employee view'
                            }
                            aria-pressed={persona === 'employer'}
                            title={
                                persona === 'employee'
                                    ? 'Employee view — switch to employer'
                                    : 'Employer view — switch to employee'
                            }
                            className={cn(
                                'h-8 w-8 rounded-full transition-colors',
                                persona === 'employer'
                                    ? 'text-indigo-500 dark:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20'
                                    : 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20',
                            )}
                        >
                            {persona === 'employer' ? (
                                <Briefcase className="h-4 w-4" />
                            ) : (
                                <UserRound className="h-4 w-4" />
                            )}
                        </Button>
                    )}
                </div>

                {/* Logout Button - Subtle until hover */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => logout()}
                    aria-label="Log out"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors rounded-full"
                    title="Log Out"
                >
                    <LogOut className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
};
