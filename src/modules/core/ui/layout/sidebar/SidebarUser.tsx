import React, { useMemo } from 'react';
import { accessLevelLabel } from '@/platform/auth/constants';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { Briefcase, ChevronDown, LogOut, Moon, Settings, ShieldCheck, Sun, User, UserRound } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { usePersona, resolvePersonaRoute, Persona } from '@/platform/auth/PersonaProvider';

const PERSONA_LABELS: Record<Persona, string> = {
    employee: 'Employee',
    employer: 'Employer',
    admin: 'Admin',
};

const PERSONA_TONE: Record<Persona, string> = {
    admin: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20',
    employer: 'text-indigo-600 dark:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20',
    employee: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20',
};

const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background';

interface SidebarUserProps {
    isCollapsed?: boolean;
}

/**
 * The user card at the foot of the sidebar.
 *
 * Profile, theme, settings and log out live in one menu (log out last, red,
 * behind a divider — it used to sit beside Settings in a row of 34px icons).
 * The mode switch stays OUTSIDE the menu as its own one-tap button: switching
 * persona is a frequent, deliberate action and must never take two taps.
 * Collapsed, the same two controls stack in the rail; the menu opens on click
 * or keyboard, never on hover alone.
 */
export const SidebarUser: React.FC<SidebarUserProps> = ({ isCollapsed = false }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, logout, activeCertificate, hasPermission } = useAuth();
    const { persona, setPersona, canSwitch, availablePersonas, displayLevel } = usePersona();
    const { toggleTheme, isDark } = useTheme();

    // Hooks run before the early return below — returning first changed the
    // hook order between signed-out and signed-in renders.
    const nextPersona = useMemo<Persona>(() => {
        const available: Persona[] = (availablePersonas && availablePersonas.length > 1)
            ? availablePersonas
            : ['employee', 'employer'];
        const currentIndex = available.indexOf(persona);
        return available[(currentIndex + 1) % available.length];
    }, [availablePersonas, persona]);

    if (!user) return null;

    const handleCyclePersona = () => {
        if (!canSwitch) return;
        setPersona(nextPersona);
        const targetPath = resolvePersonaRoute(location.pathname, nextPersona, hasPermission);
        if (targetPath && targetPath !== location.pathname) {
            navigate(targetPath);
        }
    };

    const currentLabel = PERSONA_LABELS[persona] || 'Employee';
    const nextLabel = PERSONA_LABELS[nextPersona] || 'Employer';

    const certificateLabel = displayLevel
        ? accessLevelLabel(displayLevel)
        : activeCertificate
          ? accessLevelLabel(activeCertificate.accessLevel)
          : (user.systemRole || 'Team Member');

    const avatar = (size: string) => (
        <span className={cn(
            'relative shrink-0 rounded-xl flex items-center justify-center overflow-hidden border border-border/60',
            size,
            !user.avatar && 'bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500',
        )}>
            {user.avatar
                ? <img src={user.avatar} alt="" className="h-full w-full object-cover" />
                : <User className="h-4 w-4 text-white" aria-hidden="true" />}
        </span>
    );

    const modeButton = (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={handleCyclePersona}
                    disabled={!canSwitch}
                    aria-label={canSwitch
                        ? `Current mode: ${currentLabel}. Switch to ${nextLabel} mode`
                        : `Current mode: ${currentLabel}`}
                    className={cn(
                        'h-[44px] w-[44px] shrink-0 rounded-xl flex items-center justify-center transition-colors',
                        focusRing,
                        PERSONA_TONE[persona] ?? PERSONA_TONE.employee,
                        !canSwitch && 'cursor-default hover:bg-transparent',
                    )}
                >
                    {persona === 'admin'
                        ? <ShieldCheck className="h-[18px] w-[18px]" aria-hidden="true" />
                        : persona === 'employer'
                          ? <Briefcase className="h-[18px] w-[18px]" aria-hidden="true" />
                          : <UserRound className="h-[18px] w-[18px]" aria-hidden="true" />}
                </button>
            </TooltipTrigger>
            <TooltipContent side={isCollapsed ? 'right' : 'top'}>
                <p className="text-[13px]">{canSwitch ? `Switch to ${nextLabel} mode` : `${currentLabel} mode`}</p>
            </TooltipContent>
        </Tooltip>
    );

    const menu = (trigger: React.ReactNode) => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            <DropdownMenuContent
                side={isCollapsed ? 'right' : 'top'}
                align={isCollapsed ? 'end' : 'start'}
                sideOffset={8}
                className="w-[240px]"
            >
                <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
                    <span className="truncate text-[14px] font-semibold text-foreground">{user.fullName}</span>
                    <span className="truncate text-[13px] text-muted-foreground">{certificateLabel}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="min-h-[44px] gap-3 text-[13px]">
                    <NavLink to="/profile">
                        <User className="h-4 w-4" aria-hidden="true" /> Profile
                    </NavLink>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleTheme} className="min-h-[44px] gap-3 text-[13px]">
                    {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
                    Switch to {isDark ? 'light' : 'dark'} mode
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="min-h-[44px] gap-3 text-[13px]">
                    <NavLink to="/settings">
                        <Settings className="h-4 w-4" aria-hidden="true" /> Settings
                    </NavLink>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={() => logout()}
                    className="min-h-[44px] gap-3 text-[13px] text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );

    if (isCollapsed) {
        return (
            <TooltipProvider delayDuration={200}>
                <div className="flex flex-col items-center gap-2">
                    {modeButton}
                    {menu(
                        <button
                            type="button"
                            aria-label={`Account menu: ${user.fullName}`}
                            className={cn('h-[52px] w-[52px] rounded-2xl border border-border/60 bg-card p-1 flex items-center justify-center hover:bg-muted', focusRing)}
                        >
                            {avatar('h-[42px] w-[42px]')}
                        </button>,
                    )}
                </div>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider delayDuration={200}>
            <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card p-1.5">
                {menu(
                    <button
                        type="button"
                        aria-label={`Account menu: ${user.fullName}, ${certificateLabel}`}
                        className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left hover:bg-muted', focusRing)}
                    >
                        {avatar('h-[40px] w-[40px]')}
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-foreground">{user.fullName}</span>
                            <span className="block truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{certificateLabel}</span>
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>,
                )}
                {modeButton}
            </div>
        </TooltipProvider>
    );
};
