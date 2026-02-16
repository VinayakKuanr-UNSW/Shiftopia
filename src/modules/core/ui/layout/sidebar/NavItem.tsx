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
import { motion } from 'framer-motion';

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
            className={cn(
              "group relative flex items-center gap-3 px-3 py-2 my-1 rounded-lg transition-all duration-200",
              active 
                ? "bg-primary/10 font-medium" 
                : "text-foreground hover:bg-muted/50",
              indent && !isCollapsed ? "ml-6" : ""
            )}
          >
            {/* Active indicator bar */}
            {active && (
              <motion.div
                className={cn(
                  "absolute left-0 top-0 h-full w-1 rounded-l-lg",
                  sectionColor === "primary"
                    ? "bg-primary"
                    : `bg-${sectionColor}-500`
                )}
                layoutId="activeNavIndicator"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            )}
            
            {/* Icon */}
            <span
              className={cn(
                "transition-transform duration-200 group-hover:scale-105",
                active
                  ? colorClasses[sectionColor]
                  : "text-muted-foreground group-hover:text-foreground"
              )}
            >
              {icon}
            </span>
            
            {/* Label (hidden if collapsed) */}
            {!isCollapsed && (
              <span
                className={cn(
                  "text-sm transition-all",
                  active ? colorClasses[sectionColor] : ""
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
