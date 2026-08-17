import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/modules/core/lib/utils';
import { useSidebar } from '@/modules/core/ui/primitives/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { NavItemProps } from './types';

const NavItem: React.FC<NavItemProps> = ({
  icon,
  label,
  path,
  active,
  indent,
  sectionColor = "primary"
}) => {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  
  const colorClasses = {
    primary: "text-primary group-hover:text-primary",
    purple: "text-purple-400 group-hover:text-purple-300",
    blue: "text-sky-400 group-hover:text-sky-300",
    green: "text-green-400 group-hover:text-green-300",
    amber: "text-amber-400 group-hover:text-amber-300"
  };
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={path}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              "group relative flex items-center gap-3 px-3 py-2.5 my-1 rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900",
              active 
                ? "bg-primary/15 font-bold shadow-sm" 
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white font-medium",
              indent && !isCollapsed ? "ml-6" : ""
            )}
          >
            {/* Active indicator bar */}
            {active && (
              <div
                className={cn(
                  "absolute left-0 top-0 h-full w-1 rounded-l-xl",
                  sectionColor === "primary"
                    ? "bg-primary"
                    : `bg-${sectionColor}-500`
                )}
              />
            )}
            
            {/* Icon */}
            <span
              aria-hidden="true"
              className={cn(
                "transition-transform duration-200 shrink-0",
                active
                  ? colorClasses[sectionColor]
                  : "text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white"
              )}
            >
              {icon}
            </span>
            
            {/* Label (hidden if collapsed) */}
            {!isCollapsed && (
              <span
                className={cn(
                  "text-sm tracking-tight transition-all",
                  active ? colorClasses[sectionColor] : "text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white font-semibold"
                )}
              >
                {label}
              </span>
            )}
          </Link>
        </TooltipTrigger>
        
        {/* Tooltip for collapsed state */}
        {isCollapsed && (
          <TooltipContent side="right">
            {label}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
};

export default NavItem;
