import React, { useMemo } from 'react';
import { accessLevelLabel } from '@/platform/auth/constants';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { Briefcase, LogOut, Moon, Settings, ShieldCheck, Sun, User, UserRound } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { usePersona, resolvePersonaRoute, Persona } from '@/platform/auth/PersonaProvider';

const PERSONA_LABELS: Record<Persona, string> = {
    employee: 'Employee',
    employer: 'Employer',
    admin: 'Admin',
};

export const SidebarUser: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, logout, activeCertificate, hasPermission } = useAuth();
    const { persona, setPersona, canSwitch, availablePersonas, displayLevel } = usePersona();
    const { theme, toggleTheme, isDark } = useTheme();

    if (!user) return null;

    const nextPersona = useMemo<Persona>(() => {
        const available: Persona[] = (availablePersonas && availablePersonas.length > 1)
            ? availablePersonas
            : ['employee', 'employer'];
        const currentIndex = available.indexOf(persona);
        const nextIndex = (currentIndex + 1) % available.length;
        return available[nextIndex];
    }, [availablePersonas, persona]);

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

    const isProfileActive = location.pathname === '/profile';
    const isSettingsActive = location.pathname === '/settings';

    // Premium gradient for the avatar fallback
    const avatarGradient = "bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500";

    return (
        <TooltipProvider delayDuration={200}>
            <div className="flex flex-col gap-2.5 p-3 mx-2 mb-2 rounded-2xl bg-white/5 border border-white/10 shadow-none transition-all duration-300 hover:bg-white/10 hover:border-white/20 group/user-card">

                {/* Row 1: <Name> <Access> */}
                <div className="flex items-center justify-between gap-2 px-1 min-w-0">
                    <h3 className="font-bold text-sm text-foreground truncate tracking-tight" title={user.fullName}>
                        {user.fullName}
                    </h3>
                    <span
                        className="text-[11px] font-semibold text-muted-foreground shrink-0"
                        title={`Access: ${certificateLabel}`}
                    >
                        {certificateLabel}
                    </span>
                </div>

                {/* Row 2: <profile> <theme> <mode changer> <settings> <logout> (all icons) */}
                <div className="flex items-center justify-between gap-1 pt-0.5" role="toolbar" aria-label="User Quick Actions">

                    {/* 1. Profile */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <NavLink
                                to="/profile"
                                aria-label="View Profile"
                                className={cn(
                                    "relative h-9 w-9 rounded-xl flex items-center justify-center transition-all duration-200 outline-none",
                                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
                                    isProfileActive
                                        ? "bg-primary/20 text-primary border border-primary/30 shadow-sm"
                                        : "text-muted-foreground hover:text-foreground hover:bg-white/10"
                                )}
                            >
                                <motion.div
                                    whileHover={{ scale: 1.12 }}
                                    whileTap={{ scale: 0.9 }}
                                    className="relative flex items-center justify-center"
                                >
                                    <div className={cn(
                                        "h-6 w-6 rounded-full flex items-center justify-center overflow-hidden border border-background shadow-xs",
                                        !user.avatar && avatarGradient
                                    )}>
                                        {user.avatar ? (
                                            <img src={user.avatar} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <User className="h-3.5 w-3.5 text-white" aria-hidden="true" />
                                        )}
                                    </div>
                                    <span className="sr-only">Profile</span>
                                    <span
                                        className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border border-background shadow-xs"
                                        aria-hidden="true"
                                    />
                                </motion.div>
                            </NavLink>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>Profile</p>
                        </TooltipContent>
                    </Tooltip>

                    {/* 2. Theme Toggle */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={toggleTheme}
                                aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
                                className={cn(
                                    "relative h-9 w-9 rounded-xl overflow-hidden transition-all duration-200",
                                    "text-muted-foreground hover:text-foreground hover:bg-white/10",
                                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                                )}
                            >
                                <motion.div
                                    whileHover={{ scale: 1.12 }}
                                    whileTap={{ scale: 0.9 }}
                                    className="flex items-center justify-center"
                                >
                                    <AnimatePresence mode="wait" initial={false}>
                                        <motion.div
                                            key={theme}
                                            initial={{ y: -12, opacity: 0, rotate: -90 }}
                                            animate={{ y: 0, opacity: 1, rotate: 0 }}
                                            exit={{ y: 12, opacity: 0, rotate: 90 }}
                                            transition={{ duration: 0.2, ease: "easeInOut" }}
                                            className="flex items-center justify-center"
                                        >
                                            {isDark ? (
                                                <Moon className="h-4 w-4 text-blue-400" aria-hidden="true" />
                                            ) : (
                                                <Sun className="h-4 w-4 text-amber-500" aria-hidden="true" />
                                            )}
                                        </motion.div>
                                    </AnimatePresence>
                                </motion.div>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>Switch to {isDark ? 'Light' : 'Dark'} Mode</p>
                        </TooltipContent>
                    </Tooltip>

                    {/* 3. Mode / Persona Changer */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleCyclePersona}
                                disabled={!canSwitch}
                                aria-label={canSwitch
                                    ? `Current mode: ${currentLabel}. Switch to ${nextLabel} mode`
                                    : `Current mode: ${currentLabel}`
                                }
                                className={cn(
                                    "relative h-9 w-9 rounded-xl overflow-hidden transition-all duration-200",
                                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
                                    persona === 'admin'
                                        ? "text-rose-500 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20"
                                        : persona === 'employer'
                                        ? "text-indigo-500 dark:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20"
                                        : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20",
                                    !canSwitch && "opacity-75 cursor-default hover:bg-transparent"
                                )}
                            >
                                <motion.div
                                    whileHover={canSwitch ? { scale: 1.12 } : undefined}
                                    whileTap={canSwitch ? { scale: 0.9 } : undefined}
                                    className="flex items-center justify-center"
                                >
                                    <AnimatePresence mode="wait" initial={false}>
                                        <motion.div
                                            key={persona}
                                            initial={{ y: -12, opacity: 0, rotate: -45 }}
                                            animate={{ y: 0, opacity: 1, rotate: 0 }}
                                            exit={{ y: 12, opacity: 0, rotate: 45 }}
                                            transition={{ duration: 0.2, ease: "easeInOut" }}
                                            className="flex items-center justify-center"
                                        >
                                            {persona === 'admin' ? (
                                                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                                            ) : persona === 'employer' ? (
                                                <Briefcase className="h-4 w-4" aria-hidden="true" />
                                            ) : (
                                                <UserRound className="h-4 w-4" aria-hidden="true" />
                                            )}
                                        </motion.div>
                                    </AnimatePresence>
                                </motion.div>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>{canSwitch ? `Switch to ${nextLabel} Mode` : `Current: ${currentLabel} Mode`}</p>
                        </TooltipContent>
                    </Tooltip>

                    {/* 4. Settings */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <NavLink
                                to="/settings"
                                aria-label="Settings"
                                className={cn(
                                    "relative h-9 w-9 rounded-xl flex items-center justify-center transition-all duration-200 outline-none",
                                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
                                    isSettingsActive
                                        ? "bg-primary/20 text-primary border border-primary/30 shadow-sm"
                                        : "text-muted-foreground hover:text-foreground hover:bg-white/10"
                                )}
                            >
                                <motion.div
                                    whileHover={{ rotate: 45, scale: 1.12 }}
                                    whileTap={{ scale: 0.9 }}
                                    transition={{ duration: 0.2 }}
                                    className="flex items-center justify-center"
                                >
                                    <Settings className="h-4 w-4" aria-hidden="true" />
                                    <span className="sr-only">Settings</span>
                                </motion.div>
                            </NavLink>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>Settings</p>
                        </TooltipContent>
                    </Tooltip>

                    {/* 5. Logout */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => logout()}
                                aria-label="Log out"
                                className={cn(
                                    "relative h-9 w-9 rounded-xl transition-all duration-200 text-muted-foreground hover:text-destructive hover:bg-destructive/10",
                                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                                )}
                            >
                                <motion.div
                                    whileHover={{ x: 2, scale: 1.12 }}
                                    whileTap={{ scale: 0.9 }}
                                    transition={{ duration: 0.15 }}
                                    className="flex items-center justify-center"
                                >
                                    <LogOut className="h-4 w-4" aria-hidden="true" />
                                    <span className="sr-only">Log Out</span>
                                </motion.div>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>Log Out</p>
                        </TooltipContent>
                    </Tooltip>

                </div>
            </div>
        </TooltipProvider>
    );
};
