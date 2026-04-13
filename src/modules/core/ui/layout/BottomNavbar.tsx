import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutGrid, Calendar, CalendarDays, Menu } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useSidebar } from '@/modules/core/ui/primitives/sidebar';
import { motion } from 'framer-motion';

const BottomNavbar: React.FC = () => {
  const { setOpenMobile } = useSidebar();

  const navItems = [
    {
      label: 'Home',
      icon: <LayoutGrid className="h-5 w-5" />,
      path: '/dashboard',
    },
    {
      label: 'Roster',
      icon: <Calendar className="h-5 w-5" />,
      path: '/my-roster',
    },
    {
      label: 'Avail',
      icon: <CalendarDays className="h-5 w-5" />,
      path: '/availabilities',
    },
  ];

  return (
    <motion.nav
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 h-[72px] bg-background/80 backdrop-blur-2xl border-t border-white/5 flex items-center justify-around px-6 shadow-[0_-8px_32px_rgba(0,0,0,0.4)]"
    >
      {/* Top indicator glow for the bar itself */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            cn(
              "relative flex flex-col items-center justify-center gap-1.5 transition-all duration-500 py-2 min-w-[64px]",
              isActive 
                ? "text-primary scale-110" 
                : "text-muted-foreground/60 hover:text-foreground active:scale-95"
            )
          }
        >
          {({ isActive }) => (
            <>
              {/* Active Item Backdrop Glow */}
              {isActive && (
                <motion.div 
                  layoutId="nav-glow"
                  className="absolute -top-3 left-1/2 -translate-x-1/2 w-12 h-6 bg-primary/20 blur-xl rounded-full"
                />
              )}
              
              <div className={cn(
                "transition-all duration-500",
                isActive && "drop-shadow-[0_0_8px_rgba(var(--primary),0.6)]"
              )}>
                {item.icon}
              </div>
              <span className={cn(
                "text-[9px] font-black uppercase tracking-[0.1em] transition-all",
                isActive ? "text-primary opacity-100" : "opacity-60"
              )}>
                {item.label}
              </span>

              {/* Bottom active block indicator */}
              {isActive && (
                <motion.div 
                  layoutId="nav-indicator"
                  className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-primary rounded-full shadow-[0_0_8px_rgba(var(--primary),0.4)]"
                />
              )}
            </>
          )}
        </NavLink>
      ))}

      {/* More Button */}
      <button
        onClick={() => setOpenMobile(true)}
        className="flex flex-col items-center justify-center gap-1.5 text-muted-foreground/60 hover:text-foreground active:scale-95 transition-all py-2 min-w-[64px]"
      >
        <Menu className="h-5 w-5" />
        <span className="text-[9px] font-black uppercase tracking-[0.1em] opacity-60">More</span>
      </button>
    </motion.nav>
  );
};

export default BottomNavbar;
